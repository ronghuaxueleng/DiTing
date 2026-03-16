"""UV binary management — extract from bundled resources or download."""

import os
import sys
import stat
import shutil
import logging
import zipfile
import tarfile
import tempfile
import urllib.request

from .. import constants
from ..platform_utils import is_windows, get_platform_key, get_uv_binary_name, get_bundled_resource_dir

logger = logging.getLogger(__name__)


def get_uv_path(install_dir: str) -> str:
    """Get the expected path to the uv binary in the install directory."""
    return os.path.join(install_dir, "uv", get_uv_binary_name())


def ensure_uv(install_dir: str, progress_callback=None) -> str:
    """
    Ensure uv binary is available. Tries in order:
    1. Already exists in install_dir/uv/
    2. Extract from PyInstaller bundle
    3. Download from GitHub

    Returns path to uv binary.
    """
    uv_path = get_uv_path(install_dir)

    if os.path.exists(uv_path):
        logger.info(f"UV already available: {uv_path}")
        return uv_path

    os.makedirs(os.path.dirname(uv_path), exist_ok=True)

    # Try extracting from bundled resources
    bundled = _find_bundled_uv()
    if bundled:
        if progress_callback:
            progress_callback("Extracting bundled uv...")
        shutil.copy2(bundled, uv_path)
        _make_executable(uv_path)
        logger.info(f"Extracted bundled uv to {uv_path}")
        return uv_path

    # Download from GitHub
    if progress_callback:
        progress_callback("Downloading uv...")
    _download_uv(install_dir, progress_callback)

    if not os.path.exists(uv_path):
        raise RuntimeError("Failed to obtain uv binary")

    return uv_path


def _find_bundled_uv() -> str | None:
    """Check if uv is bundled with the PyInstaller package."""
    resource_dir = get_bundled_resource_dir()
    uv_name = get_uv_binary_name()

    # Check uv/ subdirectory in bundle
    candidates = [
        os.path.join(resource_dir, "uv", uv_name),
        os.path.join(resource_dir, uv_name),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _download_uv(install_dir: str, progress_callback=None):
    """Download uv binary from GitHub releases."""
    platform_key = get_platform_key()
    url = constants.UV_DOWNLOAD_URLS.get(platform_key)
    if not url:
        raise RuntimeError(f"No uv download URL for platform: {platform_key}")

    uv_dir = os.path.join(install_dir, "uv")
    os.makedirs(uv_dir, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmp_dir:
        archive_name = url.split("/")[-1]
        archive_path = os.path.join(tmp_dir, archive_name)

        # Download with progress
        _download_file(url, archive_path, progress_callback)

        # Extract
        if progress_callback:
            progress_callback("Extracting uv...")

        if archive_name.endswith(".zip"):
            with zipfile.ZipFile(archive_path) as zf:
                zf.extractall(tmp_dir)
        elif archive_name.endswith((".tar.gz", ".tgz")):
            with tarfile.open(archive_path) as tf:
                tf.extractall(tmp_dir)

        # Find the uv binary in extracted files
        uv_name = get_uv_binary_name()
        for root, dirs, files in os.walk(tmp_dir):
            if uv_name in files:
                src = os.path.join(root, uv_name)
                dst = os.path.join(uv_dir, uv_name)
                shutil.copy2(src, dst)
                _make_executable(dst)
                logger.info(f"Downloaded uv to {dst}")
                return

        raise RuntimeError("uv binary not found in downloaded archive")


def _download_file(url: str, dest: str, progress_callback=None):
    """Download a file with optional progress reporting."""
    logger.info(f"Downloading {url}")

    def reporthook(block_num, block_size, total_size):
        if progress_callback and total_size > 0:
            downloaded = block_num * block_size
            pct = min(100, int(downloaded * 100 / total_size))
            progress_callback(f"Downloading uv... {pct}%")

    urllib.request.urlretrieve(url, dest, reporthook=reporthook)


def _make_executable(path: str):
    """Make a file executable on Unix systems."""
    if not is_windows():
        st = os.stat(path)
        os.chmod(path, st.st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
