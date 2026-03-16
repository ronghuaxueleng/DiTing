"""Step 3: Installation progress."""

import threading
import customtkinter as ctk

from ...installer.pipeline import InstallPipeline, InstallConfig, InstallProgress, InstallStep
from ...i18n import t
from ..widgets.progress_panel import ProgressPanel

# Map InstallStep enum to i18n keys
_STEP_I18N_KEYS = {
    InstallStep.UV: "istep.uv",
    InstallStep.PYTHON: "istep.python",
    InstallStep.VENV: "istep.venv",
    InstallStep.PYTORCH: "istep.pytorch",
    InstallStep.BASE_DEPS: "istep.base_deps",
    InstallStep.ENGINE_DEPS: "istep.engine_deps",
    InstallStep.MODEL: "istep.model",
    InstallStep.WORKER_FILES: "istep.worker_files",
    InstallStep.CONFIG: "istep.config",
    InstallStep.SCRIPTS: "istep.scripts",
    InstallStep.VERIFY: "istep.verify",
}


class StepInstall(ctk.CTkFrame):
    """Wizard step: installation progress display."""

    def __init__(self, master, controller, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.controller = controller
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        self._pipeline: InstallPipeline | None = None
        self._install_thread: threading.Thread | None = None

        # Title
        ctk.CTkLabel(
            self, text=t("install.title"),
            font=ctk.CTkFont(size=20, weight="bold"),
        ).grid(row=0, column=0, sticky="w", padx=20, pady=(20, 5))

        self._subtitle = ctk.CTkLabel(
            self, text=t("install.subtitle"),
            font=ctk.CTkFont(size=13),
            text_color=("gray40", "gray60"),
        )
        self._subtitle.grid(row=1, column=0, sticky="w", padx=20, pady=(0, 15))

        # Progress panel
        self._progress_panel = ProgressPanel(self)
        self._progress_panel.grid(row=2, column=0, sticky="nsew", padx=10, pady=0)

        # Buttons
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(10, 20))

        self._cancel_btn = ctk.CTkButton(
            btn_frame, text=t("install.cancel"), width=100,
            font=ctk.CTkFont(size=13),
            fg_color="transparent", border_width=1,
            hover_color=("red", "darkred"),
            command=self._on_cancel,
        )
        self._cancel_btn.pack(side="left")

        self._next_btn = ctk.CTkButton(
            btn_frame, text=t("btn.next"), width=120,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._on_next,
            state="disabled",
        )
        self._next_btn.pack(side="right")

    def on_enter(self):
        """Called when this step becomes active. Start installation."""
        state = self.controller.state

        # Set up step names (translated)
        steps = list(InstallStep)
        if state.selected_model and state.selected_model.is_cloud:
            steps = [s for s in steps if s not in (InstallStep.PYTORCH, InstallStep.MODEL)]
        step_names = [t(_STEP_I18N_KEYS.get(s, s.value)) for s in steps]
        self._progress_panel.set_steps(step_names)

        # Build install config
        config = InstallConfig(
            install_dir=state.install_dir,
            model=state.selected_model,
            hardware=state.hardware,
            compute_key=state.compute_key,
            port=state.port,
            device=state.selected_device,
            auto_start=state.auto_start,
        )

        self._pipeline = InstallPipeline(config, progress_callback=self._on_progress)

        # Run in background thread
        self._install_thread = threading.Thread(target=self._run_install, daemon=True)
        self._install_thread.start()

    def _run_install(self):
        """Run installation pipeline in background."""
        success = self._pipeline.run()
        self.after(0, lambda: self._on_install_done(success))

    def _on_progress(self, progress: InstallProgress):
        """Called from install thread with progress updates."""
        self.after(0, lambda: self._update_ui(progress))

    def _update_ui(self, progress: InstallProgress):
        """Update UI from progress data (runs on main thread)."""
        self._progress_panel.update_progress(
            progress.completed_steps,
            progress.total_steps,
            progress.message,
        )
        self._progress_panel.log(progress.message)

        if progress.error:
            self._progress_panel.set_error(progress.error)
            self._cancel_btn.configure(text=t("btn.back"), command=self._on_back)

    def _on_install_done(self, success: bool):
        """Called when installation finishes."""
        if success:
            self._progress_panel.set_complete()
            self._cancel_btn.pack_forget()
            self._next_btn.configure(state="normal")
        else:
            self._cancel_btn.configure(text=t("btn.back"), command=self._on_back)

    def _on_cancel(self):
        if self._pipeline:
            self._pipeline.cancel()
        self._cancel_btn.configure(state="disabled", text=t("install.cancelling"))

    def _on_back(self):
        self.controller.prev_step()

    def _on_next(self):
        self.controller.next_step()
