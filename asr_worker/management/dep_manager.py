"""Engine dependency management — check and install pip packages.

Handles PyTorch installation (with CUDA/CPU/MPS variants) and
engine-specific dependencies (funasr, openai-whisper, qwen-asr).
"""

import asyncio
import logging
import os
import sys

from .catalog import MODELS, get_models_for_engine
from .constants import PYTORCH_INDEX_URLS, MIRROR_PYPI, MIRROR_PYTORCH_URLS

logger = logging.getLogger(__name__)


def check_engine_deps(engine: str) -> dict:
    """Check if engine-specific libraries are findable.

    Uses find_spec (no full import) to avoid heavy side effects from packages
    like funasr that eagerly import torch on load.

    Returns {"installed": bool, "missing": [str], "available": [str]}
    """
    import importlib.util

    import_checks = {
        "sensevoice": [("funasr", "funasr"), ("modelscope", "modelscope")],
        "whisper": [("whisper", "openai-whisper")],
        "qwen3asr": [("qwen_asr", "qwen-asr")],
    }

    checks = import_checks.get(engine, [])
    missing = []
    available = []

    for module_name, package_name in checks:
        spec = importlib.util.find_spec(module_name)
        if spec is not None:
            available.append(package_name)
        else:
            missing.append(package_name)

    return {
        "installed": len(missing) == 0,
        "missing": missing,
        "available": available,
    }


def check_pytorch() -> dict:
    """Check PyTorch installation status.

    Returns {"installed": bool, "version": str|None, "cuda_available": bool, "cuda_version": str|None}
    """
    try:
        import torch
        cuda_available = torch.cuda.is_available()
        cuda_version = None
        if cuda_available:
            cuda_version = torch.version.cuda
        return {
            "installed": True,
            "version": torch.__version__,
            "cuda_available": cuda_available,
            "cuda_version": cuda_version,
        }
    except (ImportError, OSError):
        # OSError catches DLL load failures on Windows
        import importlib.util
        found = importlib.util.find_spec("torch") is not None
        return {
            "installed": found,
            "version": "unknown (load error)" if found else None,
            "cuda_available": False,
            "cuda_version": None,
        }


async def install_engine_deps(
    engine: str,
    use_mirror: bool = False,
    proxy: str = "",
    on_progress=None,
) -> None:
    """Install pip dependencies for an engine.

    Uses pip_extras from the first model of the engine in the catalog.
    """
    models = get_models_for_engine(engine)
    if not models:
        raise ValueError(f"No models found for engine: {engine}")

    # All models of the same engine share pip_extras
    pip_extras = models[0].pip_extras
    if not pip_extras:
        if on_progress:
            on_progress(f"No extra dependencies needed for {engine}")
        return

    packages = list(pip_extras)
    if on_progress:
        on_progress(f"Installing: {', '.join(packages)}")

    cmd = [sys.executable, "-m", "pip", "install"] + packages
    if use_mirror:
        cmd.extend(["-i", MIRROR_PYPI, "--trusted-host", "mirrors.aliyun.com"])
    if proxy:
        cmd.extend(["--proxy", proxy])

    await _run_pip(cmd, on_progress)
    if on_progress:
        on_progress(f"Engine dependencies installed: {engine}")


async def install_pytorch(
    compute_key: str,
    use_mirror: bool = False,
    proxy: str = "",
    on_progress=None,
) -> None:
    """Install PyTorch + torchaudio with the appropriate CUDA/CPU index URL.

    Args:
        compute_key: "cu121", "cu124", "cpu", or "mps"
        use_mirror: Use China mirror for PyTorch wheels
        proxy: HTTP proxy URL
        on_progress: Progress callback
    """
    if on_progress:
        on_progress(f"Installing PyTorch for {compute_key}...")

    packages = ["torch", "torchaudio"]
    cmd = [sys.executable, "-m", "pip", "install"] + packages

    # Get index URL
    if use_mirror:
        index_url = MIRROR_PYTORCH_URLS.get(compute_key)
    else:
        index_url = PYTORCH_INDEX_URLS.get(compute_key)

    if index_url:
        cmd.extend(["--index-url", index_url])

    if proxy:
        cmd.extend(["--proxy", proxy])

    await _run_pip(cmd, on_progress)
    if on_progress:
        on_progress(f"PyTorch installed for {compute_key}")


async def _run_pip(cmd: list[str], on_progress=None):
    """Run a pip command as async subprocess."""
    env = os.environ.copy()
    # Ensure pip doesn't prompt
    env["PIP_NO_INPUT"] = "1"

    logger.info(f"Running: {' '.join(cmd)}")

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
    )

    stdout_lines = []
    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        decoded = line.decode("utf-8", errors="replace").strip()
        stdout_lines.append(decoded)
        logger.debug(f"[pip] {decoded}")
        if on_progress and ("Installing" in decoded or "Downloading" in decoded
                           or "Successfully" in decoded or "%" in decoded):
            on_progress(decoded)

    await proc.wait()

    if proc.returncode != 0:
        stderr_bytes = await proc.stderr.read()
        stderr_text = stderr_bytes.decode("utf-8", errors="replace") if stderr_bytes else ""
        stdout_text = "\n".join(stdout_lines)
        error = stderr_text or stdout_text or "Unknown error"
        raise RuntimeError(f"pip install failed (exit {proc.returncode}):\n{error}")
