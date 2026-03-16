"""Python virtual environment creation and dependency installation via uv."""

import os
import subprocess
import logging

from .. import constants
from ..platform_utils import is_windows, get_python_executable
from .uv_manager import get_uv_path

logger = logging.getLogger(__name__)


def _build_env(use_mirror: bool = False, proxy: str = "") -> dict:
    """Build environment dict with mirror/proxy settings for uv."""
    env = os.environ.copy()
    env["UV_NO_PROGRESS"] = "1"

    if use_mirror:
        env["UV_INDEX_URL"] = constants.MIRROR_PYPI

    if proxy:
        env["HTTP_PROXY"] = proxy
        env["HTTPS_PROXY"] = proxy
        env["ALL_PROXY"] = proxy

    return env


def install_python(uv_path: str, progress_callback=None,
                   use_mirror: bool = False, proxy: str = "") -> None:
    """Install Python using uv."""
    if progress_callback:
        progress_callback(f"Installing Python {constants.PYTHON_VERSION}...")

    _run_uv(uv_path, ["python", "install", constants.PYTHON_VERSION],
            progress_callback, use_mirror=use_mirror, proxy=proxy)
    logger.info(f"Python {constants.PYTHON_VERSION} installed")


def create_venv(uv_path: str, install_dir: str, progress_callback=None,
                use_mirror: bool = False, proxy: str = "") -> str:
    """Create a virtual environment in install_dir/.venv. Returns venv path."""
    venv_dir = os.path.join(install_dir, ".venv")

    if os.path.exists(venv_dir):
        logger.info(f"Venv already exists: {venv_dir}")
        return venv_dir

    if progress_callback:
        progress_callback("Creating virtual environment...")

    _run_uv(uv_path, [
        "venv", venv_dir,
        "--python", constants.PYTHON_VERSION,
    ], progress_callback, use_mirror=use_mirror, proxy=proxy)

    logger.info(f"Created venv: {venv_dir}")
    return venv_dir


def install_pytorch(uv_path: str, venv_dir: str, compute_key: str,
                    progress_callback=None,
                    use_mirror: bool = False, proxy: str = "") -> None:
    """Install PyTorch for the given compute platform (cu121, cu124, cpu, mps)."""
    if progress_callback:
        progress_callback(f"Installing PyTorch ({compute_key})...")

    packages = ["torch", "torchaudio"]

    # Use mirror URL if enabled, otherwise official
    if use_mirror:
        index_url = constants.MIRROR_PYTORCH_URLS.get(compute_key)
    else:
        index_url = constants.PYTORCH_INDEX_URLS.get(compute_key)

    cmd = ["pip", "install"] + packages + ["--python", venv_dir]
    if index_url:
        cmd.extend(["--index-url", index_url])

    _run_uv(uv_path, cmd, progress_callback, use_mirror=use_mirror, proxy=proxy)
    logger.info(f"PyTorch installed ({compute_key})")


def install_engine_deps(uv_path: str, venv_dir: str, pip_extras: list[str],
                        progress_callback=None,
                        use_mirror: bool = False, proxy: str = "") -> None:
    """Install engine-specific dependencies."""
    if not pip_extras:
        return

    if progress_callback:
        progress_callback("Installing engine dependencies...")

    # Always need pyyaml and numpy for the worker
    packages = ["pyyaml", "numpy"] + pip_extras

    cmd = ["pip", "install"] + packages + ["--python", venv_dir]
    _run_uv(uv_path, cmd, progress_callback, use_mirror=use_mirror, proxy=proxy)
    logger.info(f"Engine deps installed: {pip_extras}")


def install_worker_base(uv_path: str, venv_dir: str, progress_callback=None,
                        use_mirror: bool = False, proxy: str = "") -> None:
    """Install base worker dependencies (fastapi, uvicorn, etc.)."""
    if progress_callback:
        progress_callback("Installing worker base dependencies...")

    packages = [
        "fastapi>=0.128.0",
        "uvicorn>=0.40.0",
        "python-multipart>=0.0.21",
        "pyyaml",
        "numpy",
        # Tray mode dependencies
        "pystray>=0.19.5",
        "Pillow>=12.0.0",
    ]
    cmd = ["pip", "install"] + packages + ["--python", venv_dir]
    _run_uv(uv_path, cmd, progress_callback, use_mirror=use_mirror, proxy=proxy)
    logger.info("Worker base deps installed")


def _run_uv(uv_path: str, args: list[str], progress_callback=None,
            use_mirror: bool = False, proxy: str = "") -> str:
    """Run a uv command and return stdout. Raises on failure."""
    cmd = [uv_path] + args
    logger.debug(f"Running: {' '.join(cmd)}")

    env = _build_env(use_mirror=use_mirror, proxy=proxy)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=1800,  # 30 min timeout for large installs
    )

    if result.stdout:
        for line in result.stdout.strip().split("\n"):
            logger.debug(f"[uv] {line}")
    if result.stderr:
        for line in result.stderr.strip().split("\n"):
            if line.strip():
                logger.debug(f"[uv stderr] {line}")

    if result.returncode != 0:
        error_msg = result.stderr or result.stdout or "Unknown error"
        raise RuntimeError(f"uv command failed: {' '.join(args)}\n{error_msg}")

    return result.stdout
