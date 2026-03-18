"""ASR Workers management endpoints (bulk)."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Optional
from app.asr.client import asr_client

router = APIRouter(tags=["ASR Workers Bulk"])

class BulkWorkersUpdate(BaseModel):
    workers: List[Dict]
    # each dict can be {"url": "http://...", "engine": "sensevoice", "metadata": {...}}

@router.post("/workers/bulk")
async def bulk_update_workers(body: BulkWorkersUpdate):
    """Replace the entire worker map with a list of workers.

    The client accepts a list of worker definitions, converts them to the
    internal mapping, persists them, and triggers a health check.
    Returns operation IDs for each worker (for UI polling).
    """
    if not body.workers:
        raise HTTPException(status_code=422, detail="workers list cannot be empty")
    # Convert list to dict format expected by ASRClient.update_workers
    workers_dict = {w.get("url"): w.get("metadata", {}) for w in body.workers if w.get("url")}
    # Perform update
    asr_client.update_workers(workers_dict)
    # Trigger health check (no await, fire and forget)
    # Note: start_health_check runs in background; we just do a single check now
    await asr_client.check_health()
    # Return current status (includes operation IDs if any future ops)
    return asr_client.get_status()
