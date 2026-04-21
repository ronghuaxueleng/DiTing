"""Model downloading with async subprocess and progress tracking.

Adapted from worker_manager/installer/model_downloader.py.
Uses the current Python interpreter (sys.executable) instead of a venv Python.
All downloads run as async subprocesses for non-blocking operation.
"""

import asyncio
import logging
import os
import sys

from .catalog import ModelInfo
from .constants import MIRROR_HF_ENDPOINT

logger = logging.getLogger(__name__)


async def download_model(
    model: ModelInfo,
    models_dir: str,
    use_mirror: bool = False,
    proxy: str = "",
    on_progress=None,
) -> str:
    """
    Download a model using the engine's SDK.
    Returns the path where the model was downloaded.

    Args:
        model: Model catalog entry
        models_dir: Base directory for model storage
        use_mirror: Use China mirror endpoints
        proxy: HTTP proxy URL
        on_progress: Callback(message: str) for progress updates
    """
    if model.is_cloud:
        logger.info(f"Cloud engine {model.engine}, no model download needed")
        return ""

    os.makedirs(models_dir, exist_ok=True)

    if on_progress:
        on_progress(f"Downloading model: {model.display_name}...")

    if model.engine == "sensevoice":
        return await _download_sensevoice(model, models_dir, on_progress, proxy=proxy)
    elif model.engine == "whisper":
        return await _download_whisper(model, models_dir, on_progress, proxy=proxy)
    elif model.engine == "qwen3asr":
        return await _download_qwen3(model, models_dir, on_progress,
                                     use_mirror=use_mirror, proxy=proxy)
    else:
        raise ValueError(f"Unknown engine {model.engine}")


async def _download_sensevoice(
    model: ModelInfo, models_dir: str, on_progress=None, proxy: str = ""
) -> str:
    """Download SenseVoice model via modelscope."""
    script = f"""
import os
os.environ['MODELSCOPE_CACHE'] = {repr(models_dir)}
from modelscope import snapshot_download
# Download main model
print('Downloading main model: {model.model_id}')
snapshot_download('{model.model_id}', cache_dir={repr(models_dir)})
# Download VAD model
print('Downloading VAD model...')
snapshot_download('iic/speech_fsmn_vad_zh-cn-16k-common-pytorch', cache_dir={repr(models_dir)})
print('DOWNLOAD_COMPLETE')
"""
    await _run_python_script(script, on_progress, proxy=proxy)
    return os.path.join(models_dir, model.model_id)


async def _download_whisper(
    model: ModelInfo, models_dir: str, on_progress=None, proxy: str = ""
) -> str:
    """Download Whisper model."""
    model_name = model.whisper_model_name or model.model_id
    script = f"""
import whisper
import os
os.environ['WHISPER_MODEL_PATH'] = {repr(models_dir)}
print('Downloading Whisper model: {model_name}')
whisper._download(whisper._MODELS['{model_name}'], {repr(models_dir)}, False)
print('DOWNLOAD_COMPLETE')
"""
    await _run_python_script(script, on_progress, proxy=proxy)
    return os.path.join(models_dir, f"{model_name}.pt")


async def _download_qwen3(
    model: ModelInfo, models_dir: str, on_progress=None,
    use_mirror: bool = False, proxy: str = ""
) -> str:
    """Download Qwen3-ASR model via huggingface_hub."""
    hf_endpoint_line = ""
    if use_mirror:
        hf_endpoint_line = f"os.environ['HF_ENDPOINT'] = {repr(MIRROR_HF_ENDPOINT)}"

    script = f"""
import os
os.environ['HF_HOME'] = {repr(models_dir)}
{hf_endpoint_line}
from huggingface_hub import snapshot_download
print('Downloading Qwen3-ASR model: {model.model_id}')
snapshot_download('{model.model_id}')
# Also download aligner
print('Downloading Qwen3 ForcedAligner...')
snapshot_download('Qwen/Qwen3-ForcedAligner-0.6B')
print('DOWNLOAD_COMPLETE')
"""
    await _run_python_script(script, on_progress, proxy=proxy)
    hf_cache_name = model.model_id.replace("/", "--")
    return os.path.join(models_dir, f"models--{hf_cache_name}")


async def _run_python_script(
    script: str, on_progress=None, proxy: str = ""
):
    """Run a Python script as async subprocess and monitor output."""
    env = os.environ.copy()
    if proxy:
        env["HTTP_PROXY"] = proxy
        env["HTTPS_PROXY"] = proxy
        env["ALL_PROXY"] = proxy

    proc = await asyncio.create_subprocess_exec(
        sys.executable, "-c", script,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    stdout_lines = []
    # Read stdout line by line for progress
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        decoded = line.decode("utf-8", errors="replace").strip()
        stdout_lines.append(decoded)
        logger.debug(f"[download] {decoded}")
        if on_progress and ("%" in decoded or "Downloading" in decoded or "DOWNLOAD_COMPLETE" in decoded):
            on_progress(decoded)

    await proc.wait()

    stdout_text = "\n".join(stdout_lines)
    stderr_bytes = await proc.stderr.read()
    stderr_text = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""

    if proc.returncode != 0:
        error = stderr_text or stdout_text or "Unknown error"
        raise RuntimeError(f"Model download failed (exit {proc.returncode}):\n{error}")

    if "DOWNLOAD_COMPLETE" not in stdout_text:
        logger.warning("Download script did not confirm completion")
