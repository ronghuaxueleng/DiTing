"""Constants for ASR Worker management.

Subset of worker_manager/constants.py — keeps PyTorch index URLs and mirror URLs.
Drops GUI constants, UV download URLs, install dirs.
"""

# --- PyTorch index URLs ---
PYTORCH_INDEX_URLS = {
    "cu121": "https://download.pytorch.org/whl/cu121",
    "cu124": "https://download.pytorch.org/whl/cu124",
    "cpu": "https://download.pytorch.org/whl/cpu",
    "mps": None,  # default PyPI (includes MPS support)
}

# --- China mirrors ---
MIRROR_PYPI = "https://mirrors.aliyun.com/pypi/simple/"
MIRROR_PYTORCH_URLS = {
    "cu121": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu121",
    "cu124": "https://mirror.sjtu.edu.cn/pytorch-wheels/cu124",
    "cpu": "https://mirror.sjtu.edu.cn/pytorch-wheels/cpu",
    "mps": None,
}
MIRROR_HF_ENDPOINT = "https://hf-mirror.com"
