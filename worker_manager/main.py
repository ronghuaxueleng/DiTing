"""
DiTing Worker Manager — Entry Point

Decides whether to launch the wizard (first install) or tray mode (already installed).

Usage:
    python -m worker_manager                     # Auto-detect mode (Chinese)
    python -m worker_manager wizard              # Force wizard mode
    python -m worker_manager tray                # Force tray mode
    python -m worker_manager --lang en wizard    # English UI
"""

import sys
import os
import logging

# Set up logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%H:%M:%S",
)


def main():
    from . import constants
    from .platform_utils import is_installed, load_state
    from .i18n import set_language

    # Parse CLI args
    mode = None
    install_dir = constants.DEFAULT_INSTALL_DIR
    lang = "zh"  # Default to Chinese

    args = sys.argv[1:]
    filtered_args = []
    i = 0
    while i < len(args):
        if args[i] == "--lang" and i + 1 < len(args):
            lang = args[i + 1]
            i += 2
        else:
            filtered_args.append(args[i])
            i += 1

    set_language(lang)

    if filtered_args:
        mode = filtered_args[0].lower()
        if len(filtered_args) > 1:
            install_dir = filtered_args[1]

    # Auto-detect mode
    if mode is None:
        if is_installed(install_dir):
            mode = "tray"
        else:
            mode = "wizard"

    if mode == "wizard":
        _run_wizard(install_dir)
    elif mode == "tray":
        _run_tray(install_dir)
    else:
        print(f"Unknown mode: {mode}")
        print("Usage: python -m worker_manager [--lang zh|en] [wizard|tray] [install_dir]")
        sys.exit(1)


def _run_wizard(install_dir: str):
    """Launch the GUI wizard."""
    from .gui.app import WorkerManagerApp
    app = WorkerManagerApp(install_dir=install_dir)
    app.run()


def _run_tray(install_dir: str):
    """Launch tray-only mode."""
    from .platform_utils import load_state
    from .gui.tray.tray_manager import TrayManager

    state = load_state(install_dir)
    auto_start = state.get("auto_start", True)

    tray = TrayManager(install_dir=install_dir)
    tray.run(auto_start=auto_start)


if __name__ == "__main__":
    main()
