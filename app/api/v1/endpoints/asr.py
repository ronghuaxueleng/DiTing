from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Dict, List, Optional
from app.asr.client import asr_client

router = APIRouter(tags=["ASR Config"])

class ASRConfigUpdate(BaseModel):
    priority: Optional[List[str]] = None
    strict_mode: Optional[bool] = None
    active_engine: Optional[str] = None
    disabled_engines: Optional[List[str]] = None

@router.get("/status")
async def get_asr_status(refresh: bool = False):
    """
    Get status of all ASR engines.
    If refresh=True, performs an immediate health check.
    """
    if refresh:
        await asr_client.check_health()
    return asr_client.get_status()

@router.post("/config")
async def update_asr_config(config: ASRConfigUpdate):
    """
    Update ASR runtime configuration (priority, strict mode, active engine).
    """
    asr_client.update_config(
        priority=config.priority, 
        strict_mode=config.strict_mode, 
        active_engine=config.active_engine,
        disabled_engines=config.disabled_engines
    )
    return {"status": "updated", "config": asr_client.config}


class WorkerURLsUpdate(BaseModel):
    workers: Dict[str, str]


@router.put("/workers")
async def update_workers(body: WorkerURLsUpdate):
    """
    Replace the full worker URL map at runtime. Triggers a health check after update.
    Example: {"workers": {"sensevoice": "http://localhost:8001", "whisper": "http://gpu:8002"}}
    """
    # Basic URL validation
    for engine, url in body.workers.items():
        if not url.startswith("http"):
            raise HTTPException(status_code=422, detail=f"Invalid URL for engine '{engine}': must start with http or https")

    asr_client.update_workers(body.workers)
    # Run health check to immediately reflect new worker status
    await asr_client.check_health()
    return asr_client.get_status()


@router.delete("/workers/{engine}")
async def remove_worker(engine: str):
    """
    Remove a single worker engine at runtime.
    """
    try:
        asr_client.remove_worker(engine)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await asr_client.check_health()
    return asr_client.get_status()
