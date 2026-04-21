"""EngineManager — load/unload/switch ASR engines at runtime.

Replaces the global `recognizer` in main.py. Manages a single loaded engine
at a time with safe model switching (draining in-flight requests, freeing VRAM).
"""

import asyncio
import gc
import logging
import time

from starlette.concurrency import run_in_threadpool

from .catalog import MODELS, ModelInfo
from .model_state import ModelStateManager

logger = logging.getLogger(__name__)


class EngineManager:
    """Singleton manager for ASR engine lifecycle."""

    def __init__(self, model_state: ModelStateManager, max_concurrency: int = 1):
        self._recognizer = None
        self._active_model_id: str | None = None
        self._active_engine_name: str | None = None
        self._lock = asyncio.Lock()
        self._switching = False
        self._gpu_semaphore = asyncio.Semaphore(max_concurrency)
        self._max_concurrency = max_concurrency
        self._model_state = model_state

    @property
    def recognizer(self):
        return self._recognizer

    @property
    def active_model_id(self) -> str | None:
        return self._active_model_id

    @property
    def active_engine_name(self) -> str | None:
        return self._active_engine_name

    @property
    def is_switching(self) -> bool:
        return self._switching

    @property
    def is_loaded(self) -> bool:
        return self._recognizer is not None

    @property
    def gpu_semaphore(self) -> asyncio.Semaphore:
        return self._gpu_semaphore

    def get_status(self) -> dict:
        """Return current engine status for /health endpoint."""
        return {
            "loaded": self._recognizer is not None,
            "engine": self._active_engine_name,
            "model_id": self._active_model_id,
            "switching": self._switching,
        }

    async def auto_load(self):
        """Load last active model from persisted state. Called during lifespan startup."""
        model_id = self._model_state.get_active_model_id()
        if model_id and self._model_state.is_installed(model_id):
            logger.info(f"Auto-loading last active model: {model_id}")
            try:
                await self._load_engine(model_id)
            except Exception as e:
                logger.error(f"Failed to auto-load model {model_id}: {e}")
        else:
            logger.info("No active model to auto-load")

    async def load_from_config(self, engine_type: str):
        """Load engine using the legacy config-based approach (backward compat).

        Used when no model_state exists yet — loads whatever engine is configured
        in worker_config.yaml / env vars, same as the old lifespan behavior.
        """
        if self._recognizer is not None:
            return  # Already loaded

        logger.info(f"Loading engine from config: {engine_type}")
        try:
            engine = await run_in_threadpool(self._create_engine_from_config, engine_type)
            self._recognizer = engine
            self._active_engine_name = engine_type
            # Try to find matching catalog model id
            self._active_model_id = self._find_catalog_id_for_engine(engine_type)
            if self._active_model_id and self._model_state.is_installed(self._active_model_id):
                self._model_state.set_active(self._active_model_id)
            logger.info(f"Engine loaded from config: {engine_type}")
        except Exception as e:
            logger.error(f"Failed to load engine {engine_type}: {e}")
            raise

    async def activate(self, model_id: str) -> dict:
        """Switch to a different model. Returns operation status.

        Switch flow:
        1. Acquire lock
        2. Set switching flag (new /transcribe requests get 503)
        3. Wait for in-flight transcriptions to finish
        4. Unload current engine
        5. Load new engine
        6. Update state
        """
        model = MODELS.get(model_id)
        if not model:
            raise ValueError(f"Unknown model: {model_id}")

        if not self._model_state.is_installed(model_id):
            raise ValueError(f"Model {model_id} is not installed")

        if model_id == self._active_model_id and self._recognizer is not None:
            return {"status": "already_active", "model_id": model_id}

        async with self._lock:
            old_model = self._active_model_id
            self._switching = True
            logger.info(f"Switching model: {old_model} -> {model_id}")

            try:
                # Wait for in-flight transcriptions to finish
                await self._drain_semaphore()

                # Unload current engine
                if self._recognizer is not None:
                    logger.info(f"Unloading engine: {self._active_engine_name}")
                    self._recognizer.unload()
                    self._recognizer = None
                    self._active_engine_name = None
                    self._active_model_id = None
                    gc.collect()
                    self._cleanup_gpu_cache()

                # Load new engine
                await self._load_engine(model_id)

                return {
                    "status": "activated",
                    "from": old_model,
                    "to": model_id,
                }
            except Exception as e:
                logger.error(f"Failed to switch to {model_id}: {e}")
                raise
            finally:
                self._switching = False
                self._release_semaphore()

    async def unload(self):
        """Unload current engine, freeing all resources."""
        async with self._lock:
            if self._recognizer is None:
                return {"status": "not_loaded"}

            self._switching = True
            try:
                await self._drain_semaphore()

                model_id = self._active_model_id
                logger.info(f"Unloading engine: {self._active_engine_name}")
                self._recognizer.unload()
                self._recognizer = None
                self._active_engine_name = None
                self._active_model_id = None
                gc.collect()
                self._cleanup_gpu_cache()

                self._model_state.set_active(None)
                return {"status": "unloaded", "model_id": model_id}
            finally:
                self._switching = False
                self._release_semaphore()

    async def _load_engine(self, model_id: str):
        """Import and construct an engine for the given catalog model."""
        model = MODELS[model_id]
        installed = self._model_state.get_installed_model(model_id)
        model_path = installed.model_path if installed else None

        engine = await run_in_threadpool(
            self._create_engine_for_model, model, model_path
        )
        self._recognizer = engine
        self._active_model_id = model_id
        self._active_engine_name = model.engine
        self._model_state.set_active(model_id)
        logger.info(f"Engine loaded: {model.engine} / {model_id}")

    def _create_engine_for_model(self, model: ModelInfo, model_path: str | None):
        """Create engine instance with model-specific overrides. Runs in threadpool."""
        from config import get_config
        cfg = get_config()
        device = cfg.get("device", "cuda:0")

        if model.engine == "sensevoice":
            from engines.sensevoice import SenseVoiceEngine
            return SenseVoiceEngine(
                model_id=model.model_id,
                device=device,
                cache_dir=model_path or None,
            )
        elif model.engine == "whisper":
            from engines.whisper import WhisperEngine
            # For whisper, model_path is directory, model_name is the size name
            download_root = None
            if model_path and not model_path.endswith(".pt"):
                download_root = model_path
            elif model_path:
                import os
                download_root = os.path.dirname(model_path)
            return WhisperEngine(
                model_path=download_root,
                model_name=model.whisper_model_name or model.model_id,
            )
        elif model.engine == "qwen3asr":
            from engines.qwen3asr import Qwen3ASREngine
            return Qwen3ASREngine(
                model_name=model.model_id,
                device=device,
            )
        else:
            raise ValueError(f"Unknown engine: {model.engine}")

    def _create_engine_from_config(self, engine_type: str):
        """Create engine using config defaults (legacy path). Runs in threadpool."""
        if engine_type == "sensevoice":
            from engines.sensevoice import SenseVoiceEngine
            return SenseVoiceEngine()
        elif engine_type == "whisper":
            from engines.whisper import WhisperEngine
            return WhisperEngine()
        elif engine_type == "qwen3asr":
            from engines.qwen3asr import Qwen3ASREngine
            return Qwen3ASREngine()
        else:
            raise ValueError(f"Unknown engine: {engine_type}")

    def _find_catalog_id_for_engine(self, engine_type: str) -> str | None:
        """Try to match a config-loaded engine to a catalog model ID."""
        from config import get_engine_config
        ecfg = get_engine_config(engine_type)

        if engine_type == "sensevoice":
            model_id_cfg = ecfg.get("model_id", "iic/SenseVoiceSmall")
            for mid, m in MODELS.items():
                if m.engine == "sensevoice" and m.model_id == model_id_cfg:
                    return mid
        elif engine_type == "whisper":
            model_name_cfg = ecfg.get("model_name", "large-v3-turbo")
            for mid, m in MODELS.items():
                if m.engine == "whisper" and m.whisper_model_name == model_name_cfg:
                    return mid
        elif engine_type == "qwen3asr":
            for mid, m in MODELS.items():
                if m.engine == "qwen3asr":
                    return mid
        return None

    async def _drain_semaphore(self):
        """Acquire all semaphore permits to wait for in-flight transcriptions."""
        for _ in range(self._max_concurrency):
            await self._gpu_semaphore.acquire()

    def _release_semaphore(self):
        """Release all semaphore permits after switch."""
        for _ in range(self._max_concurrency):
            try:
                self._gpu_semaphore.release()
            except ValueError:
                break

    def _cleanup_gpu_cache(self):
        """Clear GPU cache after model unload."""
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
                logger.info("GPU cache cleared")
        except ImportError:
            pass
