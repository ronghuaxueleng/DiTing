"""Management API routes for the ASR Worker.

All endpoints under /management prefix. Provides hardware info, model catalog,
install/uninstall/activate models, and engine dependency management.
Background operations return an operation_id for polling or SSE streaming.
"""

import asyncio
import logging
import os
import shutil
import time
import uuid
from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, HTTPException, Request, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/management", tags=["Management"])

# ── Background operation tracking ──

_operations: dict[str, dict] = {}
_OP_EXPIRY_SECONDS = 300  # Auto-expire completed ops after 5 minutes


class _OpStatus:
    STARTED = "started"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


def _create_op(op_type: str, detail: str = "") -> str:
    _expire_old_ops()
    op_id = f"op_{uuid.uuid4().hex[:12]}"
    _operations[op_id] = {
        "id": op_id,
        "type": op_type,
        "status": _OpStatus.STARTED,
        "detail": detail,
        "progress": [],
        "result": None,
        "error": None,
        "created_at": time.time(),
        "completed_at": None,
    }
    return op_id


def _update_op(op_id: str, **kwargs):
    if op_id in _operations:
        _operations[op_id].update(kwargs)


def _op_progress(op_id: str, message: str):
    if op_id in _operations:
        _operations[op_id]["progress"].append(message)


def _complete_op(op_id: str, result=None, error=None):
    if op_id in _operations:
        _operations[op_id]["status"] = _OpStatus.FAILED if error else _OpStatus.COMPLETED
        _operations[op_id]["result"] = result
        _operations[op_id]["error"] = error
        _operations[op_id]["completed_at"] = time.time()


def _expire_old_ops():
    now = time.time()
    expired = [
        oid for oid, op in _operations.items()
        if op["completed_at"] and (now - op["completed_at"]) > _OP_EXPIRY_SECONDS
    ]
    for oid in expired:
        del _operations[oid]


# ── Dependency: EngineManager and ModelStateManager are injected at mount time ──

_engine_manager = None
_model_state = None
_models_dir = None


def init_routes(engine_manager, model_state, models_dir: str):
    """Called from main.py to inject dependencies."""
    global _engine_manager, _model_state, _models_dir
    _engine_manager = engine_manager
    _model_state = model_state
    _models_dir = models_dir


# ── Request/Response models ──

class DownloadRequest(BaseModel):
    use_mirror: bool = False
    proxy: str = ""


class ActivateRequest(BaseModel):
    pass  # No params needed, model_id comes from path


class DepsInstallRequest(BaseModel):
    use_mirror: bool = False
    proxy: str = ""


class PyTorchInstallRequest(BaseModel):
    compute_key: str  # cu121, cu124, cpu, mps
    use_mirror: bool = False
    proxy: str = ""


# ── Hardware ──

@router.get("/hardware")
async def get_hardware():
    """Hardware info + PyTorch status."""
    from .hardware.detector import detect_hardware
    from .dep_manager import check_pytorch

    hw = detect_hardware()
    pytorch = check_pytorch()
    return {
        "hardware": asdict(hw),
        "pytorch": pytorch,
    }


# ── Model catalog ──

@router.get("/models")
async def list_models():
    """Full model catalog merged with install/active state."""
    from .catalog import get_all_models, recommend_models
    from .hardware.detector import detect_hardware
    from .dep_manager import check_engine_deps

    hw = detect_hardware()
    recommendations = recommend_models(hw)
    installed = _model_state.get_installed()
    active_id = _model_state.get_active_model_id()

    result = []
    for rec in recommendations:
        m = rec.model
        is_installed = m.id in installed
        deps_status = check_engine_deps(m.engine)
        result.append({
            "id": m.id,
            "engine": m.engine,
            "model_id": m.model_id,
            "display_name": m.display_name,
            "download_size_mb": m.download_size_mb,
            "vram_required_mb": m.vram_required_mb,
            "accuracy": m.accuracy,
            "speed": m.speed,
            "supports_mps": m.supports_mps,
            "description": m.description,
            "tags": rec.tags,
            "compatible": rec.compatible,
            "reason": rec.reason,
            "installed": is_installed,
            "active": m.id == active_id,
            "deps_installed": deps_status["installed"],
        })
    return {"models": result, "active_model_id": active_id}


@router.get("/models/installed")
async def list_installed_models():
    """Installed models + active model."""
    installed = _model_state.get_installed()
    active_id = _model_state.get_active_model_id()
    result = {}
    for mid, info in installed.items():
        result[mid] = {
            "engine": info.engine,
            "catalog_model_id": info.catalog_model_id,
            "installed_at": info.installed_at,
            "model_path": info.model_path,
            "active": mid == active_id,
        }
    return {"installed": result, "active_model_id": active_id}


# ── Model download ──

@router.post("/models/{model_id}/download")
async def download_model(model_id: str, body: DownloadRequest = DownloadRequest()):
    """Start model download in background."""
    from .catalog import get_model
    model = get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")

    if _model_state.is_installed(model_id):
        return {"status": "already_installed", "model_id": model_id}

    op_id = _create_op("download", f"Downloading {model.display_name}")
    _update_op(op_id, status=_OpStatus.RUNNING)

    asyncio.create_task(_bg_download(op_id, model, body.use_mirror, body.proxy))
    return {"operation_id": op_id, "status": "started", "model_id": model_id}


async def _bg_download(op_id: str, model, use_mirror: bool, proxy: str):
    from .model_downloader import download_model as do_download
    try:
        model_path = await do_download(
            model=model,
            models_dir=_models_dir,
            use_mirror=use_mirror,
            proxy=proxy,
            on_progress=lambda msg: _op_progress(op_id, msg),
        )
        _model_state.mark_installed(model.id, model_path)
        _complete_op(op_id, result={"model_id": model.id, "model_path": model_path})
    except Exception as e:
        logger.error(f"Download failed for {model.id}: {e}")
        _complete_op(op_id, error=str(e))


# ── Model activate / unload ──

@router.post("/models/{model_id}/activate")
async def activate_model(model_id: str):
    """Switch active model (unloads current, loads new). Background operation."""
    from .catalog import get_model
    model = get_model(model_id)
    if not model:
        raise HTTPException(status_code=404, detail=f"Unknown model: {model_id}")

    if not _model_state.is_installed(model_id):
        raise HTTPException(status_code=400, detail=f"Model {model_id} is not installed. Download it first.")

    old_model = _engine_manager.active_model_id
    op_id = _create_op("activate", f"Switching {old_model} -> {model_id}")
    _update_op(op_id, status=_OpStatus.RUNNING)

    asyncio.create_task(_bg_activate(op_id, model_id))
    return {
        "operation_id": op_id,
        "status": "switching",
        "from": old_model,
        "to": model_id,
    }


async def _bg_activate(op_id: str, model_id: str):
    try:
        result = await _engine_manager.activate(model_id)
        _complete_op(op_id, result=result)
    except Exception as e:
        logger.error(f"Activation failed for {model_id}: {e}")
        _complete_op(op_id, error=str(e))


@router.post("/models/unload")
async def unload_model():
    """Unload current model, freeing VRAM."""
    result = await _engine_manager.unload()
    return result


# ── Model delete ──

@router.delete("/models/{model_id}")
async def delete_model(model_id: str):
    """Delete model files from disk."""
    if not _model_state.is_installed(model_id):
        raise HTTPException(status_code=404, detail=f"Model {model_id} is not installed")

    # Cannot delete the active model
    if _engine_manager.active_model_id == model_id:
        raise HTTPException(
            status_code=409,
            detail="Cannot delete the active model. Unload it first."
        )

    installed = _model_state.get_installed_model(model_id)
    model_path = installed.model_path if installed else None

    # Remove from state first
    _model_state.mark_uninstalled(model_id)

    # Delete files
    if model_path and os.path.exists(model_path):
        try:
            if os.path.isdir(model_path):
                shutil.rmtree(model_path)
            else:
                os.remove(model_path)
            logger.info(f"Deleted model files: {model_path}")
        except Exception as e:
            logger.warning(f"Failed to delete model files at {model_path}: {e}")
            return {"status": "uninstalled", "model_id": model_id, "files_deleted": False, "error": str(e)}

    return {"status": "deleted", "model_id": model_id, "files_deleted": True}


# ── Engine dependencies ──

@router.get("/engines/{engine}/deps")
async def check_deps(engine: str):
    """Check engine dependency status."""
    from .dep_manager import check_engine_deps, check_pytorch
    deps = check_engine_deps(engine)
    pytorch = check_pytorch()
    return {"engine": engine, "deps": deps, "pytorch": pytorch}


@router.post("/engines/{engine}/deps/install")
async def install_deps(engine: str, body: DepsInstallRequest = DepsInstallRequest()):
    """Install engine dependencies in background."""
    op_id = _create_op("install_deps", f"Installing deps for {engine}")
    _update_op(op_id, status=_OpStatus.RUNNING)

    asyncio.create_task(_bg_install_deps(op_id, engine, body.use_mirror, body.proxy))
    return {"operation_id": op_id, "status": "started", "engine": engine}


async def _bg_install_deps(op_id: str, engine: str, use_mirror: bool, proxy: str):
    from .dep_manager import install_engine_deps
    try:
        await install_engine_deps(
            engine=engine,
            use_mirror=use_mirror,
            proxy=proxy,
            on_progress=lambda msg: _op_progress(op_id, msg),
        )
        _complete_op(op_id, result={"engine": engine})
    except Exception as e:
        logger.error(f"Deps install failed for {engine}: {e}")
        _complete_op(op_id, error=str(e))


# ── PyTorch install ──

@router.post("/compute/install")
async def install_compute(body: PyTorchInstallRequest):
    """Install or switch PyTorch version in background."""
    op_id = _create_op("install_pytorch", f"Installing PyTorch for {body.compute_key}")
    _update_op(op_id, status=_OpStatus.RUNNING)

    asyncio.create_task(_bg_install_pytorch(op_id, body.compute_key, body.use_mirror, body.proxy))
    return {"operation_id": op_id, "status": "started", "compute_key": body.compute_key}


async def _bg_install_pytorch(op_id: str, compute_key: str, use_mirror: bool, proxy: str):
    from .dep_manager import install_pytorch
    try:
        await install_pytorch(
            compute_key=compute_key,
            use_mirror=use_mirror,
            proxy=proxy,
            on_progress=lambda msg: _op_progress(op_id, msg),
        )
        _complete_op(op_id, result={"compute_key": compute_key})
    except Exception as e:
        logger.error(f"PyTorch install failed: {e}")
        _complete_op(op_id, error=str(e))


# ── Operation polling and SSE ──

@router.get("/operations/{op_id}")
async def get_operation(op_id: str):
    """Poll operation progress."""
    op = _operations.get(op_id)
    if not op:
        raise HTTPException(status_code=404, detail=f"Operation not found: {op_id}")
    return op


@router.get("/operations/{op_id}/stream")
async def stream_operation(op_id: str):
    """SSE progress stream for an operation."""
    op = _operations.get(op_id)
    if not op:
        raise HTTPException(status_code=404, detail=f"Operation not found: {op_id}")

    async def event_generator():
        import json
        last_progress_idx = 0
        while True:
            op = _operations.get(op_id)
            if not op:
                yield f"data: {json.dumps({'type': 'error', 'message': 'Operation not found'})}\n\n"
                break

            # Send new progress messages
            new_progress = op["progress"][last_progress_idx:]
            for msg in new_progress:
                yield f"data: {json.dumps({'type': 'progress', 'message': msg})}\n\n"
            last_progress_idx = len(op["progress"])

            # Check if completed
            if op["status"] in (_OpStatus.COMPLETED, _OpStatus.FAILED):
                yield f"data: {json.dumps({'type': 'done', 'status': op['status'], 'result': op['result'], 'error': op['error']})}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
