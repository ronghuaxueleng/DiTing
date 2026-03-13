"""
Build the DiTing server as a PyInstaller sidecar for Tauri.

Usage:
    uv run python scripts/build_sidecar.py

Output:
    src-tauri/binaries/diting-server-{target-triple}[.exe]
"""

import os
import platform
import shutil
import subprocess
import sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(PROJECT_ROOT, "build", "sidecar")
BINARIES_DIR = os.path.join(PROJECT_ROOT, "src-tauri")


def get_venv_python() -> str:
    """Find the project venv Python. Prefer .venv in project root."""
    if sys.prefix != sys.base_prefix:
        # Already running inside a venv
        return sys.executable
    venv_python = os.path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe") \
        if platform.system() == "Windows" \
        else os.path.join(PROJECT_ROOT, ".venv", "bin", "python")
    if os.path.exists(venv_python):
        return venv_python
    return sys.executable


def get_target_triple() -> str:
    """Return the Rust-style target triple for the current platform."""
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
    target_triple = get_target_triple()
    ext = ".exe" if platform.system() == "Windows" else ""
    output_name = f"diting-server-{target_triple}{ext}"

    print(f"[build_sidecar] Target: {target_triple}")
    print(f"[build_sidecar] Output: {output_name}")

    # Ensure frontend is built
    frontend_dist = os.path.join(PROJECT_ROOT, "frontend", "dist")
    if not os.path.exists(frontend_dist):
        print("[build_sidecar] Warning: frontend/dist not found. Run 'npm run build' in frontend/ first.")

    # PyInstaller command — use project venv Python
    entry = os.path.join(PROJECT_ROOT, "app", "server.py")
    python = get_venv_python()
    print(f"[build_sidecar] Python: {python}")

    # ML / ASR Worker packages — not needed by the web server sidecar
    exclude_modules = [
        # PyTorch ecosystem (~4GB)
        "torch", "torchaudio", "torchvision",
        # ASR engines
        "funasr", "modelscope", "paraformer_onnx",
        # Audio separation (UVR)
        "audio_separator",
        # Heavy scientific / ML libs
        "numpy", "scipy", "pandas", "sklearn", "scikit_learn",
        "onnx", "onnxruntime", "onnxconverter_common",
        "librosa", "soundfile", "audioread",
        # Plotting / notebook (pulled by transitive deps)
        "matplotlib", "IPython", "notebook", "jupyter",
        # Other large optional deps
        "transformers", "huggingface_hub", "safetensors", "tokenizers",
        "tensorflow", "tensorboard", "keras",
        # Desktop tray (not needed in Tauri mode)
        "pystray",
    ]

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
    ]

    for mod in exclude_modules:
        cmd.extend(["--exclude-module", mod])

    # Add data files
    sep = ";" if platform.system() == "Windows" else ":"
    if os.path.exists(frontend_dist):
        cmd.extend(["--add-data", f"{frontend_dist}{sep}frontend/dist"])

    cmd.append(entry)

    print(f"[build_sidecar] Running PyInstaller...")
    subprocess.run(cmd, check=True, cwd=PROJECT_ROOT)

    # Move to src-tauri/binaries/ with target-triple name
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
