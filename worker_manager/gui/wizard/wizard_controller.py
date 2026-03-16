"""Wizard state machine — manages step transitions."""

from enum import IntEnum
from typing import Callable

from ...hardware.detector import HardwareInfo
from ...catalog.models import ModelInfo


class WizardStep(IntEnum):
    HARDWARE = 0
    ENGINE = 1
    INSTALL = 2
    COMPLETE = 3


class WizardState:
    """Shared state across wizard steps."""

    def __init__(self):
        self.current_step: WizardStep = WizardStep.HARDWARE
        self.hardware: HardwareInfo | None = None
        self.selected_device: str = "cpu"  # cuda, mps, cpu
        self.selected_model: ModelInfo | None = None
        self.install_dir: str = ""
        self.port: int = 8001
        self.auto_start: bool = True
        self.compute_key: str = "cpu"  # cu121, cu124, cpu, mps
        # Network settings
        self.use_mirror: bool = False  # Use China mirrors
        self.proxy: str = ""           # HTTP proxy (e.g. http://127.0.0.1:7890)


class WizardController:
    """Controls wizard step navigation and shared state."""

    def __init__(self, on_step_change: Callable[[WizardStep], None] | None = None):
        self.state = WizardState()
        self._on_step_change = on_step_change

    def next_step(self):
        if self.state.current_step < WizardStep.COMPLETE:
            self.state.current_step = WizardStep(self.state.current_step + 1)
            if self._on_step_change:
                self._on_step_change(self.state.current_step)

    def prev_step(self):
        if self.state.current_step > WizardStep.HARDWARE:
            self.state.current_step = WizardStep(self.state.current_step - 1)
            if self._on_step_change:
                self._on_step_change(self.state.current_step)

    def go_to(self, step: WizardStep):
        self.state.current_step = step
        if self._on_step_change:
            self._on_step_change(step)
