"""
QA (Video Q&A) Router
Handles: conversation management, streaming Q&A with LLM
"""
import json
import re
import time
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from starlette.responses import StreamingResponse
from pydantic import BaseModel

from app.db.qa import (
    create_conversation, get_conversations_by_source, get_conversation,
    update_conversation_title, delete_conversation, touch_conversation,
    add_message, get_messages, get_message, delete_message,
)
from app.db import get_all_transcriptions_by_source, get_active_model_full, get_llm_model_full_by_id
from app.services.llm import create_analysis_stream
from app.core.logger import logger, trace_id_ctx
from app.core.task_manager import task_manager, TaskCancelledException
from app.utils.source_utils import normalize_source_id
import asyncio

router = APIRouter(tags=["QA"])

MAX_HISTORY_ROUNDS = 10  # Max conversation rounds sent to LLM


# --- Pydantic Models ---

class CreateConversationRequest(BaseModel):
    source_id: str
    title: Optional[str] = None

class AskRequest(BaseModel):
    conversation_id: int
    question: str
    llm_model_id: Optional[int] = None

class UpdateTitleRequest(BaseModel):
    title: str


# --- System Prompt ---

QA_SYSTEM_PROMPT = """你是一个专业的视频内容问答助手，根据提供的视频转写文本回答问题。

规则：
1. 严格基于转写内容回答，不编造转写中不存在的信息
2. 引用视频内容时标注时间戳，格式 [MM:SS]
3. 转写中找不到答案时明确说明
4. 用简洁有条理的方式组织答案
5. 使用与用户提问相同的语言回答"""


# --- Helpers ---

def _build_transcript_text(segments: list) -> str:
    lines = []
    for seg in segments:
        seg_dict = dict(seg)
        start = seg_dict.get("segment_start") or 0
        h = int(start // 3600)
        m = int((start % 3600) // 60)
        s = int(start % 60)
        ts = f"{h:02d}:{m:02d}:{s:02d}"
        text = (seg_dict.get("raw_text") or "").strip()
        text = re.sub(r"<\|.*?\|>", "", text).strip()
        if text:
            lines.append(f"[{ts}] {text}")
    return "\n".join(lines)


def _build_messages_for_llm(transcript_text: str, history: list, question: str) -> list:
    messages = [
        {"role": "system", "content": QA_SYSTEM_PROMPT},
        {"role": "user", "content": f"以下是视频转写文本，请基于此内容回答后续问题：\n\n{transcript_text}"},
        {"role": "assistant", "content": "好的，我已阅读完视频转写文本。请提出你的问题。"},
    ]
    # Append recent history (skip the first question if it's the current one)
    recent = history[-(MAX_HISTORY_ROUNDS * 2):]
    for msg in recent:
        msg_dict = dict(msg)
        messages.append({"role": msg_dict["role"], "content": msg_dict["content"]})
    # Current question
    messages.append({"role": "user", "content": question})
    return messages


# --- Background Worker ---

async def _process_qa(
    conversation_id: int,
    task_id: int,
    messages_for_llm: list,
    llm_model_id: Optional[int],
    question: str,
    trace_id_token: str = None,
):
    token = None
    if trace_id_token:
        token = trace_id_ctx.set(trace_id_token)

    task = task_manager.tasks.get(task_id)
    if task:
        task["_stream_chunks"] = []
        task["_stream_model"] = ""
        task["_stream_done"] = False
        task["_stream_result"] = ""
        task["_stream_duration"] = 0
        task["_stream_error"] = ""

    try:
        logger.info(f"QA: Starting for conversation {conversation_id}, task {task_id}")
        task_manager.update_progress(task_id, 10, "Requesting LLM...")

        start_time = time.time()

        model_name, stream = create_analysis_stream(
            None, None, llm_model_id, messages_override=messages_for_llm
        )

        if task:
            task["_stream_model"] = model_name

        full_text = ""
        async for chunk in stream:
            if task_manager.is_cancelled(task_id):
                raise TaskCancelledException(f"Task {task_id} cancelled")
            full_text += chunk
            if task:
                task["_stream_chunks"].append(chunk)

        duration = round(time.time() - start_time, 2)

        # Save assistant message
        add_message(conversation_id, "assistant", full_text, model_name, duration)
        touch_conversation(conversation_id)

        # Auto-generate title from first question if conversation has no title
        conv = get_conversation(conversation_id)
        if conv and not conv["title"]:
            title = question[:50] + ("..." if len(question) > 50 else "")
            update_conversation_title(conversation_id, title)

        task_manager.update_progress(task_id, 100, "Completed")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "completed"
            task["_stream_duration"] = duration

    except TaskCancelledException:
        logger.warning(f"QA: Cancelled for conversation {conversation_id}")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "cancelled"
    except asyncio.CancelledError:
        logger.warning(f"QA: Asyncio cancelled for conversation {conversation_id}")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "cancelled"
    except Exception as e:
        logger.error(f"QA: Failed for conversation {conversation_id}: {e}", exc_info=True)
        task_manager.update_progress(task_id, 0, f"Failed: {str(e)}")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "failed"
            task["_stream_error"] = str(e)
    finally:
        task_manager.finish_task(task_id)
        if token:
            trace_id_ctx.reset(token)


# --- Endpoints ---

@router.post("/qa/conversations")
async def create_conversation_endpoint(request: CreateConversationRequest):
    source_id = normalize_source_id(request.source_id)
    conv_id = create_conversation(source_id, request.title)
    return {"id": conv_id}


@router.get("/qa/conversations")
async def list_conversations(source_id: str):
    source_id = normalize_source_id(source_id)
    rows = get_conversations_by_source(source_id)
    return [dict(r) for r in rows]


@router.patch("/qa/conversations/{conversation_id}")
async def update_conversation_endpoint(conversation_id: int, request: UpdateTitleRequest):
    conv = get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    update_conversation_title(conversation_id, request.title)
    return {"status": "success"}


@router.delete("/qa/conversations/{conversation_id}")
async def delete_conversation_endpoint(conversation_id: int):
    conv = get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    delete_conversation(conversation_id)
    return {"status": "success"}


@router.get("/qa/conversations/{conversation_id}/messages")
async def list_messages(conversation_id: int):
    conv = get_conversation(conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")
    rows = get_messages(conversation_id)
    return [dict(r) for r in rows]


@router.delete("/qa/messages/{message_id}")
async def delete_message_endpoint(message_id: int):
    msg = get_message(message_id)
    if not msg:
        raise HTTPException(404, "Message not found")
    delete_message(message_id)
    return {"status": "success"}


@router.post("/qa/ask")
async def ask_endpoint(request: AskRequest, background_tasks: BackgroundTasks):
    conv = get_conversation(request.conversation_id)
    if not conv:
        raise HTTPException(404, "Conversation not found")

    source_id = conv["source_id"]

    # Get transcript
    all_segments = get_all_transcriptions_by_source(source_id)
    if not all_segments:
        raise HTTPException(404, "No transcriptions found for this video.")

    pinned = [s for s in all_segments if dict(s).get("is_pinned")]
    segments = pinned if pinned else all_segments
    transcript_text = _build_transcript_text(segments)
    if not transcript_text.strip():
        raise HTTPException(422, "Transcription text is empty.")

    # Save user message
    add_message(request.conversation_id, "user", request.question)

    # Build LLM messages with history
    history = get_messages(request.conversation_id)
    # Exclude the message we just added (it's the current question)
    history = [m for m in history if dict(m)["role"] != "user" or dict(m)["content"] != request.question or dict(m)["id"] != history[-1]["id"]]
    messages_for_llm = _build_messages_for_llm(transcript_text, history, request.question)

    # Create task
    task_id = -int(time.time() * 1000) % 1000000000
    task_manager.start_task(task_id, meta={
        "type": "qa",
        "conversation_id": request.conversation_id,
    })

    trace_id = trace_id_ctx.get()
    background_tasks.add_task(
        _process_qa,
        request.conversation_id,
        task_id,
        messages_for_llm,
        request.llm_model_id,
        request.question,
        trace_id,
    )

    return {"task_id": task_id}


@router.get("/qa/stream/{task_id}")
async def observe_qa_stream(task_id: int):
    task = task_manager.tasks.get(task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    async def event_stream():
        cursor = 0
        model_sent = False

        while True:
            task = task_manager.tasks.get(task_id)
            if not task:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Task removed'}, ensure_ascii=False)}\n\n"
                break

            if not model_sent:
                model = task.get("_stream_model", "")
                if model:
                    yield f"data: {json.dumps({'type': 'start', 'model': model}, ensure_ascii=False)}\n\n"
                    model_sent = True

            chunks = task.get("_stream_chunks", [])
            while cursor < len(chunks):
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunks[cursor]}, ensure_ascii=False)}\n\n"
                cursor += 1

            if task.get("_stream_done"):
                chunks = task.get("_stream_chunks", [])
                while cursor < len(chunks):
                    yield f"data: {json.dumps({'type': 'chunk', 'text': chunks[cursor]}, ensure_ascii=False)}\n\n"
                    cursor += 1

                result = task.get("_stream_result", "failed")
                if result == "completed":
                    duration = task.get("_stream_duration", 0)
                    yield f"data: {json.dumps({'type': 'done', 'duration': duration}, ensure_ascii=False)}\n\n"
                elif result == "cancelled":
                    yield f"data: {json.dumps({'type': 'error', 'message': 'Task cancelled'}, ensure_ascii=False)}\n\n"
                else:
                    error_msg = task.get("_stream_error", "Unknown error")
                    yield f"data: {json.dumps({'type': 'error', 'message': error_msg}, ensure_ascii=False)}\n\n"
                break

            await asyncio.sleep(0.05)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
