"""System tray manager for the worker."""

import os
import sys
import threading
import time
import logging

from ...worker.process_manager import WorkerProcessManager
from ...worker.health_checker import check_health
from ...platform_utils import load_state, save_state, is_windows
from ... import constants
from ...i18n import t

logger = logging.getLogger(__name__)


class TrayManager:
    """System tray icon and menu for managing the ASR worker."""

    def __init__(self, install_dir: str | None = None, on_reconfigure=None):
        self.install_dir = install_dir or constants.DEFAULT_INSTALL_DIR
        self.worker = WorkerProcessManager(self.install_dir)
        self._on_reconfigure = on_reconfigure
        self._icon = None

    def run(self, auto_start: bool = False):
        """Start the tray icon. Blocks until exit."""
        try:
            import pystray
            from PIL import Image, ImageDraw
        except ImportError:
            logger.error("pystray or Pillow not installed. Run: pip install pystray Pillow")
            return

        if auto_start:
            self.worker.start()

        icon_image = self._get_icon_image()
        state = load_state(self.install_dir)
        engine = state.get("engine", "unknown")
        port = state.get("port", constants.DEFAULT_WORKER_PORT)

        self._icon = pystray.Icon(
            t("tray.title"),
            icon_image,
            f"{t('tray.title')}\n{engine}",
        )

        def setup(icon):
            icon.visible = True
            while icon.visible:
                self._update_menu(icon, engine, port)
                time.sleep(2)

        self._icon.run(setup)

    def _update_menu(self, icon, engine: str, port: int):
        """Update tray menu to reflect current state."""
        import pystray
        from pystray import MenuItem as item

        is_running = self.worker.is_running()
        toggle_text = t("tray.stop") if is_running else t("tray.start")
        status = t("tray.running") if is_running else t("tray.stopped")

        icon.menu = pystray.Menu(
            item(f"{engine} (Port: {port}) - {status}", lambda i, it: None, enabled=False),
            pystray.Menu.SEPARATOR,
            item(toggle_text, self._action_toggle, default=True),
            item(t("tray.show_logs"), self._action_show_logs),
            pystray.Menu.SEPARATOR,
            item(t("tray.reconfigure"), self._action_reconfigure),
            item(t("tray.exit"), self._action_exit),
        )

    def _action_toggle(self, icon, item):
        if self.worker.is_running():
            self.worker.stop()
        else:
            self.worker.start()

    def _action_show_logs(self, icon, item):
        self._show_log_window()

    def _action_reconfigure(self, icon, item):
        if self._on_reconfigure:
            self._on_reconfigure()

    def _action_exit(self, icon, item):
        # Save state
        state = load_state(self.install_dir)
        state["auto_start"] = self.worker.is_running()
        save_state(state, self.install_dir)

        icon.stop()
        if self.worker.is_running():
            self.worker.stop()
        os._exit(0)

    def _get_icon_image(self):
        """Load or generate tray icon."""
        from PIL import Image, ImageDraw

        # Try to find icon file
        for p in ["icon.png", "icon.ico"]:
            full = os.path.join(self.install_dir, p)
            if os.path.exists(full):
                try:
                    return Image.open(full)
                except Exception:
                    pass

        # Check bundled assets
        from ...platform_utils import get_bundled_resource_dir
        for p in ["assets/icon.png", "assets/icon.ico"]:
            full = os.path.join(get_bundled_resource_dir(), p)
            if os.path.exists(full):
                try:
                    return Image.open(full)
                except Exception:
                    pass

        # Generate fallback icon
        img = Image.new("RGB", (64, 64), "#0f172a")
        d = ImageDraw.Draw(img)
        d.rounded_rectangle((12, 12, 52, 52), radius=8, fill="#10b981")
        d.text((22, 18), "W", fill="white")
        return img

    def _show_log_window(self):
        """Open a simple log viewing window."""
        try:
            from .log_window import show_log_window
            show_log_window(self.worker)
        except Exception as e:
            logger.error(f"Failed to show log window: {e}")
