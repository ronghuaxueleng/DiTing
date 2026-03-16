"""Step 1: Hardware detection + acceleration method selection."""

import threading
import customtkinter as ctk

from ...hardware.detector import detect_hardware, HardwareInfo
from ...i18n import t
from ..widgets.hardware_info import HardwareInfoPanel
from ..widgets.card import SelectableCard


class StepHardware(ctk.CTkFrame):
    """Wizard step: detect hardware and choose acceleration method."""

    def __init__(self, master, controller, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.controller = controller
        self.grid_columnconfigure(0, weight=1)

        # Title
        ctk.CTkLabel(
            self, text=t("hw.title"),
            font=ctk.CTkFont(size=20, weight="bold"),
        ).grid(row=0, column=0, sticky="w", padx=20, pady=(20, 5))

        ctk.CTkLabel(
            self, text=t("hw.subtitle"),
            font=ctk.CTkFont(size=13),
            text_color=("gray40", "gray60"),
        ).grid(row=1, column=0, sticky="w", padx=20, pady=(0, 15))

        # Loading indicator
        self._loading_frame = ctk.CTkFrame(self, fg_color="transparent")
        self._loading_frame.grid(row=2, column=0, sticky="ew", padx=20, pady=20)
        self._loading_label = ctk.CTkLabel(
            self._loading_frame, text=t("hw.detecting"),
            font=ctk.CTkFont(size=13),
        )
        self._loading_label.pack(pady=20)

        # Content frame (hidden until detection completes)
        self._content_frame = ctk.CTkFrame(self, fg_color="transparent")
        self._content_frame.grid_columnconfigure(0, weight=1)

        # Scrollable area for cards
        self._cards_frame = None
        self._device_cards: dict[str, SelectableCard] = {}

        # Next button
        self._next_btn = ctk.CTkButton(
            self, text=t("btn.next"), width=120,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._on_next,
            state="disabled",
        )
        self._next_btn.grid(row=4, column=0, sticky="e", padx=20, pady=(10, 20))

    def on_enter(self):
        """Called when this step becomes active. Start hardware detection."""
        if self.controller.state.hardware is None:
            self._start_detection()

    def _start_detection(self):
        """Run hardware detection in background thread."""
        self._loading_frame.grid(row=2, column=0, sticky="ew", padx=20, pady=20)
        self._content_frame.grid_forget()

        def detect():
            hw = detect_hardware()
            self.after(0, lambda: self._on_detection_complete(hw))

        threading.Thread(target=detect, daemon=True).start()

    def _on_detection_complete(self, hw: HardwareInfo):
        """Called when hardware detection finishes."""
        self.controller.state.hardware = hw
        self._loading_frame.grid_forget()
        self._content_frame.grid(row=2, column=0, sticky="nsew", padx=0, pady=0)
        self.grid_rowconfigure(2, weight=1)

        # Hardware info panel
        hw_panel = HardwareInfoPanel(self._content_frame, hw)
        hw_panel.grid(row=0, column=0, sticky="ew", padx=20, pady=(0, 15))

        # Acceleration method cards
        ctk.CTkLabel(
            self._content_frame, text=t("hw.select_accel"),
            font=ctk.CTkFont(size=14, weight="bold"),
        ).grid(row=1, column=0, sticky="w", padx=20, pady=(5, 8))

        self._cards_frame = ctk.CTkFrame(self._content_frame, fg_color="transparent")
        self._cards_frame.grid(row=2, column=0, sticky="ew", padx=20, pady=(0, 10))
        self._cards_frame.grid_columnconfigure(0, weight=1)

        devices = []
        if hw.has_cuda:
            devices.append((t("hw.card.cuda.title"), "cuda",
                            f"GPU: {hw.gpu_name} | {t('hw.vram')}: {hw.vram_mb}MB",
                            t("hw.card.cuda.desc")))
        if hw.has_mps:
            mem_str = f" | {t('hw.unified_memory')}: {hw.unified_memory_gb}GB" if hw.unified_memory_gb else ""
            devices.append((t("hw.card.mps.title"), "mps",
                            f"GPU: {hw.gpu_name}{mem_str}",
                            t("hw.card.mps.desc")))
        devices.append((t("hw.card.cpu.title"), "cpu",
                        f"CPU: {hw.cpu_name} | {t('hw.ram')}: {hw.ram_gb}GB",
                        t("hw.card.cpu.desc")))

        for i, (name, device_key, subtitle, desc) in enumerate(devices):
            tags = [t("tag.recommended")] if device_key == hw.recommended_device else []
            card = SelectableCard(
                self._cards_frame,
                title=name,
                subtitle=subtitle,
                description=desc,
                tags=tags,
                selected=(device_key == hw.recommended_device),
                on_select=lambda _t, dk=device_key: self._select_device(dk),
            )
            card.grid(row=i, column=0, sticky="ew", pady=4)
            self._device_cards[device_key] = card

        # Auto-select recommended
        self._select_device(hw.recommended_device)

    def _select_device(self, device: str):
        """Handle device card selection."""
        self.controller.state.selected_device = device

        # Update compute key
        hw = self.controller.state.hardware
        if device == "cuda" and hw:
            self.controller.state.compute_key = hw.cuda_compute_key
        elif device == "mps":
            self.controller.state.compute_key = "mps"
        else:
            self.controller.state.compute_key = "cpu"

        # Update card visuals
        for key, card in self._device_cards.items():
            card.selected = (key == device)

        self._next_btn.configure(state="normal")

    def _on_next(self):
        self.controller.next_step()
