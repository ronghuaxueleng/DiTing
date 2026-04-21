"""
System Logs Router
Provides endpoints to read and tail application log files.
"""
import os
import json
from collections import deque
from typing import Optional

from fastapi import APIRouter, Query, HTTPException

router = APIRouter(prefix="/logs", tags=["Logs"])

LOG_DIR = "logs"

LOG_FILES = {
    "info": os.path.join(LOG_DIR, "info.log.json"),
    "error": os.path.join(LOG_DIR, "error.log.json"),
    "access": os.path.join(LOG_DIR, "access.log.json"),
}


@router.get("")
async def get_logs(
    file: str = Query("info", description="Log file to read: info, error, access"),
    lines: int = Query(100, ge=1, le=500, description="Number of lines to return"),
    level: Optional[str] = Query(None, description="Filter by log level: INFO, ERROR, WARNING"),
):
    """Read the latest N lines from a log file, optionally filtered by level."""
    if file not in LOG_FILES:
        raise HTTPException(status_code=400, detail=f"Invalid log file: {file}. Must be one of: {', '.join(LOG_FILES.keys())}")

    log_path = LOG_FILES[file]
    if not os.path.exists(log_path):
        return {"entries": [], "file": file, "total": 0}

    try:
        # Read all lines and keep the last N (after optional filtering)
        # Use deque for memory-efficient tail reading
        entries = []
        with open(log_path, "r", encoding="utf-8") as f:
            # If filtering by level, we need to read more lines to get enough matches
            if level:
                level_upper = level.upper()
                tail = deque(f, maxlen=lines * 5)  # Read more to account for filtering
                for line in tail:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                        if entry.get("level", "").upper() == level_upper:
                            entries.append(entry)
                    except json.JSONDecodeError:
                        continue
                # Keep only the last N entries after filtering
                entries = entries[-lines:]
            else:
                tail = deque(f, maxlen=lines)
                for line in tail:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue

        return {"entries": entries, "file": file, "total": len(entries)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read log file: {str(e)}")
