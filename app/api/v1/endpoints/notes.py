"""
Video Notes Router
Handles: AI note generation (background), note CRUD, version management.
"""
import re
import time
from typing import Optional

from fastapi import APIRouter, Body, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.db import (
    get_all_notes, get_active_note, get_note_by_id,
    add_video_note, update_note_content, reset_note_to_original,
    delete_video_note, set_note_active,
    get_all_transcriptions_by_source,
    get_active_model_full, get_llm_model_full_by_id,
)
from app.services.llm import analyze_text
from app.core.logger import logger, trace_id_ctx
from app.core.task_manager import task_manager, TaskCancelledException
from app.utils.source_utils import normalize_source_id
import asyncio

router = APIRouter(tags=["Notes"])


# --- Pydantic Models ---

class NoteGenerateRequest(BaseModel):
    """Request schema for AI note generation."""
    source_id: str
    prompt: Optional[str] = None       # Custom user prompt; None = use built-in note prompt
    llm_model_id: Optional[int] = None
    style: Optional[str] = None        # 'concise' | 'detailed' | 'outline'


class NoteUpdateRequest(BaseModel):
    content: str


# --- Built-in Note Generation Prompt ---

NOTE_SYSTEM_PROMPT = """你是一个专业的视频内容笔记助手，擅长将视频逐字稿整理成结构清晰、内容完整的学习笔记。

**笔记要求：**
1. **语言**：笔记使用中文，专有名词、技术术语保留英文。
2. **结构**：使用 Markdown 标题（##）区分主要章节，每个章节以时间戳开头，格式为 `⏱ mm:ss`。
3. **内容**：忠实还原视频核心信息，保留关键细节、示例、结论。省略广告、填充词。
4. **标题格式**：使用 `## 章节名 ⏱ mm:ss` 格式，`⏱` 后的时间戳代表该章节在视频中的起始时刻。
5. **结尾**：在笔记末尾添加一段 **🧠 AI 总结**，用 2-4 句话概括整个视频的核心观点。
6. **禁止**：不要用代码块包裹 Markdown，不要生成目录。

**时间戳格式说明（输入）：**
每一段转写文本的格式为：`[hh:mm:ss] 文本内容`
请根据这些时间信息，在合适的章节标题中使用 `⏱ mm:ss` 格式标注时间。"""


def _build_note_prompt(style: Optional[str]) -> str:
    """Build the final user prompt for note generation based on style."""
    if style == "concise":
        return NOTE_SYSTEM_PROMPT + "\n\n**风格要求**：简洁模式，每个章节使用 3-5 条要点列表，避免大段文字。"
    elif style == "outline":
        return NOTE_SYSTEM_PROMPT + "\n\n**风格要求**：大纲模式，只输出标题和子标题，不需要详细内容。"
    else:  # 'detailed' or default
        return NOTE_SYSTEM_PROMPT + "\n\n**风格要求**：详细模式，充分展开每个章节，保留所有重要细节。"


def _build_transcript_text(segments: list) -> str:
    """Combine all segments into a timestamped transcript text."""
    lines = []
    for seg in segments:
        # sqlite3.Row supports column-name access but not .get() — convert to dict
        seg_dict = dict(seg)
        start = seg_dict.get("segment_start") or 0
        h = int(start // 3600)
        m = int((start % 3600) // 60)
        s = int(start % 60)
        ts = f"{h:02d}:{m:02d}:{s:02d}"
        text = (seg_dict.get("raw_text") or "").strip()
        # Strip ASR emotion tags like <|HAPPY|>
        text = re.sub(r"<\|.*?\|>", "", text).strip()
        if text:
            lines.append(f"[{ts}] {text}")
    return "\n".join(lines)


# --- Background Worker ---

async def _process_note_generation(
    source_id: str,
    task_id: int,
    transcript_text: str,
    prompt: str,
    llm_model_id: Optional[int],
    style: Optional[str],
    trace_id_token: str = None,
):
    token = None
    if trace_id_token:
        token = trace_id_ctx.set(trace_id_token)

    try:
        logger.info(f"📝 Starting note generation for {source_id}, Task {task_id}...")
        task_manager.update_progress(task_id, 10, "Requesting LLM for note generation...")

        start_time = time.time()

        llm_task = asyncio.create_task(analyze_text(transcript_text, prompt, llm_model_id))
        while not llm_task.done():
            if task_manager.is_cancelled(task_id):
                llm_task.cancel()
                raise TaskCancelledException(f"Task {task_id} cancelled by user")
            await asyncio.sleep(0.5)

        content, model_name = llm_task.result()
        duration = round(time.time() - start_time, 2)

        task_manager.update_progress(task_id, 90, "Saving note...")

        # Resolve provider_id from model if possible
        provider_id = None
        if llm_model_id:
            model_info = get_llm_model_full_by_id(llm_model_id)
            if model_info:
                provider_id = model_info.get("provider_id")
        else:
            model_info = get_active_model_full()
            if model_info:
                provider_id = model_info.get("id")

        add_video_note(
            source_id=source_id,
            content=content,
            original_content=content,
            prompt=prompt,
            model=model_name,
            provider_id=provider_id,
            style=style,
            response_time=duration,
        )

        logger.info(f"✅ Note generation completed for {source_id}")
        task_manager.update_progress(task_id, 100, "Note generated successfully")

    except TaskCancelledException as e:
        logger.warning(f"⚠️ Note generation cancelled for {source_id}: {e}")
    except asyncio.CancelledError:
        logger.warning(f"⚠️ Note generation asyncio task cancelled for {source_id}")
    except Exception as e:
        logger.error(f"❌ Note generation failed for {source_id}: {e}", exc_info=True)
        task_manager.update_progress(task_id, 0, f"Failed: {str(e)}")
    finally:
        task_manager.finish_task(task_id)
        if token:
            trace_id_ctx.reset(token)


# --- Helper: row to dict ---

def _note_to_dict(row) -> dict:
    d = dict(row)
    d["is_edited"] = bool(d.get("is_edited"))
    d["is_active"] = bool(d.get("is_active"))
    return d


# --- Endpoints ---

@router.post("/notes/generate")
async def generate_note(request: NoteGenerateRequest, background_tasks: BackgroundTasks):
    """Generate an AI note for a whole video in the background."""
    source_id = normalize_source_id(request.source_id)

    # Fetch all segments
    segments = get_all_transcriptions_by_source(source_id)
    if not segments:
        raise HTTPException(status_code=404, detail="No transcriptions found for this video. Please transcribe first.")

    transcript_text = _build_transcript_text(segments)
    if not transcript_text.strip():
        raise HTTPException(status_code=422, detail="Transcription text is empty.")

    # Build final prompt
    base_prompt = request.prompt or _build_note_prompt(request.style)

    # Create task
    task_id = -int(time.time() * 1000) % 1000000000
    task_manager.start_task(task_id, meta={
        "type": "ai",
        "filename": f"Note: {source_id}"
    })

    trace_id = trace_id_ctx.get()
    background_tasks.add_task(
        _process_note_generation,
        source_id,
        task_id,
        transcript_text,
        base_prompt,
        request.llm_model_id,
        request.style,
        trace_id,
    )

    return {"status": "queued", "message": "Note generation started in background", "task_id": task_id}


@router.get("/notes")
async def list_notes(source_id: str):
    """List all note versions for a video."""
    source_id = normalize_source_id(source_id)
    rows = get_all_notes(source_id)
    return [_note_to_dict(r) for r in rows]


@router.get("/notes/active")
async def get_active_note_endpoint(source_id: str):
    """Get the currently active note for a video."""
    source_id = normalize_source_id(source_id)
    row = get_active_note(source_id)
    if not row:
        return None
    return _note_to_dict(row)


@router.patch("/notes/{note_id}")
async def update_note(note_id: int, payload: NoteUpdateRequest):
    """Update note content (user edit)."""
    row = get_note_by_id(note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    update_note_content(note_id, payload.content)
    return {"status": "success"}


@router.patch("/notes/{note_id}/reset")
async def reset_note(note_id: int):
    """Reset note content back to AI-generated original."""
    row = get_note_by_id(note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    reset_note_to_original(note_id)
    return {"status": "success"}


@router.patch("/notes/{note_id}/activate")
async def activate_note(note_id: int):
    """Switch the active note version."""
    row = get_note_by_id(note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    set_note_active(note_id, row["source_id"])
    return {"status": "success"}


@router.delete("/notes/{note_id}")
async def delete_note(note_id: int):
    """Delete a specific note version."""
    row = get_note_by_id(note_id)
    if not row:
        raise HTTPException(status_code=404, detail="Note not found")
    delete_video_note(note_id)
    return {"status": "success"}
