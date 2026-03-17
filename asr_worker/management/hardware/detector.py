"""Unified hardware detection entry point."""

import os
import platform
import logging
from dataclasses import dataclass, field

from .cuda import detect_cuda, get_cuda_compute_key
from .mps import detect_mps

logger = logging.getLogger(__name__)


@dataclass
class HardwareInfo:
    """Unified hardware information."""

    # CPU
    cpu_name: str = ""
    cpu_cores: int = 0

    # Memory
    ram_gb: int = 0

    # GPU (NVIDIA)
    has_cuda: bool = False
    gpu_name: str = ""
    vram_mb: int = 0
    cuda_version: str | None = None
    driver_version: str = ""
    cuda_compute_key: str = "cpu"  # cu121, cu124, cpu

    # GPU (Apple)
    has_mps: bool = False
    is_apple_silicon: bool = False
    unified_memory_gb: int | None = None

    # Recommendation
    recommended_device: str = "cpu"  # cuda, mps, cpu
    available_devices: list[str] = field(default_factory=lambda: ["cpu"])


def detect_hardware() -> HardwareInfo:
    """Run all hardware detection and return unified HardwareInfo."""
    info = HardwareInfo()

    # CPU
    info.cpu_name = platform.processor() or platform.machine()
    info.cpu_cores = os.cpu_count() or 1

    # RAM
    info.ram_gb = _get_ram_gb()

    # NVIDIA CUDA
    cuda_info = detect_cuda()
    if cuda_info:
        info.has_cuda = True
        info.gpu_name = cuda_info["gpu_name"]
        info.vram_mb = cuda_info["vram_mb"]
        info.cuda_version = cuda_info["cuda_version"]
        info.driver_version = cuda_info["driver_version"]
        info.cuda_compute_key = get_cuda_compute_key(cuda_info["cuda_version"])

    # Apple MPS
    mps_info = detect_mps()
    if mps_info:
        info.is_apple_silicon = mps_info["is_apple_silicon"]
        info.has_mps = mps_info.get("mps_available", False)
        info.unified_memory_gb = mps_info.get("unified_memory_gb")
        if not info.gpu_name:
            info.gpu_name = mps_info["gpu_name"]

    # Determine recommended device and available devices
    devices = ["cpu"]
    if info.has_cuda:
        devices.insert(0, "cuda")
        info.recommended_device = "cuda"
    elif info.has_mps:
        devices.insert(0, "mps")
        info.recommended_device = "mps"
    else:
        info.recommended_device = "cpu"
    info.available_devices = devices

    logger.info(f"Hardware detected: {info.recommended_device} | GPU: {info.gpu_name or 'None'} | RAM: {info.ram_gb}GB")
    return info


def _get_ram_gb() -> int:
    """Get total system RAM in GB."""
    system = platform.system()
    try:
        if system == "Windows":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [
                    ("dwLength", ctypes.c_ulong),
                    ("dwMemoryLoad", ctypes.c_ulong),
                    ("ullTotalPhys", ctypes.c_ulonglong),
                    ("ullAvailPhys", ctypes.c_ulonglong),
                    ("ullTotalPageFile", ctypes.c_ulonglong),
                    ("ullAvailPageFile", ctypes.c_ulonglong),
                    ("ullTotalVirtual", ctypes.c_ulonglong),
                    ("ullAvailVirtual", ctypes.c_ulonglong),
                    ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                ]

            stat = MEMORYSTATUSEX()
            stat.dwLength = ctypes.sizeof(stat)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat))
            return int(stat.ullTotalPhys / (1024 ** 3))
        elif system == "Darwin":
            import subprocess
            result = subprocess.run(
                ["sysctl", "-n", "hw.memsize"],
                capture_output=True, text=True, timeout=5,
            )
            if result.returncode == 0:
                return int(result.stdout.strip()) // (1024 ** 3)
        else:
            # Linux
            with open("/proc/meminfo") as f:
                for line in f:
                    if line.startswith("MemTotal:"):
                        kb = int(line.split()[1])
                        return kb // (1024 * 1024)
    except Exception as e:
        logger.debug(f"RAM detection failed: {e}")
    return 0
