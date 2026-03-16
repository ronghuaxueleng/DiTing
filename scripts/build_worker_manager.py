"""
Build the DiTing Worker Manager as a standalone executable via PyInstaller.

Usage:
    uv run python scripts/build_worker_manager.py

Output:
    dist/DiTing-Worker-Manager[.exe]
"""

import os
import platform
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
import tarfile

# ─── Project paths ───
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST_DIR = os.path.join(PROJECT_ROOT, "build", "worker_manager_dist")
WORK_DIR = os.path.join(PROJECT_ROOT, "build", "worker_manager_work")

# ─── UV download config ───
UV_VERSION = "0.7.12"
UV_URLS = {
    "windows_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-pc-windows-msvc.zip",
    "darwin_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-apple-darwin.tar.gz",
    "darwin_aarch64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-aarch64-apple-darwin.tar.gz",
    "linux_x86_64": f"https://github.com/astral-sh/uv/releases/download/{UV_VERSION}/uv-x86_64-unknown-linux-gnu.tar.gz",
}


def get_platform_key() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()
    if machine in ("amd64", "x86_64"):
        arch = "x86_64"
    elif machine in ("arm64", "aarch64"):
        arch = "aarch64"
    else:
        arch = machine
    return f"{system}_{arch}"


def get_target_triple() -> str:
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
    raise RuntimeError(f"Unsupported platform: {system} {machine}")


def download_uv(dest_dir: str) -> str:
    """Download uv binary to dest_dir. Returns path to binary."""
    pkey = get_platform_key()
    url = UV_URLS.get(pkey)
    if not url:
        raise RuntimeError(f"No uv download URL for {pkey}")

    uv_name = "uv.exe" if platform.system() == "Windows" else "uv"
    uv_dest = os.path.join(dest_dir, uv_name)

    if os.path.exists(uv_dest):
        print(f"[build] UV already exists: {uv_dest}")
        return uv_dest

    print(f"[build] Downloading uv from {url}...")
    os.makedirs(dest_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp:
        archive_name = url.split("/")[-1]
        archive_path = os.path.join(tmp, archive_name)
        urllib.request.urlretrieve(url, archive_path)

        if archive_name.endswith(".zip"):
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(tmp)
        else:
            with tarfile.open(archive_path) as tf:
                tf.extractall(tmp)

        # Find uv binary
        for root, dirs, files in os.walk(tmp):
            if uv_name in files:
                src = os.path.join(root, uv_name)
                shutil.copy2(src, uv_dest)
                if platform.system() != "Windows":
                    import stat
                    st = os.stat(uv_dest)
                    os.chmod(uv_dest, st.st_mode | stat.S_IEXEC)
                print(f"[build] UV saved to {uv_dest}")
                return uv_dest

    raise RuntimeError("uv binary not found in archive")


def build():
    ext = ".exe" if platform.system() == "Windows" else ""
    output_name = f"DiTing-Worker-Manager{ext}"

    print(f"[build] Target: {get_target_triple()}")
    print(f"[build] Output: {output_name}")

    # Step 1: Download uv binary to bundle
    uv_bundle_dir = os.path.join(PROJECT_ROOT, "build", "uv_bundle")
    uv_path = download_uv(uv_bundle_dir)

    # Step 2: Prepare asr_worker source for bundling
    asr_worker_dir = os.path.join(PROJECT_ROOT, "asr_worker")
    if not os.path.isdir(asr_worker_dir):
        raise FileNotFoundError(f"asr_worker/ not found at {asr_worker_dir}")

    # Step 3: Build with PyInstaller
    # Use a top-level entry script so PyInstaller resolves the worker_manager
    # package correctly (relative imports inside the package require this).
    entry = os.path.join(PROJECT_ROOT, "scripts", "worker_manager_entry.py")
    sep = ";" if platform.system() == "Windows" else ":"

    # PyInstaller needs to find the worker_manager package
    worker_manager_dir = os.path.join(PROJECT_ROOT, "worker_manager")

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onefile",
        "--noconsole",
        "--name", "DiTing-Worker-Manager",
        "--distpath", DIST_DIR,
        "--workpath", WORK_DIR,
        "--specpath", os.path.join(PROJECT_ROOT, "build"),
        "--noconfirm",
        "--clean",
        # Ensure PyInstaller can find the worker_manager package
        "--paths", PROJECT_ROOT,
        # Collect the entire worker_manager package (hidden imports)
        "--collect-all", "worker_manager",
        # CustomTkinter: collect all + explicit hidden imports
        "--collect-all", "customtkinter",
        "--hidden-import", "customtkinter",
        # customtkinter dependencies
        "--hidden-import", "darkdetect",
        "--hidden-import", "packaging",
        "--hidden-import", "packaging.version",
        "--hidden-import", "packaging.requirements",
        # pystray + Pillow for tray mode
        "--hidden-import", "pystray",
        "--hidden-import", "PIL",
        "--hidden-import", "PIL.Image",
        "--hidden-import", "PIL.ImageDraw",
        # SSL certificates
        "--collect-data", "certifi",
        # Bundle uv binary
        "--add-data", f"{uv_bundle_dir}{sep}uv",
        # Bundle asr_worker source
        "--add-data", f"{asr_worker_dir}{sep}asr_worker",
    ]

    # Asset files
    assets_dir = os.path.join(PROJECT_ROOT, "worker_manager", "assets")
    if os.path.isdir(assets_dir):
        cmd.extend(["--add-data", f"{assets_dir}{sep}assets"])

    # Icon
    icon_path = os.path.join(assets_dir, "icon.ico")
    if os.path.exists(icon_path):
        cmd.extend(["--icon", icon_path])

    # Exclude heavy modules we don't need in the manager itself
    exclude_modules = [
        "torch", "torchaudio", "torchvision",
        "funasr", "modelscope",
        "numpy", "scipy", "pandas",
        "transformers", "huggingface_hub",
        "tensorflow", "tensorboard",
        "matplotlib", "IPython", "notebook", "jupyter",
        "onnx", "onnxruntime",
    ]
    for mod in exclude_modules:
        cmd.extend(["--exclude-module", mod])

    cmd.append(entry)

    print("[build] Running PyInstaller...")
    subprocess.run(cmd, check=True, cwd=PROJECT_ROOT)

    # Verify output
    result = os.path.join(DIST_DIR, output_name)
    if os.path.exists(result):
        size_mb = os.path.getsize(result) / 1024 / 1024
        print(f"[build] Done: {result}")
        print(f"[build] Size: {size_mb:.1f} MB")
    else:
        print(f"[build] ERROR: Output not found at {result}")
        sys.exit(1)


if __name__ == "__main__":
    build()
