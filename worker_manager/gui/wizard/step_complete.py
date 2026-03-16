"""Step 4: Installation complete + launch options."""

import customtkinter as ctk

from ... import constants
from ...i18n import t

# Internal keys for info labels (not displayed)
_INFO_KEYS = ["engine", "worker_url", "install_dir", "server_url"]


class StepComplete(ctk.CTkFrame):
    """Wizard step: installation complete, show connection info and launch options."""

    def __init__(self, master, controller, on_launch=None, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.controller = controller
        self._on_launch = on_launch
        self.grid_columnconfigure(0, weight=1)

        # Success icon + title
        ctk.CTkLabel(
            self, text=t("complete.title"),
            font=ctk.CTkFont(size=22, weight="bold"),
            text_color=("#10b981", "#10b981"),
        ).grid(row=0, column=0, padx=20, pady=(40, 10))

        # Connection info frame
        info_frame = ctk.CTkFrame(self, corner_radius=10)
        info_frame.grid(row=1, column=0, sticky="ew", padx=40, pady=(10, 20))
        info_frame.grid_columnconfigure(1, weight=1)

        self._info_labels = {}
        row = 0
        display_labels = {
            "engine": t("complete.engine"),
            "worker_url": t("complete.worker_url"),
            "install_dir": t("complete.install_dir"),
            "server_url": t("complete.server_url"),
        }
        for key in _INFO_KEYS:
            ctk.CTkLabel(
                info_frame, text=f"{display_labels[key]}:",
                font=ctk.CTkFont(size=12, weight="bold"),
                text_color=("gray30", "gray70"),
                anchor="e",
            ).grid(row=row, column=0, sticky="e", padx=(15, 8), pady=4)
            val = ctk.CTkLabel(
                info_frame, text="",
                font=ctk.CTkFont(size=12),
                anchor="w",
            )
            val.grid(row=row, column=1, sticky="w", padx=(0, 15), pady=4)
            self._info_labels[key] = val
            row += 1

        # Tip
        ctk.CTkLabel(
            self,
            text=t("complete.tip"),
            font=ctk.CTkFont(size=12),
            text_color=("gray50", "gray55"),
        ).grid(row=2, column=0, padx=20, pady=(0, 20))

        # Options
        options_frame = ctk.CTkFrame(self, fg_color="transparent")
        options_frame.grid(row=3, column=0, padx=40, pady=(0, 10))

        self._auto_start_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(
            options_frame, text=t("complete.start_now"),
            variable=self._auto_start_var,
            font=ctk.CTkFont(size=12),
        ).pack(anchor="w", pady=2)

        self._tray_var = ctk.BooleanVar(value=True)
        ctk.CTkCheckBox(
            options_frame, text=t("complete.run_tray"),
            variable=self._tray_var,
            font=ctk.CTkFont(size=12),
        ).pack(anchor="w", pady=2)

        # Launch button
        self._launch_btn = ctk.CTkButton(
            self, text=t("complete.launch"), width=160, height=40,
            font=ctk.CTkFont(size=14, weight="bold"),
            command=self._on_launch_click,
        )
        self._launch_btn.grid(row=4, column=0, pady=(20, 40))

    def on_enter(self):
        """Populate connection info from wizard state."""
        state = self.controller.state
        model = state.selected_model

        engine_name = model.display_name if model else "Unknown"
        port = state.port
        install_dir = state.install_dir
        server_url = state.server_url

        self._info_labels["engine"].configure(text=engine_name)
        self._info_labels["worker_url"].configure(
            text=f"http://127.0.0.1:{port}",
            text_color=("#3b82f6", "#60a5fa"),
        )
        self._info_labels["install_dir"].configure(text=install_dir)

        if server_url:
            self._info_labels["server_url"].configure(
                text=f"{server_url}  ({t('complete.auto_register')})",
                text_color=("#10b981", "#10b981"),
            )
        else:
            self._info_labels["server_url"].configure(
                text=t("complete.manual_register"),
                text_color=("gray50", "gray55"),
            )

    def _on_launch_click(self):
        self.controller.state.auto_start = self._auto_start_var.get()
        if self._on_launch:
            self._on_launch(
                start_worker=self._auto_start_var.get(),
                use_tray=self._tray_var.get(),
            )
