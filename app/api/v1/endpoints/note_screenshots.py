"""
Note Screenshots Router
Serves keyframe screenshots extracted during AI note generation.
"""
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.core.config import settings

router = APIRouter(tags=["Note Screenshots"])


@router.get("/note-screenshots/{source_id}/{filename}")
async def get_note_screenshot(source_id: str, filename: str):
    """Serve a keyframe screenshot image."""
    # Basic filename sanitisation
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    path = os.path.join(settings.NOTE_SCREENSHOTS_DIR, source_id, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Screenshot not found")

    # Security: ensure path is within screenshots dir
    abs_path = os.path.abspath(path)
    base_dir = os.path.abspath(settings.NOTE_SCREENSHOTS_DIR)
    if not abs_path.startswith(base_dir):
        raise HTTPException(status_code=403, detail="Access denied")

    return FileResponse(abs_path, media_type="image/jpeg")
