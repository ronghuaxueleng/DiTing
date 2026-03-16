"""Worker subprocess lifecycle management."""

import os
import sys
import subprocess
import threading
import queue
import time
import logging

from ..platform_utils import get_python_executable, load_state
from .. import constants
from .health_checker import check_health, wait_for_health

logger = logging.getLogger(__name__)


class WorkerProcessManager:
    """Manages the ASR Worker as a subprocess."""

    def __init__(self, install_dir: str | None = None):
        self.install_dir = install_dir or constants.DEFAULT_INSTALL_DIR
        self.process: subprocess.Popen | None = None
        self.stop_event = threading.Event()
        self.log_queue: queue.Queue = queue.Queue()
        self._monitor_thread: threading.Thread | None = None
        self._port: int = constants.DEFAULT_WORKER_PORT

    @property
    def port(self) -> int:
        return self._port

    def start(self) -> bool:
        """Start the worker subprocess. Returns True if started successfully."""
        if self.is_running():
            self._log("Worker is already running")
            return True

        state = load_state(self.install_dir)
        self._port = state.get("port", constants.DEFAULT_WORKER_PORT)

        venv_dir = os.path.join(self.install_dir, ".venv")
        python = get_python_executable(venv_dir)
        worker_main = os.path.join(self.install_dir, "asr_worker", "main.py")

        if not os.path.exists(python):
            self._log(f"Python not found: {python}")
            return False
        if not os.path.exists(worker_main):
            self._log(f"Worker main.py not found: {worker_main}")
            return False

        self._log(f"Starting ASR Worker on port {self._port}...")

        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"

        try:
            self.process = subprocess.Popen(
                [python, worker_main],
                cwd=os.path.join(self.install_dir, "asr_worker"),
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                encoding="utf-8",
                errors="replace",
            )
            self.stop_event.clear()
            self._monitor_thread = threading.Thread(
                target=self._monitor_output, daemon=True
            )
            self._monitor_thread.start()
            self._log(f"Worker started (PID: {self.process.pid})")
            return True
        except Exception as e:
            self._log(f"Failed to start worker: {e}")
            return False

    def stop(self) -> None:
        """Stop the worker subprocess."""
        if not self.process:
            return

        self._log("Stopping ASR Worker...")
        self.stop_event.set()
        self.process.terminate()
        try:
            self.process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process = None
        self._log("Worker stopped")

    def restart(self) -> bool:
        """Restart the worker subprocess."""
        self.stop()
        time.sleep(1)
        return self.start()

    def is_running(self) -> bool:
        """Check if the worker process is alive."""
        return self.process is not None and self.process.poll() is None

    def is_healthy(self) -> bool:
        """Check if the worker is responding to health checks."""
        result = check_health(self._port)
        return result is not None and result.get("status") == "ok"

    def wait_until_healthy(self, timeout: int = 30) -> bool:
        """Wait for the worker to become healthy."""
        result = wait_for_health(self._port, timeout=timeout)
        return result is not None

    def get_logs(self, max_lines: int = 100) -> list[str]:
        """Get recent log lines (non-blocking)."""
        lines = []
        while not self.log_queue.empty() and len(lines) < max_lines:
            try:
                lines.append(self.log_queue.get_nowait())
            except queue.Empty:
                break
        return lines

    def _monitor_output(self):
        """Read subprocess stdout and queue log lines."""
        if not self.process or not self.process.stdout:
            return
        for line in iter(self.process.stdout.readline, ""):
            if self.stop_event.is_set():
                break
            if line:
                stripped = line.strip()
                self._log(stripped)
        if self.process and self.process.stdout:
            self.process.stdout.close()

    def _log(self, msg: str):
        """Log a message to both the logger and the log queue."""
        timestamp = time.strftime("%H:%M:%S")
        formatted = f"[{timestamp}] {msg}"
        self.log_queue.put(formatted)
        logger.info(msg)
