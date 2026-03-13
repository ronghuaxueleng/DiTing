"""
Build the DiTing server as a PyInstaller sidecar for Tauri.

Usage:
    python scripts/build_sidecar.py

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
BINARIES_DIR = os.path.join(PROJECT_ROOT, "src-tauri", "binaries")


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

    # PyInstaller command
    entry = os.path.join(PROJECT_ROOT, "app", "server.py")
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--name", "diting-server",
        "--distpath", DIST_DIR,
        "--workpath", os.path.join(PROJECT_ROOT, "build", "pyinstaller_work"),
        "--specpath", os.path.join(PROJECT_ROOT, "build"),
        "--noconfirm",
        "--clean",
    ]

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
