"""
Note Screenshots Router
Serves keyframe screenshots extracted during AI note generation.
Also accepts manually uploaded screenshots from the frontend.
"""
import hashlib
import os
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from app.core.config import settings
from app.core.logger import logger

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


@router.post("/note-screenshots/{source_id}/upload")
async def upload_note_screenshot(source_id: str, file: UploadFile = File(...)):
    """Accept a manually captured screenshot blob from the frontend Canvas API.

    The frontend captures the current video frame using HTMLCanvasElement.toBlob()
    and uploads it here. The file is saved under NOTE_SCREENSHOTS_DIR/{source_id}/
    with a filename derived from the MD5 hash of the file content.

    Returns {"url": "/api/note-screenshots/{source_id}/{filename}", "filename": filename}
    """
    # Basic source_id sanitisation
    if ".." in source_id or "/" in source_id or "\\" in source_id:
        raise HTTPException(status_code=400, detail="Invalid source_id")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    # Deterministic filename based on content hash
    name_hash = hashlib.md5(contents).hexdigest()[:12]
    filename = f"manual_{name_hash}.jpg"

    out_dir = os.path.join(settings.NOTE_SCREENSHOTS_DIR, source_id)
    os.makedirs(out_dir, exist_ok=True)

    out_path = os.path.join(out_dir, filename)
    with open(out_path, "wb") as f:
        f.write(contents)

    logger.info(f"📷 Manual screenshot saved: {out_path}")
    img_url = f"/api/note-screenshots/{source_id}/{filename}"
    return {"url": img_url, "filename": filename}
