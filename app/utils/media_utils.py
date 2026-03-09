"""
Media utility functions.
Extracted from transcribe endpoint for reusability.
"""
import subprocess
import mimetypes
from app.core.logger import logger


def extract_video_frame(video_path: str, output_path: str) -> bool:
    """Extract the first frame from a video using FFmpeg."""
    try:
        cmd = [
            'ffmpeg', '-y',
            '-ss', '0.5',
            '-i', video_path,
            '-vframes', '1',
            '-q:v', '2',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        if result.returncode != 0:
            logger.error(f"FFmpeg Error: {result.stderr}")
            return False
        return True
    except Exception as e:
        logger.error(f"FFmpeg Exception: {e}")
        return False


def extract_frame_at_time(video_path: str, time_seconds: float, output_path: str) -> bool:
    """Extract a single frame at a specific timestamp from a video using FFmpeg.

    Args:
        video_path: Absolute or relative path to the video file.
        time_seconds: Position in seconds (e.g. 125.0 for 2:05).
        output_path: Where to save the JPEG screenshot.

    Returns:
        True if the frame was extracted successfully, False otherwise.
    """
    try:
        startupinfo = None
        if hasattr(subprocess, 'STARTUPINFO'):
            startupinfo = subprocess.STARTUPINFO()
            startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startupinfo.wShowWindow = subprocess.SW_HIDE

        cmd = [
            'ffmpeg', '-y',
            '-ss', str(time_seconds),
            '-i', video_path,
            '-vframes', '1',
            '-q:v', '3',
            output_path,
        ]
        result = subprocess.run(
            cmd, capture_output=True, text=True,
            encoding='utf-8', errors='ignore',
            startupinfo=startupinfo,
        )
        if result.returncode != 0:
            logger.warning(f"FFmpeg extract_frame failed at {time_seconds}s: {result.stderr[:200]}")
            return False
        return True
    except Exception as e:
        logger.error(f"FFmpeg Exception at {time_seconds}s: {e}")
        return False


def is_network_media_url(url: str) -> bool:
    """Check if URL is a direct media link."""
    url_lower = url.lower()
    # Common media extensions
    media_extensions = ['.mp4', '.mp3', '.wav', '.m4a', '.webm', '.ogg', '.flac', '.aac']
    if any(url_lower.endswith(ext) or f"{ext}?" in url_lower for ext in media_extensions):
        return True
    # Douyin CDN patterns
    if "douyin.com/aweme/v1/play" in url_lower or "bytecdn.cn" in url_lower:
        return True
    return False


def detect_media_type(filename: str, content_type: str = None) -> str:
    """Detect media type from filename/content_type. Returns 'video', 'audio', or 'file'."""
    mime = content_type or ""
    if not mime or mime == "application/octet-stream":
        mime, _ = mimetypes.guess_type(filename)
        mime = mime or ""
    
    if mime.startswith("video"):
        return "video"
    elif mime.startswith("audio"):
        return "audio"
    return "file"
