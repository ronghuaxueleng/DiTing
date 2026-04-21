"""
AI Analysis & Summaries Router
Handles: AI analysis (background), AI summary CRUD
All LLM/ASR/Prompt configuration routes are in settings.py
"""
import re
import time
import json
import sqlite3
from typing import Optional

from fastapi import APIRouter, Body, HTTPException, BackgroundTasks
from starlette.responses import StreamingResponse
from pydantic import BaseModel

from app.db import (
    get_transcription_by_source, update_ai_status,
    add_ai_summary, get_ai_summaries, delete_ai_summary, clear_ai_summaries, update_ai_summary,
)
from app.core.config import settings
from app.services.llm import create_analysis_stream
from app.core.logger import logger, trace_id_ctx
from app.utils.source_utils import normalize_source_id
from app.core.task_manager import task_manager, TaskCancelledException
import asyncio

router = APIRouter(tags=["AI"])


# --- Pydantic Models ---

class AnalyzeRequest(BaseModel):
    """Request schema for AI analysis."""
    prompt: str
    prompt_id: Optional[int] = None
    transcription_id: Optional[int] = None
    source_id: Optional[str] = None
    llm_model_id: Optional[int] = None
    overwrite: bool = False
    overwrite_id: Optional[int] = None
    parent_id: Optional[int] = None
    input_text: Optional[str] = None
    strip_subtitle: bool = False


# --- Background Worker ---

async def process_ai_analysis(
    item_id: int,
    task_id: int,
    text_to_analyze: str,
    prompt: str,
    llm_model_id: int,
    parent_id: int,
    input_text: str,
    overwrite: bool,
    overwrite_id: int,
    trace_id_token: str = None
):
    token = None
    if trace_id_token:
        token = trace_id_ctx.set(trace_id_token)

    # Attach stream data to task for SSE observer
    task = task_manager.tasks.get(task_id)
    if task:
        task["_stream_chunks"] = []
        task["_stream_model"] = ""
        task["_stream_done"] = False
        task["_stream_result"] = ""
        task["_stream_duration"] = 0
        task["_stream_error"] = ""

    try:
        logger.info(f"🧠 Starting AI Analysis for Item {item_id}, Task {task_id}...")
        update_ai_status(item_id, "processing")
        task_manager.update_progress(task_id, 10, "Requesting LLM...")

        start_time = time.time()

        model_name, stream = create_analysis_stream(text_to_analyze, prompt, llm_model_id)

        if task:
            task["_stream_model"] = model_name

        full_text = ""
        async for chunk in stream:
            if task_manager.is_cancelled(task_id):
                raise TaskCancelledException(f"Task {task_id} cancelled by user")
            full_text += chunk
            if task:
                task["_stream_chunks"].append(chunk)

        duration = round(time.time() - start_time, 2)

        task_manager.update_progress(task_id, 90, "Saving summary...")

        if overwrite:
            clear_ai_summaries(item_id)
        elif overwrite_id:
            delete_ai_summary(overwrite_id)

        add_ai_summary(item_id, prompt, full_text, model_name, duration, parent_id=parent_id, input_text=input_text)

        update_ai_status(item_id, "completed")
        logger.info(f"✅ AI Analysis completed for Item {item_id}")
        task_manager.update_progress(task_id, 100, "Completed")

        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "completed"
            task["_stream_duration"] = duration

    except TaskCancelledException as e:
        logger.warning(f"⚠️ AI Analysis cancelled for Item {item_id}: {e}")
        update_ai_status(item_id, "cancelled")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "cancelled"
    except asyncio.CancelledError:
        logger.warning(f"⚠️ AI Analysis asyncio task cancelled for Item {item_id}")
        update_ai_status(item_id, "cancelled")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "cancelled"
    except Exception as e:
        logger.error(f"❌ AI Analysis failed for Item {item_id}: {e}")
        update_ai_status(item_id, "failed")
        task_manager.update_progress(task_id, 0, f"Failed: {str(e)}")
        if task:
            task["_stream_done"] = True
            task["_stream_result"] = "failed"
            task["_stream_error"] = str(e)
    finally:
        task_manager.finish_task(task_id)
        if token:
            trace_id_ctx.reset(token)


# --- Analyze Endpoint ---

@router.post("/analyze")
async def analyze_endpoint(
    background_tasks: BackgroundTasks,
    request: AnalyzeRequest
):
    record = None
    if request.transcription_id:
        conn = sqlite3.connect(settings.DB_PATH)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM transcriptions WHERE id = ?", (request.transcription_id,))
        record = c.fetchone()
        conn.close()
    
    if request.source_id and not record:
        source_id = normalize_source_id(request.source_id)
        record = get_transcription_by_source(source_id)
    
    if not record:
        raise HTTPException(status_code=404, detail="Transcription not found. Please transcribe the video first.")
        
    if request.prompt_id:
        from app.db.prompts import increment_prompt_use_count
        increment_prompt_use_count(request.prompt_id)
    
    text_to_analyze = request.input_text
    if not text_to_analyze:
        raw_text = record['raw_text']
        if request.strip_subtitle:
            from app.utils.preprocessing import strip_subtitle_metadata
            text_to_analyze = strip_subtitle_metadata(raw_text)
        else:
            text_to_analyze = re.sub(r'<\|.*?\|>', '', raw_text)
    
    item_id = record['id']
    
    # Generate ephemeral task ID for TaskManager
    task_id = -int(time.time() * 1000) % 1000000000
    
    from app.db import get_video_meta
    meta = get_video_meta(record['source'])
    title = dict(meta).get('video_title', 'Unknown') if meta else 'Unknown'
    
    task_manager.start_task(task_id, meta={
        "type": "ai",
        "filename": f"AI: {title}",
        "item_id": item_id,
    })
    
    trace_id = trace_id_ctx.get()
    background_tasks.add_task(
        process_ai_analysis,
        item_id,
        task_id,
        text_to_analyze,
        request.prompt,
        request.llm_model_id,
        request.parent_id,
        request.input_text,
        request.overwrite,
        request.overwrite_id,
        trace_id
    )
    
    update_ai_status(item_id, "queued")

    return {"status": "queued", "message": "AI Analysis started in background", "task_id": task_id}


# --- Stream Observer Endpoint ---

@router.get("/analyze/stream/{task_id}")
async def observe_analysis_stream(task_id: int):
    """SSE endpoint to observe a running AI analysis task. Disconnecting does NOT cancel the task."""
    task = task_manager.tasks.get(task_id)
    if not task:
        raise HTTPException(404, detail="Task not found")

    async def event_stream():
        cursor = 0
        model_sent = False

        while True:
            task = task_manager.tasks.get(task_id)
            if not task:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Task removed'}, ensure_ascii=False)}\n\n"
                break

            # Send start event once model name is known
            if not model_sent:
                model = task.get("_stream_model", "")
                if model:
                    yield f"data: {json.dumps({'type': 'start', 'model': model}, ensure_ascii=False)}\n\n"
                    model_sent = True

            # Send new chunks
            chunks = task.get("_stream_chunks", [])
            while cursor < len(chunks):
                yield f"data: {json.dumps({'type': 'chunk', 'text': chunks[cursor]}, ensure_ascii=False)}\n\n"
                cursor += 1

            # Check if task is done
            if task.get("_stream_done"):
                # Flush any remaining chunks
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


# --- Summaries CRUD ---

@router.delete("/summaries/{summary_id}")
async def delete_summary_endpoint(summary_id: int):
    """Delete a specific AI summary version"""
    delete_ai_summary(summary_id)
    return {"status": "success"}


@router.post("/summaries/manual")
async def create_manual_summary(item: dict = Body(...)):
    """Save a manual edit as a new summary version"""
    transcription_id = item.get("transcription_id")
    parent_id = item.get("parent_id")
    summary = item.get("summary")
    prompt = item.get("prompt", "Manual Edit")
    model = item.get("model", "User Edit")
    
    if not transcription_id or not summary:
        raise HTTPException(status_code=400, detail="Missing required fields")
        
    add_ai_summary(
        transcription_id,
        prompt,
        summary,
        model=model,
        response_time=0,
        parent_id=parent_id
    )
    return {"status": "success"}


@router.patch("/summaries/{summary_id}")
async def update_summary_endpoint(summary_id: int, item: dict = Body(...)):
    """Update a specific AI summary content"""
    summary = item.get("summary")
    if not summary:
        raise HTTPException(status_code=400, detail="Missing summary content")
    update_ai_summary(summary_id, summary)
    return {"status": "success"}
