"""Installation orchestration pipeline."""

import os
import sys
import shutil
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

from .. import constants
from ..platform_utils import save_state, get_bundled_resource_dir
from ..hardware.detector import HardwareInfo
from ..catalog.models import ModelInfo
from .uv_manager import ensure_uv
from .environment import (
    install_python,
    create_venv,
    install_pytorch,
    install_engine_deps,
    install_worker_base,
)
from .model_downloader import download_model

logger = logging.getLogger(__name__)


class InstallStep(Enum):
    UV = "Preparing uv"
    PYTHON = "Installing Python"
    VENV = "Creating environment"
    PYTORCH = "Installing PyTorch"
    BASE_DEPS = "Installing base dependencies"
    ENGINE_DEPS = "Installing engine dependencies"
    MODEL = "Downloading model"
    WORKER_FILES = "Setting up worker files"
    CONFIG = "Generating configuration"
    SCRIPTS = "Creating startup scripts"
    VERIFY = "Verifying installation"


@dataclass
class InstallProgress:
    """Progress state for the installation pipeline."""
    current_step: InstallStep | None = None
    total_steps: int = len(InstallStep)
    completed_steps: int = 0
    message: str = ""
    error: str | None = None
    done: bool = False


@dataclass
class InstallConfig:
    """Configuration for an installation."""
    install_dir: str = constants.DEFAULT_INSTALL_DIR
    model: ModelInfo | None = None
    hardware: HardwareInfo | None = None
    compute_key: str = "cpu"  # cu121, cu124, cpu, mps
    port: int = constants.DEFAULT_WORKER_PORT
    device: str = "cuda:0"
    auto_start: bool = True
    # Network
    use_mirror: bool = False
    proxy: str = ""
    # Server registration
    server_url: str = ""


class InstallPipeline:
    """Orchestrates the full installation process."""

    def __init__(self, config: InstallConfig,
                 progress_callback: Callable[[InstallProgress], None] | None = None):
        self.config = config
        self.progress_callback = progress_callback
        self.progress = InstallProgress()
        self._cancelled = False

    def cancel(self):
        self._cancelled = True

    def run(self) -> bool:
        """Run the full installation pipeline. Returns True on success."""
        steps = [
            (InstallStep.UV, self._step_uv),
            (InstallStep.PYTHON, self._step_python),
            (InstallStep.VENV, self._step_venv),
            (InstallStep.PYTORCH, self._step_pytorch),
            (InstallStep.BASE_DEPS, self._step_base_deps),
            (InstallStep.ENGINE_DEPS, self._step_engine_deps),
            (InstallStep.MODEL, self._step_model),
            (InstallStep.WORKER_FILES, self._step_worker_files),
            (InstallStep.CONFIG, self._step_config),
            (InstallStep.SCRIPTS, self._step_scripts),
            (InstallStep.VERIFY, self._step_verify),
        ]

        # Skip PyTorch for cloud engines
        if self.config.model and self.config.model.is_cloud:
            steps = [(s, f) for s, f in steps if s not in (
                InstallStep.PYTORCH, InstallStep.MODEL,
            )]

        self.progress.total_steps = len(steps)
        os.makedirs(self.config.install_dir, exist_ok=True)

        for step, func in steps:
            if self._cancelled:
                self.progress.error = "Installation cancelled"
                self._notify()
                return False

            self.progress.current_step = step
            self.progress.message = step.value
            self._notify()

            try:
                func()
            except Exception as e:
                logger.error(f"Installation failed at {step.value}: {e}", exc_info=True)
                self.progress.error = f"{step.value} failed: {e}"
                self._notify()
                return False

            self.progress.completed_steps += 1
            self._notify()

        # Save state
        save_state({
            "installed": True,
            "install_dir": self.config.install_dir,
            "engine": self.config.model.engine if self.config.model else "",
            "model_id": self.config.model.id if self.config.model else "",
            "port": self.config.port,
            "device": self.config.device,
            "auto_start": self.config.auto_start,
        }, self.config.install_dir)

        self.progress.done = True
        self.progress.message = "Installation complete!"
        self._notify()
        return True

    def _notify(self):
        if self.progress_callback:
            self.progress_callback(self.progress)

    def _msg(self, msg: str):
        self.progress.message = msg
        self._notify()

    def _step_uv(self):
        ensure_uv(self.config.install_dir, progress_callback=self._msg)

    def _step_python(self):
        uv = self._uv_path()
        install_python(uv, progress_callback=self._msg,
                       use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_venv(self):
        uv = self._uv_path()
        create_venv(uv, self.config.install_dir, progress_callback=self._msg,
                    use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_pytorch(self):
        uv = self._uv_path()
        venv = self._venv_path()
        install_pytorch(uv, venv, self.config.compute_key, progress_callback=self._msg,
                        use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_base_deps(self):
        uv = self._uv_path()
        venv = self._venv_path()
        install_worker_base(uv, venv, progress_callback=self._msg,
                            use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_engine_deps(self):
        if not self.config.model or not self.config.model.pip_extras:
            return
        uv = self._uv_path()
        venv = self._venv_path()
        install_engine_deps(uv, venv, self.config.model.pip_extras,
                            progress_callback=self._msg,
                            use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_model(self):
        if not self.config.model:
            return
        venv = self._venv_path()
        model_dir = os.path.join(self.config.install_dir, "models")
        download_model(self.config.model, venv, model_dir,
                       progress_callback=self._msg,
                       use_mirror=self.config.use_mirror, proxy=self.config.proxy)

    def _step_worker_files(self):
        """Copy asr_worker source files to install directory."""
        self._msg("Copying worker files...")
        dest = os.path.join(self.config.install_dir, "asr_worker")

        # Source: either bundled or from project root
        bundled = os.path.join(get_bundled_resource_dir(), "asr_worker")
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        source = bundled if os.path.isdir(bundled) else os.path.join(project_root, "asr_worker")

        if not os.path.isdir(source):
            raise FileNotFoundError(f"asr_worker source not found: {source}")

        if os.path.exists(dest):
            shutil.rmtree(dest)
        shutil.copytree(source, dest, dirs_exist_ok=True)
        logger.info(f"Worker files copied to {dest}")

    def _step_config(self):
        """Generate worker_config.yaml."""
        from ..worker.config_writer import write_config
        model_dir = os.path.join(self.config.install_dir, "models")
        worker_dir = os.path.join(self.config.install_dir, "asr_worker")
        write_config(
            worker_dir=worker_dir,
            engine=self.config.model.engine if self.config.model else "sensevoice",
            model=self.config.model,
            port=self.config.port,
            device=self.config.device,
            model_base_path=model_dir,
            server_url=self.config.server_url,
        )
        self._msg("Configuration generated")

    def _step_scripts(self):
        """Generate platform-specific startup scripts."""
        self._msg("Creating startup scripts...")
        from ..platform_utils import is_windows, is_macos
        install_dir = self.config.install_dir
        worker_dir = os.path.join(install_dir, "asr_worker")

        if is_windows():
            self._generate_windows_scripts(install_dir, worker_dir)
        else:
            self._generate_unix_scripts(install_dir, worker_dir)
        logger.info("Startup scripts created")

    def _generate_windows_scripts(self, install_dir: str, worker_dir: str):
        """Generate .bat and .vbs scripts for Windows."""
        venv_python = os.path.join(install_dir, ".venv", "Scripts", "python.exe")
        venv_pythonw = os.path.join(install_dir, ".venv", "Scripts", "pythonw.exe")

        # 1. start_worker.bat — direct console mode
        bat_path = os.path.join(install_dir, "start_worker.bat")
        bat_content = f'''@echo off
chcp 65001 >nul 2>&1
echo Starting DiTing ASR Worker...
cd /d "{worker_dir}"
"{venv_python}" main.py
pause
'''
        with open(bat_path, "w", encoding="utf-8") as f:
            f.write(bat_content)

        # 2. start_worker_tray.bat — tray mode
        tray_bat_path = os.path.join(install_dir, "start_worker_tray.bat")
        tray_bat_content = f'''@echo off
chcp 65001 >nul 2>&1
cd /d "{worker_dir}"
"{venv_python}" run_worker_tray.py
'''
        with open(tray_bat_path, "w", encoding="utf-8") as f:
            f.write(tray_bat_content)

        # 3. StartWorkerSilent.vbs — silent background tray mode
        vbs_path = os.path.join(install_dir, "StartWorkerSilent.vbs")
        # Use forward-escaped paths in VBS
        vbs_content = f'''Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "{worker_dir}"
WshShell.Run Chr(34) & "{venv_pythonw}" & Chr(34) & " run_worker_tray.py", 0, False
Set WshShell = Nothing
'''
        with open(vbs_path, "w", encoding="utf-8") as f:
            f.write(vbs_content)

        # 4. Also update the one inside asr_worker/ (for backward compat)
        vbs_inner = os.path.join(worker_dir, "StartWorkerSilent.vbs")
        with open(vbs_inner, "w", encoding="utf-8") as f:
            f.write(vbs_content)

    def _generate_unix_scripts(self, install_dir: str, worker_dir: str):
        """Generate shell scripts for macOS/Linux."""
        venv_python = os.path.join(install_dir, ".venv", "bin", "python")

        # 1. start_worker.sh — direct console mode
        sh_path = os.path.join(install_dir, "start_worker.sh")
        sh_content = f'''#!/bin/bash
echo "Starting DiTing ASR Worker..."
cd "{worker_dir}"
"{venv_python}" main.py
'''
        with open(sh_path, "w", encoding="utf-8") as f:
            f.write(sh_content)
        os.chmod(sh_path, 0o755)

        # 2. start_worker_tray.sh — tray mode
        tray_sh_path = os.path.join(install_dir, "start_worker_tray.sh")
        tray_sh_content = f'''#!/bin/bash
cd "{worker_dir}"
"{venv_python}" run_worker_tray.py
'''
        with open(tray_sh_path, "w", encoding="utf-8") as f:
            f.write(tray_sh_content)
        os.chmod(tray_sh_path, 0o755)

    def _step_verify(self):
        """Quick verification that the venv Python can import key modules."""
        self._msg("Verifying installation...")
        from ..platform_utils import get_python_executable
        venv = self._venv_path()
        python = get_python_executable(venv)

        if not os.path.exists(python):
            raise RuntimeError(f"Python not found at {python}")

        # Check worker files exist
        worker_main = os.path.join(self.config.install_dir, "asr_worker", "main.py")
        if not os.path.exists(worker_main):
            raise RuntimeError("Worker main.py not found")

        logger.info("Installation verified successfully")

    def _uv_path(self) -> str:
        from .uv_manager import get_uv_path
        return get_uv_path(self.config.install_dir)

    def _venv_path(self) -> str:
        return os.path.join(self.config.install_dir, ".venv")
