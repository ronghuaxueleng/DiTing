"""macOS Apple Silicon / MPS detection."""

import subprocess
import json
import platform
import logging

logger = logging.getLogger(__name__)


def detect_mps() -> dict | None:
    """
    Detect Apple GPU info on macOS using system_profiler.
    Returns dict with gpu_name, unified_memory_gb, is_apple_silicon, or None.
    """
    if platform.system() != "Darwin":
        return None

    is_apple_silicon = platform.machine() == "arm64"

    try:
        result = subprocess.run(
            ["system_profiler", "SPDisplaysDataType", "-json"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if result.returncode != 0:
            return None

        data = json.loads(result.stdout)
        displays = data.get("SPDisplaysDataType", [])
        if not displays:
            return None

        gpu = displays[0]
        gpu_name = gpu.get("sppci_model", "Unknown GPU")

        # Get unified memory (Apple Silicon shares RAM with GPU)
        unified_memory_gb = None
        if is_apple_silicon:
            unified_memory_gb = _get_macos_memory_gb()

        # Check for VRAM on discrete GPUs
        vram_str = gpu.get("sppci_vram", "")
        vram_mb = None
        if vram_str:
            # Parse strings like "8 GB" or "8192 MB"
            import re
            match = re.search(r"(\d+)\s*(GB|MB)", vram_str, re.IGNORECASE)
            if match:
                val = int(match.group(1))
                unit = match.group(2).upper()
                vram_mb = val * 1024 if unit == "GB" else val

        return {
            "gpu_name": gpu_name,
            "is_apple_silicon": is_apple_silicon,
            "mps_available": is_apple_silicon,
            "unified_memory_gb": unified_memory_gb,
            "vram_mb": vram_mb,
        }
    except Exception as e:
        logger.debug(f"MPS detection failed: {e}")
        return None


def _get_macos_memory_gb() -> int | None:
    """Get total system memory on macOS via sysctl."""
    try:
        result = subprocess.run(
            ["sysctl", "-n", "hw.memsize"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return int(result.stdout.strip()) // (1024 ** 3)
    except Exception:
        pass
    return None
