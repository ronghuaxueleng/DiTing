"""Hardware info display widget."""

import customtkinter as ctk

from ...hardware.detector import HardwareInfo
from ...i18n import t


class HardwareInfoPanel(ctk.CTkFrame):
    """Displays detected hardware information in a clean layout."""

    def __init__(self, master, hw: HardwareInfo, **kwargs):
        super().__init__(master, corner_radius=10, **kwargs)
        self.grid_columnconfigure(1, weight=1)

        row = 0

        # Title
        title = ctk.CTkLabel(
            self, text=t("hw.panel_title"),
            font=ctk.CTkFont(size=14, weight="bold"),
            anchor="w",
        )
        title.grid(row=row, column=0, columnspan=2, sticky="w", padx=15, pady=(12, 8))
        row += 1

        # CPU
        self._add_row(row, t("hw.cpu"), f"{hw.cpu_name} ({hw.cpu_cores} cores)")
        row += 1

        # RAM
        self._add_row(row, t("hw.ram"), f"{hw.ram_gb} GB")
        row += 1

        # GPU
        if hw.has_cuda:
            self._add_row(row, t("hw.gpu"), hw.gpu_name)
            row += 1
            self._add_row(row, t("hw.vram"), f"{hw.vram_mb // 1024} GB ({hw.vram_mb} MB)")
            row += 1
            if hw.cuda_version:
                self._add_row(row, t("hw.cuda"), f"{hw.cuda_version} (Driver {hw.driver_version})")
                row += 1
        elif hw.has_mps:
            self._add_row(row, t("hw.gpu"), f"{hw.gpu_name} ({t('hw.apple_silicon')})")
            row += 1
            if hw.unified_memory_gb:
                self._add_row(row, t("hw.unified_memory"), f"{hw.unified_memory_gb} GB")
                row += 1
        else:
            self._add_row(row, t("hw.gpu"), t("hw.none_detected"))
            row += 1

        # Recommended device
        device_display = {
            "cuda": t("hw.device.cuda"),
            "mps": t("hw.device.mps"),
            "cpu": t("hw.device.cpu"),
        }
        device_text = device_display.get(hw.recommended_device, hw.recommended_device)
        label = ctk.CTkLabel(
            self, text=f"{t('hw.recommended')}:",
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=("gray30", "gray70"),
            anchor="e",
        )
        label.grid(row=row, column=0, sticky="e", padx=(15, 8), pady=(4, 12))
        value = ctk.CTkLabel(
            self, text=device_text,
            font=ctk.CTkFont(size=12, weight="bold"),
            text_color=("#10b981", "#10b981"),
            anchor="w",
        )
        value.grid(row=row, column=1, sticky="w", padx=(0, 15), pady=(4, 12))

    def _add_row(self, row: int, label_text: str, value_text: str):
        label = ctk.CTkLabel(
            self, text=f"{label_text}:",
            font=ctk.CTkFont(size=12),
            text_color=("gray30", "gray70"),
            anchor="e",
        )
        label.grid(row=row, column=0, sticky="e", padx=(15, 8), pady=2)
        value = ctk.CTkLabel(
            self, text=value_text,
            font=ctk.CTkFont(size=12),
            anchor="w",
        )
        value.grid(row=row, column=1, sticky="w", padx=(0, 15), pady=2)
