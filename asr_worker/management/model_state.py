"""Track installed models and active model via JSON persistence.

State file layout (persisted to {models_dir}/model_state.json):
{
  "installed": {
    "sensevoice_small": {
      "engine": "sensevoice",
      "catalog_model_id": "iic/SenseVoiceSmall",
      "installed_at": "2025-03-15T10:30:00Z",
      "model_path": "models/iic/SenseVoiceSmall"
    }
  },
  "active_model_id": "sensevoice_small"
}
"""

import json
import os
import logging
from datetime import datetime, timezone
from dataclasses import dataclass, field, asdict

from .catalog import MODELS, ModelInfo

logger = logging.getLogger(__name__)

STATE_FILENAME = "model_state.json"


@dataclass
class InstalledModel:
    engine: str
    catalog_model_id: str
    installed_at: str
    model_path: str


@dataclass
class ModelState:
    installed: dict[str, InstalledModel] = field(default_factory=dict)
    active_model_id: str | None = None


class ModelStateManager:
    """Manages installed model tracking with JSON persistence."""

    def __init__(self, models_dir: str):
        self.models_dir = models_dir
        self._state_path = os.path.join(models_dir, STATE_FILENAME)
        self._state = ModelState()
        os.makedirs(models_dir, exist_ok=True)

    def load(self):
        """Load state from disk, then auto-detect any pre-existing models."""
        self._load_from_disk()
        self._detect_installed()
        self._save_to_disk()

    def _load_from_disk(self):
        """Load state from JSON file."""
        if not os.path.exists(self._state_path):
            logger.info("No model_state.json found, starting fresh")
            return
        try:
            with open(self._state_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            installed = {}
            for mid, info in data.get("installed", {}).items():
                installed[mid] = InstalledModel(
                    engine=info["engine"],
                    catalog_model_id=info["catalog_model_id"],
                    installed_at=info["installed_at"],
                    model_path=info["model_path"],
                )
            self._state = ModelState(
                installed=installed,
                active_model_id=data.get("active_model_id"),
            )
            logger.info(f"Loaded model state: {len(installed)} installed, active={self._state.active_model_id}")
        except Exception as e:
            logger.warning(f"Failed to load model_state.json: {e}")

    def _save_to_disk(self):
        """Persist state to JSON file."""
        data = {
            "installed": {},
            "active_model_id": self._state.active_model_id,
        }
        for mid, info in self._state.installed.items():
            data["installed"][mid] = asdict(info)
        try:
            with open(self._state_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Failed to save model_state.json: {e}")

    def _detect_installed(self):
        """Scan disk to auto-detect pre-existing models not in state."""
        detected = 0

        for model_id, model in MODELS.items():
            if model_id in self._state.installed:
                # Verify still exists on disk
                expected_path = self._get_model_path(model)
                if not os.path.exists(expected_path):
                    logger.warning(f"Model {model_id} in state but missing on disk: {expected_path}")
                    del self._state.installed[model_id]
                continue

            # Check if model files exist on disk
            model_path = self._detect_model_on_disk(model)
            if model_path:
                self._state.installed[model_id] = InstalledModel(
                    engine=model.engine,
                    catalog_model_id=model.model_id,
                    installed_at=datetime.now(timezone.utc).isoformat(),
                    model_path=model_path,
                )
                detected += 1
                logger.info(f"Auto-detected model: {model_id} at {model_path}")

        if detected:
            logger.info(f"Auto-detected {detected} pre-existing model(s)")

        # Validate active_model_id
        if self._state.active_model_id and self._state.active_model_id not in self._state.installed:
            logger.warning(f"Active model '{self._state.active_model_id}' not installed, clearing")
            self._state.active_model_id = None

    def _detect_model_on_disk(self, model: ModelInfo) -> str | None:
        """Check if a model's files exist in models_dir."""
        if model.engine == "sensevoice":
            # ModelScope cache layout: {models_dir}/iic/SenseVoiceSmall/
            path = os.path.join(self.models_dir, model.model_id)
            if os.path.isdir(path):
                return path

        elif model.engine == "whisper":
            # Whisper downloads: {models_dir}/{name}.pt
            name = model.whisper_model_name or model.model_id
            pt_file = os.path.join(self.models_dir, f"{name}.pt")
            if os.path.isfile(pt_file):
                return pt_file

        elif model.engine == "qwen3asr":
            # HuggingFace cache layout: {models_dir}/models--Qwen--Qwen3-ASR-1.7B/
            hf_cache_name = model.model_id.replace("/", "--")
            path = os.path.join(self.models_dir, f"models--{hf_cache_name}")
            if os.path.isdir(path):
                return path

        return None

    def _get_model_path(self, model: ModelInfo) -> str:
        """Get the expected model path for a catalog model."""
        if model.engine == "sensevoice":
            return os.path.join(self.models_dir, model.model_id)
        elif model.engine == "whisper":
            name = model.whisper_model_name or model.model_id
            return os.path.join(self.models_dir, f"{name}.pt")
        elif model.engine == "qwen3asr":
            hf_cache_name = model.model_id.replace("/", "--")
            return os.path.join(self.models_dir, f"models--{hf_cache_name}")
        return os.path.join(self.models_dir, model.model_id)

    # ── Public API ──

    def mark_installed(self, model_id: str, model_path: str):
        """Mark a model as installed after successful download."""
        model = MODELS.get(model_id)
        if not model:
            raise ValueError(f"Unknown model: {model_id}")
        self._state.installed[model_id] = InstalledModel(
            engine=model.engine,
            catalog_model_id=model.model_id,
            installed_at=datetime.now(timezone.utc).isoformat(),
            model_path=model_path,
        )
        self._save_to_disk()
        logger.info(f"Model {model_id} marked as installed at {model_path}")

    def mark_uninstalled(self, model_id: str):
        """Remove a model from installed state."""
        if model_id in self._state.installed:
            del self._state.installed[model_id]
            if self._state.active_model_id == model_id:
                self._state.active_model_id = None
            self._save_to_disk()
            logger.info(f"Model {model_id} marked as uninstalled")

    def set_active(self, model_id: str | None):
        """Set the active model. None means no model loaded."""
        if model_id is not None and model_id not in self._state.installed:
            raise ValueError(f"Model {model_id} is not installed")
        self._state.active_model_id = model_id
        self._save_to_disk()

    def get_active_model_id(self) -> str | None:
        return self._state.active_model_id

    def get_installed(self) -> dict[str, InstalledModel]:
        return dict(self._state.installed)

    def is_installed(self, model_id: str) -> bool:
        return model_id in self._state.installed

    def get_installed_model(self, model_id: str) -> InstalledModel | None:
        return self._state.installed.get(model_id)

    def get_model_path(self, model_id: str) -> str | None:
        """Get the on-disk path for an installed model."""
        info = self._state.installed.get(model_id)
        return info.model_path if info else None
