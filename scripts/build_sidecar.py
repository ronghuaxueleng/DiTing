"""
Build the DiTing server as a PyInstaller sidecar for Tauri.

Usage:
    uv run python scripts/build_sidecar.py

Output:
    src-tauri/binaries/diting-server-{target-triple}[.exe]
"""

import json
import os
try:
    import tomllib
except ImportError:
    import tomli as tomllib
from pathlib import Path
import platform
import shutil
import subprocess
import sys

# ---------------------------------------------------------------------
# Project paths
# ---------------------------------------------------------------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(PROJECT_ROOT, "build", "sidecar")
BINARIES_DIR = os.path.join(PROJECT_ROOT, "src-tauri")


def get_venv_python() -> str:
    """Find the project venv Python. Prefer .venv in project root."""
    # If already inside a virtual environment, use it directly
    if sys.prefix != sys.base_prefix:
        return sys.executable
    # Otherwise prefer the .venv directory created by uv
    venv_python = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe") if platform.system() == "Windows" else os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
    if os.path.exists(venv_python):
        return venv_python
    # Fallback to the Python interpreter running this script
    return sys.executable


def get_target_triple() -> str:
    """Return the Rust‑style target triple for the current platform."""
    machine = platform.machine().lower()
    system = platform.system().lower()

    if system == "windows":
        arch = "x86_64" if machine in ("amd64", "x86_64") else machine
        return f"{arch}-pc-windows-msvc"
    elif system == "darwin":
        arch = "aarch64" if machine == "arm64" else "x86_64"
        return f"{arch}-apple-darwin"
    elif system == "linux":
        arch = "x86_64" if machine in ("amd64", "x86_64") else machine
        return f"{arch}-unknown-linux-gnu"
    else:
        raise RuntimeError(f"Unsupported platform: {system} {machine}")


def build():
    # -----------------------------------------------------------------
    # Inject project version into the sidecar binary AND sync to Tauri
    # -----------------------------------------------------------------
    try:
        pyproject_path = os.path.join(PROJECT_ROOT, "pyproject.toml")
        with open(pyproject_path, "rb") as f:
            pyproj = tomllib.load(f)
        proj_version = pyproj["project"]["version"]
    except Exception as e:
        print(f"[build_sidecar] Failed to read version from pyproject.toml: {e}")
        proj_version = "0.0.0"

    # Write a tiny version file that will be bundled with the exe
    version_txt_path = os.path.join(PROJECT_ROOT, "src-tauri", "version.txt")
    with open(version_txt_path, "w", encoding="utf-8") as vf:
        vf.write(f"__version__ = '{proj_version}'\n")

    # Sync version to tauri.conf.json
    tauri_conf_path = os.path.join(PROJECT_ROOT, "src-tauri", "tauri.conf.json")
    try:
        with open(tauri_conf_path, "r", encoding="utf-8") as f:
            tauri_conf = json.load(f)
        if tauri_conf.get("version") != proj_version:
            tauri_conf["version"] = proj_version
            with open(tauri_conf_path, "w", encoding="utf-8") as f:
                json.dump(tauri_conf, f, indent=2, ensure_ascii=False)
            print(f"[build_sidecar] Synced version to tauri.conf.json: {proj_version}")
    except Exception as e:
        print(f"[build_sidecar] Warning: Failed to sync version to tauri.conf.json: {e}")

    # -----------------------------------------------------------------
    target_triple = get_target_triple()
    ext = ".exe" if platform.system() == "Windows" else ""
    output_name = f"diting-server-{target_triple}{ext}"

    print(f"[build_sidecar] Target: {target_triple}")
    print(f"[build_sidecar] Output: {output_name}")

    # Ensure frontend is built (optional warning)
    frontend_dist = os.path.join(PROJECT_ROOT, "frontend", "dist")
    if not os.path.exists(frontend_dist):
        print("[build_sidecar] Warning: frontend/dist not found. Run 'npm run build' in frontend/ first.")

    # PyInstaller command – use the project's venv Python
    entry = os.path.join(PROJECT_ROOT, "app", "server.py")
    python = get_venv_python()
    print(f"[build_sidecar] Python: {python}")

    # Exclude heavy optional dependencies to keep the binary small
    exclude_modules = [
        "torch", "torchaudio", "torchvision",
        "funasr", "modelscope", "paraformer_onnx",
        "numpy", "scipy", "pandas", "sklearn", "scikit_learn",
        "onnx", "onnxruntime", "onnxconverter_common",
        "librosa", "soundfile", "audioread",
        "matplotlib", "IPython", "notebook", "jupyter",
        "transformers", "huggingface_hub", "safetensors", "tokenizers",
        "tensorflow", "tensorboard", "keras",
        "pystray",
    ]

    sep = ";" if platform.system() == "Windows" else ":"

    cmd = [
        python, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "diting-server",
        "--distpath", DIST_DIR,
        "--workpath", os.path.join(PROJECT_ROOT, "build", "pyinstaller_work"),
        "--specpath", os.path.join(PROJECT_ROOT, "build"),
        "--noconfirm",
        "--clean",
        # yt-dlp uses dynamic extractor loading — collect all submodules
        "--collect-all", "yt_dlp",
        # Ensure SSL certificates are bundled
        "--collect-data", "certifi",
    ]

    for mod in exclude_modules:
        cmd.extend(["--exclude-module", mod])

    # Bundle the version file
    if os.path.exists(version_txt_path):
        cmd.extend(["--add-data", f"{version_txt_path}{sep}src-tauri"])

    # Bundle the built frontend (if present)
    if os.path.exists(frontend_dist):
        cmd.extend(["--add-data", f"{frontend_dist}{sep}frontend/dist"])

    cmd.append(entry)

    print("[build_sidecar] Running PyInstaller...")
    subprocess.run(cmd, check=True, cwd=PROJECT_ROOT)

    # Move the resulting binary into the Tauri binaries directory
    os.makedirs(BINARIES_DIR, exist_ok=True)
    src = os.path.join(DIST_DIR, f"diting-server{ext}")
    dst = os.path.join(BINARIES_DIR, output_name)
    if os.path.exists(dst):
        os.remove(dst)
    shutil.move(src, dst)

    print(f"[build_sidecar] Done: {dst}")
    print(f"[build_sidecar] Size: {os.path.getsize(dst) / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    build()
