
# CUDA Memory Optimization — MUST be set before importing torch
import os
os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

import uuid
import shutil
import asyncio
import uvicorn
from fastapi import FastAPI, HTTPException, Request, UploadFile, Form
from pydantic import BaseModel
from contextlib import asynccontextmanager
import time
import socket
from starlette.concurrency import run_in_threadpool
from worker_logger import setup_worker_logger
from config import get_config

# Load unified configuration (env > yaml > defaults)
_cfg = get_config()
ASR_ENGINE_TYPE = _cfg["engine"]
PORT = _cfg["port"]
SHARED_PATHS = _cfg["shared_paths"]
TEMP_UPLOAD_DIR = _cfg["temp_upload_dir"]
MAX_CONCURRENCY = _cfg.get("max_concurrency", 1)
MODELS_DIR = _cfg.get("model_base_path") or os.path.join(os.path.dirname(__file__), "models")
MODEL_STATE_DIR = _cfg.get("model_state_path") or MODELS_DIR
os.makedirs(TEMP_UPLOAD_DIR, exist_ok=True)

_queue_depth = 0  # Track how many requests are waiting

# Initialize Logger
logger = setup_worker_logger(ASR_ENGINE_TYPE)

# ── EngineManager setup ──
from management.model_state import ModelStateManager
from management.engine_loader import EngineManager
from management.routes import router as management_router, init_routes

_model_state = ModelStateManager(MODELS_DIR, MODEL_STATE_DIR)
_model_state.load()

engine_manager = EngineManager(_model_state, max_concurrency=MAX_CONCURRENCY)

# Inject dependencies into management routes
init_routes(engine_manager, _model_state, MODELS_DIR)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting ASR Worker (engine={ASR_ENGINE_TYPE}, port={PORT})")

    # Load engine: prefer model_state (multi-model), fallback to config (legacy)
    active_model = _model_state.get_active_model_id()
    if active_model and _model_state.is_installed(active_model):
        # Multi-model path: load last active model from state
        try:
            await engine_manager.auto_load()
        except Exception as e:
            logger.error(f"Failed to auto-load model {active_model}: {e}")
    else:
        # Legacy path: load engine from config (same behavior as before)
        try:
            await engine_manager.load_from_config(ASR_ENGINE_TYPE)
        except ImportError as e:
            logger.error(f"Failed to load {ASR_ENGINE_TYPE}: {e}")
            # Don't raise — worker starts without a model, management API still works
            logger.warning("Worker started without a loaded model. Use /management/models to install and activate one.")
        except Exception as e:
            logger.error(f"Failed to load {ASR_ENGINE_TYPE}: {e}")
            logger.warning("Worker started without a loaded model. Use /management/models to install and activate one.")

    # Auto-register with DiTing Server if configured
    server_url = _cfg.get("server_url")
    if server_url:
        asyncio.create_task(_register_with_server(server_url))

    yield
    logger.info("Shutting down ASR Worker")

    # Cleanup: unload engine
    if engine_manager.is_loaded:
        try:
            await engine_manager.unload()
        except Exception as e:
            logger.warning(f"Error during shutdown unload: {e}")


async def _register_with_server(server_url: str):
    """Register with DiTing Server on startup, negotiate shared_paths."""
    import httpx
    from urllib.parse import urlparse

    # Determine advertise_url: if server is on localhost, use localhost too
    advertise_url = _cfg.get("advertise_url")
    if not advertise_url:
        server_host = urlparse(server_url).hostname or ""
        if server_host in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            advertise_url = f"http://127.0.0.1:{PORT}"
        else:
            advertise_url = f"http://{_get_local_ip()}:{PORT}"

    gpu_info = _get_gpu_info()
    model_id = _get_model_id()

    payload = {
        "engine": engine_manager.active_engine_name or ASR_ENGINE_TYPE,
        "url": advertise_url,
        "gpu": gpu_info,
        "device": _cfg.get("device", "cpu"),
        "model_id": model_id,
        "management": True,  # Signal that this worker supports management API
    }

    # Retry with backoff (server may not be up yet)
    for attempt in range(5):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(
                    f"{server_url.rstrip('/')}/api/asr/workers/register",
                    json=payload,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    logger.info(f"Registered with server: {server_url}")
                    _negotiate_shared_paths(data.get("data_paths", []))
                    return
                else:
                    logger.warning(f"Registration attempt {attempt+1}: HTTP {resp.status_code}")
        except Exception as e:
            logger.warning(f"Registration attempt {attempt+1} failed: {e}")
        await asyncio.sleep(5 * (attempt + 1))

    logger.error("Failed to register with server after 5 attempts")


def _negotiate_shared_paths(server_data_paths: list):
    """Check if server paths are accessible locally, update SHARED_PATHS."""
    global SHARED_PATHS
    negotiated = []
    for sp in server_data_paths:
        if os.path.isdir(sp):
            negotiated.append(sp)
            logger.info(f"Shared path negotiated: {sp}")

    if negotiated:
        SHARED_PATHS = negotiated
        logger.info(f"shared_paths updated: {SHARED_PATHS}")
    else:
        logger.info("No shared paths detected, using upload mode")


def _get_local_ip() -> str:
    """Get the local LAN IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def _get_gpu_info() -> dict | None:
    """Collect GPU info for registration payload."""
    try:
        import torch
        if torch.cuda.is_available():
            return {
                "name": torch.cuda.get_device_name(0),
                "total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
            }
    except Exception:
        pass
    return None


def _get_model_id() -> str | None:
    """Get current model ID — prefer EngineManager, fallback to config."""
    if engine_manager.active_model_id:
        return engine_manager.active_model_id
    models = _cfg.get("models", {})
    engine_cfg = models.get(ASR_ENGINE_TYPE, {})
    return engine_cfg.get("model_id") or engine_cfg.get("model_name")

app = FastAPI(lifespan=lifespan)

# Mount management router
app.include_router(management_router)

class TranscribeRequest(BaseModel):
    audio_path: str
    language: str = "zh"
    output_format: str = "text" # text | srt | srt_char
    prompt: str = None

@app.get("/health")
async def health():
    gpu_info = None
    try:
        import torch
        if torch.cuda.is_available():
            gpu_info = {
                "name": torch.cuda.get_device_name(0),
                "total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
                "allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
                "reserved_gb": round(torch.cuda.memory_reserved() / 1024**3, 2),
            }
    except Exception:
        pass

    status = engine_manager.get_status()
    return {
        "status": "ok",
        "engine": status["engine"] or ASR_ENGINE_TYPE,
        "loaded": status["loaded"],
        "gpu": gpu_info,
        "device": _cfg.get("device", "cpu"),
        "model_id": _get_model_id(),
        "shared_paths": SHARED_PATHS,
        "concurrency": {
            "max": MAX_CONCURRENCY,
            "queue": _queue_depth,
        },
        "management": True,
    }

@app.get("/gpu-status")
async def gpu_status():
    """Detailed GPU memory status for monitoring OOM risk."""
    try:
        import torch
        if not torch.cuda.is_available():
            return {"available": False, "message": "CUDA not available"}
        return {
            "available": True,
            "device": torch.cuda.get_device_name(0),
            "total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2),
            "allocated_gb": round(torch.cuda.memory_allocated() / 1024**3, 2),
            "reserved_gb": round(torch.cuda.memory_reserved() / 1024**3, 2),
            "free_gb": round((torch.cuda.get_device_properties(0).total_memory - torch.cuda.memory_allocated()) / 1024**3, 2),
            "peak_gb": round(torch.cuda.max_memory_allocated() / 1024**3, 2),
        }
    except Exception as e:
        return {"available": False, "error": str(e)}

def _do_transcribe(audio_path: str, language: str, prompt: str, output_format: str) -> dict:
    """Core transcription logic shared by path mode and upload mode."""
    recognizer = engine_manager.recognizer
    engine_name = engine_manager.active_engine_name or ASR_ENGINE_TYPE

    if not recognizer:
        raise HTTPException(status_code=503, detail="ASR Engine not loaded")

    if not os.path.exists(audio_path):
        raise HTTPException(status_code=400, detail=f"Audio file not found: {audio_path}")

    logger.info(f"Received Task: {audio_path} | Lang: {language} | Prompt: {prompt}")
    start_time = time.time()

    try:
        if output_format == "srt":
            result = recognizer.generate_srt(audio_path, language, prompt)
        elif output_format == "srt_char":
            # Per-character SRT (Qwen3-ASR only, others fallback to standard srt)
            if hasattr(recognizer, 'generate_srt_char'):
                result = recognizer.generate_srt_char(audio_path, language, prompt)
            else:
                logger.warning(f"Engine {engine_name} does not support srt_char, falling back to srt")
                result = recognizer.generate_srt(audio_path, language, prompt)
        else:
            result = recognizer.predict(audio_path, language, prompt)

        duration = time.time() - start_time
        logger.info(f"Completed in {duration:.2f}s")
        return {"text": result, "engine": engine_name}
    except Exception as e:
        logger.error(f"Transcription Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/transcribe")
async def transcribe(request: Request):
    """
    Unified transcribe endpoint with concurrency control.
    - Supports JSON (path mode) and multipart (upload mode) via Content-Type.
    - Queues excess requests via Semaphore to prevent GPU OOM.
    - Returns 503 during model switch.
    """
    global _queue_depth

    # Check if model is switching
    if engine_manager.is_switching:
        raise HTTPException(
            status_code=503,
            detail="Model switching in progress",
            headers={"Retry-After": "30"},
        )

    content_type = request.headers.get("content-type", "")

    # ── Parse request params BEFORE acquiring semaphore (don't hold GPU lock during I/O) ──
    temp_path = None
    if "multipart" in content_type:
        form = await request.form()
        upload_file: UploadFile = form.get("file")
        if not upload_file:
            raise HTTPException(status_code=400, detail="No file provided in upload mode")
        language = form.get("language", "zh")
        output_format = form.get("output_format", "text")
        prompt = form.get("prompt", "") or None
        ext = os.path.splitext(upload_file.filename)[1] if upload_file.filename else ".wav"
        temp_path = os.path.join(TEMP_UPLOAD_DIR, f"{uuid.uuid4()}{ext}")
        logger.info(f"Upload mode: saving to {temp_path}")
        with open(temp_path, "wb") as f:
            shutil.copyfileobj(upload_file.file, f)
        audio_path = temp_path
    else:
        body = await request.json()
        req = TranscribeRequest(**body)
        audio_path, language, prompt, output_format = req.audio_path, req.language, req.prompt, req.output_format

    # ── Queue for GPU access (semaphore owned by EngineManager) ──
    _queue_depth += 1
    _gpu_semaphore = engine_manager.gpu_semaphore
    if _gpu_semaphore.locked():
        logger.info(f"Queued (waiting: {_queue_depth}) -- {os.path.basename(audio_path)}")
    try:
        async with _gpu_semaphore:
            _queue_depth -= 1
            # Double-check switching flag after acquiring semaphore
            if engine_manager.is_switching:
                raise HTTPException(
                    status_code=503,
                    detail="Model switching in progress",
                    headers={"Retry-After": "30"},
                )
            result = await run_in_threadpool(_do_transcribe, audio_path, language, prompt, output_format)
            return result
    except Exception:
        _queue_depth = max(0, _queue_depth - 1)
        raise
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=PORT)
