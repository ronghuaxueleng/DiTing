"""Model downloading with progress tracking."""

import os
import subprocess
import logging

from ..platform_utils import get_python_executable
from ..catalog.models import ModelInfo

logger = logging.getLogger(__name__)


def download_model(model: ModelInfo, venv_dir: str, model_dir: str,
                   progress_callback=None) -> None:
    """
    Download a model using the engine's SDK via the installed venv Python.
    For cloud engines (bailian), this is a no-op.
    """
    if model.is_cloud:
        logger.info(f"Cloud engine {model.engine}, no model download needed")
        if progress_callback:
            progress_callback("Cloud engine, no download needed")
        return

    os.makedirs(model_dir, exist_ok=True)
    python = get_python_executable(venv_dir)

    if progress_callback:
        progress_callback(f"Downloading model: {model.display_name}...")

    if model.engine == "sensevoice":
        _download_sensevoice(python, model, model_dir, progress_callback)
    elif model.engine == "whisper":
        _download_whisper(python, model, model_dir, progress_callback)
    elif model.engine == "qwen3asr":
        _download_qwen3(python, model, model_dir, progress_callback)
    else:
        logger.warning(f"Unknown engine {model.engine}, skipping model download")


def _download_sensevoice(python: str, model: ModelInfo, model_dir: str,
                         progress_callback=None):
    """Download SenseVoice model via modelscope."""
    script = f"""
import os
os.environ['MODELSCOPE_CACHE'] = {repr(model_dir)}
from modelscope.hub.api import HubApi
api = HubApi()
# Download main model
api.model_download('{model.model_id}')
# Download VAD model
api.model_download('iic/speech_fsmn_vad_zh-cn-16k-common-pytorch')
print('DOWNLOAD_COMPLETE')
"""
    _run_python_script(python, script, progress_callback)


def _download_whisper(python: str, model: ModelInfo, model_dir: str,
                      progress_callback=None):
    """Download Whisper model."""
    model_name = model.whisper_model_name or model.model_id
    script = f"""
import whisper
import os
os.environ['WHISPER_MODEL_PATH'] = {repr(model_dir)}
# This triggers the download
whisper._download(whisper._MODELS['{model_name}'], {repr(model_dir)}, False)
print('DOWNLOAD_COMPLETE')
"""
    _run_python_script(python, script, progress_callback)


def _download_qwen3(python: str, model: ModelInfo, model_dir: str,
                    progress_callback=None):
    """Download Qwen3-ASR model via huggingface_hub."""
    script = f"""
import os
os.environ['HF_HOME'] = {repr(model_dir)}
from huggingface_hub import snapshot_download
snapshot_download('{model.model_id}')
# Also download aligner
snapshot_download('Qwen/Qwen3-ForcedAligner-0.6B')
print('DOWNLOAD_COMPLETE')
"""
    _run_python_script(python, script, progress_callback)


def _run_python_script(python: str, script: str, progress_callback=None):
    """Run a Python script in the venv and monitor output."""
    result = subprocess.run(
        [python, "-c", script],
        capture_output=True,
        text=True,
        timeout=3600,  # 1 hour for large model downloads
    )

    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            logger.debug(f"[download] {line}")
            if progress_callback and "%" in line:
                progress_callback(f"Downloading... {line.strip()}")

    if result.returncode != 0:
        error = result.stderr or result.stdout or "Unknown error"
        raise RuntimeError(f"Model download failed:\n{error}")

    if "DOWNLOAD_COMPLETE" not in (result.stdout or ""):
        logger.warning("Download script did not confirm completion")
