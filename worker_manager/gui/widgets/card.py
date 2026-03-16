"""Selectable card widget for engine/model selection."""

import customtkinter as ctk

from ...i18n import t

# Tag text → color mapping (supports both zh and en via i18n keys)
_TAG_COLORS = {
    "tag.recommended": "#10b981",
    "tag.best_accuracy": "#3b82f6",
    "tag.lightweight": "#f59e0b",
}


class SelectableCard(ctk.CTkFrame):
    """A card widget that can be selected/deselected with click."""

    def __init__(self, master, title: str, subtitle: str = "",
                 description: str = "", tags: list[str] | None = None,
                 enabled: bool = True, selected: bool = False,
                 on_select=None, **kwargs):
        super().__init__(master, corner_radius=10, border_width=2, **kwargs)

        self._selected = selected
        self._enabled = enabled
        self._on_select = on_select
        self._title = title

        # Colors
        self._normal_border = ("gray70", "gray30")
        self._selected_border = ("#10b981", "#10b981")
        self._disabled_fg = ("gray60", "gray50")

        self.configure(
            border_color=self._selected_border if selected else self._normal_border,
        )

        # Layout
        self.grid_columnconfigure(0, weight=1)
        row = 0

        # Tags row
        if tags:
            tag_frame = ctk.CTkFrame(self, fg_color="transparent")
            tag_frame.grid(row=row, column=0, sticky="w", padx=12, pady=(10, 0))
            for tag_text in tags:
                color = self._tag_color(tag_text)
                tag = ctk.CTkLabel(
                    tag_frame, text=tag_text,
                    font=ctk.CTkFont(size=11, weight="bold"),
                    fg_color=color, text_color="white",
                    corner_radius=4, padx=6, pady=1,
                )
                tag.pack(side="left", padx=(0, 4))
            row += 1

        # Title
        self._title_label = ctk.CTkLabel(
            self, text=title,
            font=ctk.CTkFont(size=15, weight="bold"),
            anchor="w",
        )
        self._title_label.grid(row=row, column=0, sticky="w", padx=12, pady=(8, 0))
        row += 1

        # Subtitle
        if subtitle:
            self._subtitle_label = ctk.CTkLabel(
                self, text=subtitle,
                font=ctk.CTkFont(size=12),
                text_color=("gray40", "gray60"),
                anchor="w",
            )
            self._subtitle_label.grid(row=row, column=0, sticky="w", padx=12, pady=(2, 0))
            row += 1

        # Description
        if description:
            self._desc_label = ctk.CTkLabel(
                self, text=description,
                font=ctk.CTkFont(size=12),
                text_color=("gray50", "gray55"),
                anchor="w", wraplength=350,
                justify="left",
            )
            self._desc_label.grid(row=row, column=0, sticky="w", padx=12, pady=(4, 10))
            row += 1

        # Disabled overlay
        if not enabled:
            self.configure(fg_color=("gray90", "gray17"))
            self._title_label.configure(text_color=self._disabled_fg)

        # Click binding
        if enabled:
            self.bind("<Button-1>", self._on_click)
            for child in self.winfo_children():
                child.bind("<Button-1>", self._on_click)
                for grandchild in child.winfo_children():
                    grandchild.bind("<Button-1>", self._on_click)

    def _on_click(self, event=None):
        if self._enabled and self._on_select:
            self._on_select(self._title)

    @property
    def selected(self) -> bool:
        return self._selected

    @selected.setter
    def selected(self, value: bool):
        self._selected = value
        self.configure(
            border_color=self._selected_border if value else self._normal_border,
        )

    @staticmethod
    def _tag_color(tag: str) -> str:
        # Match by checking if tag text equals any translated tag
        for key, color in _TAG_COLORS.items():
            if tag == t(key):
                return color
        return "#6b7280"
