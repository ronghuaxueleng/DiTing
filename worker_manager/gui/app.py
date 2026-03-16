"""CustomTkinter main application — wizard and tray mode orchestration."""

import logging
import customtkinter as ctk

from .wizard.wizard_controller import WizardController, WizardStep
from .wizard.step_hardware import StepHardware
from .wizard.step_engine import StepEngine
from .wizard.step_install import StepInstall
from .wizard.step_complete import StepComplete
from .tray.tray_manager import TrayManager
from .. import constants
from ..i18n import t

logger = logging.getLogger(__name__)


class WorkerManagerApp:
    """Main GUI application for the Worker Manager."""

    def __init__(self, install_dir: str | None = None):
        self.install_dir = install_dir or constants.DEFAULT_INSTALL_DIR

        # Theme
        ctk.set_appearance_mode("system")
        ctk.set_default_color_theme("green")

        # Root window
        self.root = ctk.CTk()
        self.root.title(t("app.title"))
        self.root.geometry("600x700")
        self.root.minsize(550, 600)
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Center on screen
        self.root.update_idletasks()
        w = self.root.winfo_width()
        h = self.root.winfo_height()
        x = (self.root.winfo_screenwidth() - w) // 2
        y = (self.root.winfo_screenheight() - h) // 2
        self.root.geometry(f"+{x}+{y}")

        # Main container
        self._container = ctk.CTkFrame(self.root, fg_color="transparent")
        self._container.pack(fill="both", expand=True)
        self._container.grid_columnconfigure(0, weight=1)
        self._container.grid_rowconfigure(1, weight=1)

        # Step indicator bar at top
        self._step_bar = ctk.CTkFrame(self._container, height=50)
        self._step_bar.grid(row=0, column=0, sticky="ew")
        self._step_bar.grid_columnconfigure((0, 1, 2, 3), weight=1)
        self._step_indicators = []
        step_names = [t("step.hardware"), t("step.engine"), t("step.install"), t("step.complete")]
        for i, name in enumerate(step_names):
            label = ctk.CTkLabel(
                self._step_bar, text=f"{i + 1}. {name}",
                font=ctk.CTkFont(size=12),
                text_color=("gray60", "gray50"),
            )
            label.grid(row=0, column=i, pady=12)
            self._step_indicators.append(label)

        # Content area
        self._content = ctk.CTkFrame(self._container, fg_color="transparent")
        self._content.grid(row=1, column=0, sticky="nsew")
        self._content.grid_columnconfigure(0, weight=1)
        self._content.grid_rowconfigure(0, weight=1)

        # Wizard controller
        self._controller = WizardController(on_step_change=self._on_step_change)
        self._controller.state.install_dir = self.install_dir

        # Create steps
        self._steps: dict[WizardStep, ctk.CTkFrame] = {}
        self._steps[WizardStep.HARDWARE] = StepHardware(
            self._content, self._controller
        )
        self._steps[WizardStep.ENGINE] = StepEngine(
            self._content, self._controller
        )
        self._steps[WizardStep.INSTALL] = StepInstall(
            self._content, self._controller
        )
        self._steps[WizardStep.COMPLETE] = StepComplete(
            self._content, self._controller, on_launch=self._on_launch
        )

        # Show initial step
        self._show_step(WizardStep.HARDWARE)

    def run(self):
        """Start the GUI event loop."""
        self.root.mainloop()

    def _on_step_change(self, step: WizardStep):
        """Called when wizard step changes."""
        self._show_step(step)

    def _show_step(self, step: WizardStep):
        """Display the specified wizard step."""
        # Hide all steps
        for s in self._steps.values():
            s.grid_forget()

        # Show current step
        frame = self._steps[step]
        frame.grid(row=0, column=0, sticky="nsew")

        # Notify step
        if hasattr(frame, "on_enter"):
            frame.on_enter()

        # Update step indicators
        for i, label in enumerate(self._step_indicators):
            if i < step.value:
                label.configure(
                    text_color=("#10b981", "#10b981"),
                    font=ctk.CTkFont(size=12),
                )
            elif i == step.value:
                label.configure(
                    text_color=("gray10", "gray90"),
                    font=ctk.CTkFont(size=12, weight="bold"),
                )
            else:
                label.configure(
                    text_color=("gray60", "gray50"),
                    font=ctk.CTkFont(size=12),
                )

    def _on_launch(self, start_worker: bool = True, use_tray: bool = True):
        """Handle the launch action from the complete step."""
        if use_tray:
            # Close wizard window and switch to tray mode
            self.root.destroy()
            tray = TrayManager(
                install_dir=self._controller.state.install_dir,
                on_reconfigure=self._restart_wizard,
            )
            tray.run(auto_start=start_worker)
        elif start_worker:
            # Just start the worker and close
            from ..worker.process_manager import WorkerProcessManager
            worker = WorkerProcessManager(self._controller.state.install_dir)
            worker.start()
            self.root.destroy()
        else:
            self.root.destroy()

    def _restart_wizard(self):
        """Restart the wizard (called from tray reconfigure)."""
        # This is tricky from tray context — relaunch the process
        import sys, os
        python = sys.executable
        os.execl(python, python, *sys.argv)

    def _on_close(self):
        """Handle window close."""
        self.root.destroy()
