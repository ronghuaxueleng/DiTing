"""NVIDIA GPU detection via nvidia-smi (no torch required)."""

import subprocess
import re
import logging

logger = logging.getLogger(__name__)


def detect_cuda() -> dict | None:
    """
    Detect NVIDIA GPU info by parsing nvidia-smi output.
    Returns dict with gpu_name, vram_mb, driver_version, cuda_version, or None.
    """
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,driver_version",
                "--format=csv,noheader,nounits",
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None

        line = result.stdout.strip().split("\n")[0]
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 3:
            return None

        gpu_name = parts[0]
        vram_mb = int(float(parts[1]))
        driver_version = parts[2]

        cuda_version = _get_cuda_version()

        return {
            "gpu_name": gpu_name,
            "vram_mb": vram_mb,
            "driver_version": driver_version,
            "cuda_version": cuda_version,
        }
    except FileNotFoundError:
        logger.debug("nvidia-smi not found")
        return None
    except Exception as e:
        logger.debug(f"CUDA detection failed: {e}")
        return None


def _get_cuda_version() -> str | None:
    """Extract CUDA version from nvidia-smi output."""
    try:
        result = subprocess.run(
            ["nvidia-smi"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None

        # Look for "CUDA Version: XX.X" in nvidia-smi header
        match = re.search(r"CUDA Version:\s*([\d.]+)", result.stdout)
        if match:
            return match.group(1)
        return None
    except Exception:
        return None


def get_cuda_compute_key(cuda_version: str | None) -> str:
    """Map CUDA version to PyTorch index key (cu121, cu124, etc.)."""
    if not cuda_version:
        return "cpu"
    try:
        major, minor = cuda_version.split(".")[:2]
        ver = int(major) * 10 + int(minor)
        if ver >= 124:
            return "cu124"
        elif ver >= 121:
            return "cu121"
        else:
            # Older CUDA, fall back to CPU
            return "cpu"
    except (ValueError, IndexError):
        return "cpu"
