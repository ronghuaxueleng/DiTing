"""Multi-step progress panel widget."""

import customtkinter as ctk

from ...i18n import t


class ProgressPanel(ctk.CTkFrame):
    """Displays multi-step progress with a console log area."""

    def __init__(self, master, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.grid_columnconfigure(0, weight=1)

        # Step indicators
        self._steps_frame = ctk.CTkFrame(self, fg_color="transparent")
        self._steps_frame.grid(row=0, column=0, sticky="ew", padx=10, pady=(10, 5))
        self._steps_frame.grid_columnconfigure(0, weight=1)
        self._step_labels: list[ctk.CTkLabel] = []

        # Current status
        self._status_label = ctk.CTkLabel(
            self, text=t("install.preparing"),
            font=ctk.CTkFont(size=13, weight="bold"),
            anchor="w",
        )
        self._status_label.grid(row=1, column=0, sticky="w", padx=15, pady=(5, 2))

        # Progress bar
        self._progress_bar = ctk.CTkProgressBar(self, height=8)
        self._progress_bar.grid(row=2, column=0, sticky="ew", padx=15, pady=(2, 5))
        self._progress_bar.set(0)

        # Percentage
        self._pct_label = ctk.CTkLabel(
            self, text="0%",
            font=ctk.CTkFont(size=12),
            text_color=("gray40", "gray60"),
        )
        self._pct_label.grid(row=3, column=0, sticky="e", padx=15, pady=(0, 5))

        # Console log area
        self._console = ctk.CTkTextbox(
            self, height=200,
            font=ctk.CTkFont(family="Consolas", size=11),
            state="disabled",
            fg_color=("gray95", "#1e1e1e"),
            text_color=("gray20", "#d4d4d4"),
        )
        self._console.grid(row=4, column=0, sticky="nsew", padx=10, pady=(5, 10))
        self.grid_rowconfigure(4, weight=1)

    def set_steps(self, step_names: list[str]):
        """Initialize the step indicator list."""
        for label in self._step_labels:
            label.destroy()
        self._step_labels.clear()

        for i, name in enumerate(step_names):
            label = ctk.CTkLabel(
                self._steps_frame,
                text=f"  {name}",
                font=ctk.CTkFont(size=12),
                text_color=("gray60", "gray50"),
                anchor="w",
            )
            label.grid(row=i, column=0, sticky="w", pady=1)
            self._step_labels.append(label)

    def update_progress(self, completed: int, total: int, message: str = ""):
        """Update the progress bar and current step highlighting."""
        if total > 0:
            pct = completed / total
            self._progress_bar.set(pct)
            self._pct_label.configure(text=f"{int(pct * 100)}%")

        if message:
            self._status_label.configure(text=message)

        # Update step colors
        for i, label in enumerate(self._step_labels):
            if i < completed:
                label.configure(
                    text_color=("#10b981", "#10b981"),
                    text=f"  {label.cget('text').strip().lstrip('● ○ ')}",
                )
                # Prefix with check mark
                text = label.cget("text").strip()
                label.configure(text=f"  {text}")
            elif i == completed:
                label.configure(
                    text_color=("#3b82f6", "#60a5fa"),
                    font=ctk.CTkFont(size=12, weight="bold"),
                )
            else:
                label.configure(
                    text_color=("gray60", "gray50"),
                    font=ctk.CTkFont(size=12),
                )

    def log(self, message: str):
        """Append a message to the console log."""
        self._console.configure(state="normal")
        self._console.insert("end", message + "\n")
        self._console.see("end")
        self._console.configure(state="disabled")

    def set_error(self, error: str):
        """Display an error state."""
        self._status_label.configure(text=f"{t('install.error')}: {error}", text_color="red")
        self._progress_bar.configure(progress_color="red")
        self.log(f"\n--- ERROR ---\n{error}")

    def set_complete(self):
        """Display completion state."""
        self._progress_bar.set(1.0)
        self._pct_label.configure(text="100%")
        self._status_label.configure(
            text=t("install.complete"),
            text_color=("#10b981", "#10b981"),
        )
