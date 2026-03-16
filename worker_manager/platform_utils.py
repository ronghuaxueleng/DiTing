"""Cross-platform utility functions."""

import os
import platform
import sys
import json
from pathlib import Path
from . import constants


def is_windows() -> bool:
    return platform.system() == "Windows"


def is_macos() -> bool:
    return platform.system() == "Darwin"


def is_linux() -> bool:
    return platform.system() == "Linux"


def is_apple_silicon() -> bool:
    return is_macos() and platform.machine() == "arm64"


def get_platform_key() -> str:
    """Return platform key for UV download URLs."""
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in ("amd64", "x86_64"):
        arch = "x86_64"
    elif machine in ("arm64", "aarch64"):
        arch = "aarch64"
    else:
        arch = machine
    return f"{system}_{arch}"


def get_uv_binary_name() -> str:
    return "uv.exe" if is_windows() else "uv"


def get_python_executable(venv_dir: str) -> str:
    """Get Python executable path inside a venv."""
    if is_windows():
        return os.path.join(venv_dir, "Scripts", "python.exe")
    return os.path.join(venv_dir, "bin", "python")


def get_install_dir() -> str:
    """Get the installation directory, reading from state or using default."""
    state = load_state()
    return state.get("install_dir", constants.DEFAULT_INSTALL_DIR)


def get_state_path(install_dir: str = None) -> str:
    """Get the path to the manager state file."""
    if install_dir is None:
        install_dir = constants.DEFAULT_INSTALL_DIR
    return os.path.join(install_dir, constants.STATE_FILE)


def load_state(install_dir: str = None) -> dict:
    """Load manager state from JSON file."""
    path = get_state_path(install_dir)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_state(state: dict, install_dir: str = None) -> None:
    """Save manager state to JSON file."""
    if install_dir is None:
        install_dir = state.get("install_dir", constants.DEFAULT_INSTALL_DIR)
    os.makedirs(install_dir, exist_ok=True)
    path = get_state_path(install_dir)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)


def is_installed(install_dir: str = None) -> bool:
    """Check if a worker installation exists."""
    if install_dir is None:
        install_dir = constants.DEFAULT_INSTALL_DIR
    state = load_state(install_dir)
    return state.get("installed", False)


def get_bundled_resource_dir() -> str:
    """Get the directory containing bundled resources (for PyInstaller)."""
    if getattr(sys, "frozen", False):
        # Running as PyInstaller bundle
        return sys._MEIPASS
    # Running from source
    return os.path.dirname(os.path.abspath(__file__))
