"""Constants for Worker Manager."""

import os
import platform

# --- Version ---
VERSION = "0.1.0"
APP_NAME = "DiTing Worker Manager"

# --- Paths ---
if platform.system() == "Windows":
    DEFAULT_INSTALL_DIR = os.path.join(os.path.expanduser("~"), "DiTing-Worker")
else:
    DEFAULT_INSTALL_DIR = os.path.join(os.path.expanduser("~"), ".diting-worker")

STATE_FILE = "manager_state.json"
WORKER_CONFIG_FILE = "worker_config.yaml"

# --- UV ---
UV_VERSION = "0.7.12"
UV_DOWNLOAD_URLS = {
    "windows_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-pc-windows-msvc.zip",
    "darwin_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-apple-darwin.tar.gz",
    "darwin_aarch64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-aarch64-apple-darwin.tar.gz",
    "linux_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz",
}

PYTHON_VERSION = "3.11"

# --- PyTorch index URLs ---
PYTORCH_INDEX_URLS = {
    "cu121": "https://download.pytorch.org/whl/cu121",
    "cu124": "https://download.pytorch.org/whl/cu124",
    "cpu": "https://download.pytorch.org/whl/cpu",
    "mps": None,  # default PyPI (includes MPS support)
}

# --- Worker defaults ---
DEFAULT_WORKER_PORT = 8001
WORKER_HEALTH_TIMEOUT = 30  # seconds to wait for /health
WORKER_HEALTH_INTERVAL = 2  # seconds between /health polls

# --- China mirrors ---
MIRROR_PYPI = "https://mirrors.aliyun.com/pypi/simple/"
MIRROR_PYTORCH_URLS = {
    "cu121": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu121",
    "cu124": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu124",
    "cpu": "https://mirror.sjtu.edu.cn/pytorch-wheels/cpu",
    "mps": None,
}
MIRROR_HF_ENDPOINT = "https://hf-mirror.com"
# UV_PYTHON_DOWNLOADS uses GitHub by default; this can help if GitHub is blocked
MIRROR_UV_PYTHON_INSTALL_MIRROR = "https://ghp.ci/https://github.com"
