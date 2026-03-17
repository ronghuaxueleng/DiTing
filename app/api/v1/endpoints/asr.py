from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Dict, List, Optional
from app.asr.client import asr_client

router = APIRouter(tags=["ASR Config"])

class ASRConfigUpdate(BaseModel):
    priority: Optional[List[str]] = None
    strict_mode: Optional[bool] = None
    active_engine: Optional[str] = None
    disabled_engines: Optional[List[str]] = None


class WorkerRegisterRequest(BaseModel):
    engine: str
    url: str
    gpu: Optional[dict] = None
    device: Optional[str] = None
    model_id: Optional[str] = None
    version: Optional[str] = None
    management: Optional[bool] = None

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
    """Accepts multiple formats for backward compat:
    - Old: {"workers": {"sensevoice": "http://localhost:8001"}}
    - New: {"workers": {"localhost:8001": {"url": "http://localhost:8001"}}}
    - URL-keyed: {"workers": {"http://localhost:8001": {}}}
    - URL list: {"urls": ["http://localhost:8001"]}
    """
    workers: Optional[Dict] = None
    urls: Optional[List[str]] = None


@router.put("/workers")
async def update_workers(body: WorkerURLsUpdate):
    """
    Replace the full worker URL map at runtime. Triggers a health check after update.
    Accepts old {engine: url} or new {worker_id: {url}} format.
    """
    if body.urls:
        # URL list format → convert to {url: {}} format
        workers = {url: {} for url in body.urls}
    elif body.workers:
        workers = body.workers
    else:
        raise HTTPException(status_code=422, detail="Must provide 'workers' or 'urls'")

    # Basic URL validation: check values or keys are valid URLs
    for key, val in workers.items():
        url = val if isinstance(val, str) else (val.get("url", "") if isinstance(val, dict) else key)
        if isinstance(val, str) and not val.startswith("http"):
            if not key.startswith("http") and ":" not in key:
                raise HTTPException(status_code=422, detail=f"Invalid URL for '{key}': must start with http or be a valid worker_id")

    asr_client.update_workers(workers)
    await asr_client.check_health()
    return asr_client.get_status()


@router.delete("/workers/{worker_id}")
async def remove_worker(worker_id: str):
    """
    Remove a single worker at runtime by worker_id (e.g. "localhost:8001").
    """
    try:
        asr_client.remove_worker(worker_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    await asr_client.check_health()
    return asr_client.get_status()


@router.post("/workers/register")
async def register_worker(body: WorkerRegisterRequest):
    """
    Register a worker (called by the worker itself on startup).
    Returns server data paths for shared_paths negotiation.
    """
    if not body.url.startswith("http"):
        raise HTTPException(status_code=422, detail="Invalid URL: must start with http or https")
    result = asr_client.register_worker(
        engine=body.engine,
        url=body.url,
        metadata=body.model_dump(exclude={"engine", "url"}),
    )
    await asr_client.check_health()
    return result


# ── Worker Management Proxy ──

@router.api_route("/workers/{worker_key}/management/{path:path}", methods=["GET", "POST", "DELETE"])
async def proxy_worker_management(worker_key: str, path: str, request: Request):
    """
    Proxy management API calls to a worker.
    Frontend calls e.g. GET /api/asr/workers/localhost:8001/management/models
    and server proxies to the worker's /management/models endpoint.
    """
    body = None
    if request.method in ("POST", "DELETE"):
        try:
            body = await request.json()
        except Exception:
            body = None

    try:
        result = await asr_client.proxy_management(
            worker_key=worker_key,
            method=request.method,
            path=path,
            body=body,
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
