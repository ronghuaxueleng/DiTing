"""Step 2: Engine and model selection."""

import customtkinter as ctk

from ...catalog.models import get_all_models, ModelInfo
from ...catalog.recommender import recommend_models, Recommendation
from ...i18n import t
from ..widgets.card import SelectableCard
from ... import constants


class StepEngine(ctk.CTkFrame):
    """Wizard step: select ASR engine and model."""

    def __init__(self, master, controller, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.controller = controller
        self.grid_columnconfigure(0, weight=1)
        self.grid_rowconfigure(2, weight=1)

        # Title
        ctk.CTkLabel(
            self, text=t("engine.title"),
            font=ctk.CTkFont(size=20, weight="bold"),
        ).grid(row=0, column=0, sticky="w", padx=20, pady=(20, 5))

        ctk.CTkLabel(
            self, text=t("engine.subtitle"),
            font=ctk.CTkFont(size=13),
            text_color=("gray40", "gray60"),
        ).grid(row=1, column=0, sticky="w", padx=20, pady=(0, 15))

        # Scrollable card area
        self._scroll_frame = ctk.CTkScrollableFrame(
            self, fg_color="transparent", corner_radius=0
        )
        self._scroll_frame.grid(row=2, column=0, sticky="nsew", padx=10, pady=0)
        self._scroll_frame.grid_columnconfigure(0, weight=1)

        self._model_cards: dict[str, SelectableCard] = {}
        self._recommendations: list[Recommendation] = []

        # Config section
        self._config_frame = ctk.CTkFrame(self, fg_color="transparent")
        self._config_frame.grid(row=3, column=0, sticky="ew", padx=20, pady=(10, 5))
        self._config_frame.grid_columnconfigure(1, weight=1)

        # Install dir
        ctk.CTkLabel(
            self._config_frame, text=t("engine.install_dir"),
            font=ctk.CTkFont(size=12),
        ).grid(row=0, column=0, sticky="e", padx=(0, 8), pady=4)
        self._dir_entry = ctk.CTkEntry(
            self._config_frame,
            font=ctk.CTkFont(size=12),
        )
        self._dir_entry.grid(row=0, column=1, sticky="ew", pady=4)
        self._dir_entry.insert(0, constants.DEFAULT_INSTALL_DIR)

        # Port
        ctk.CTkLabel(
            self._config_frame, text=t("engine.port"),
            font=ctk.CTkFont(size=12),
        ).grid(row=1, column=0, sticky="e", padx=(0, 8), pady=4)
        self._port_entry = ctk.CTkEntry(
            self._config_frame, width=80,
            font=ctk.CTkFont(size=12),
        )
        self._port_entry.grid(row=1, column=1, sticky="w", pady=4)
        self._port_entry.insert(0, str(constants.DEFAULT_WORKER_PORT))

        # ── Network settings ──
        net_frame = ctk.CTkFrame(self._config_frame, fg_color="transparent")
        net_frame.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(8, 0))
        net_frame.grid_columnconfigure(1, weight=1)

        # Mirror checkbox
        self._mirror_var = ctk.BooleanVar(value=self._detect_china_locale())
        self._mirror_check = ctk.CTkCheckBox(
            net_frame, text=t("engine.use_mirror"),
            variable=self._mirror_var,
            font=ctk.CTkFont(size=12),
        )
        self._mirror_check.grid(row=0, column=0, columnspan=2, sticky="w", pady=2)

        # Proxy
        ctk.CTkLabel(
            net_frame, text=t("engine.proxy"),
            font=ctk.CTkFont(size=12),
        ).grid(row=1, column=0, sticky="e", padx=(0, 8), pady=2)
        self._proxy_entry = ctk.CTkEntry(
            net_frame,
            font=ctk.CTkFont(size=12),
            placeholder_text=t("engine.proxy_placeholder"),
        )
        self._proxy_entry.grid(row=1, column=1, sticky="ew", pady=2)

        # Buttons
        btn_frame = ctk.CTkFrame(self, fg_color="transparent")
        btn_frame.grid(row=4, column=0, sticky="ew", padx=20, pady=(5, 20))

        self._back_btn = ctk.CTkButton(
            btn_frame, text=t("btn.back"), width=100,
            font=ctk.CTkFont(size=13),
            fg_color="transparent", border_width=1,
            command=self._on_back,
        )
        self._back_btn.pack(side="left")

        self._next_btn = ctk.CTkButton(
            btn_frame, text=t("btn.install"), width=120,
            font=ctk.CTkFont(size=13, weight="bold"),
            command=self._on_next,
            state="disabled",
        )
        self._next_btn.pack(side="right")

    def on_enter(self):
        """Called when this step becomes active. Build model cards."""
        hw = self.controller.state.hardware
        if not hw:
            return

        # Clear existing cards
        for card in self._model_cards.values():
            card.destroy()
        self._model_cards.clear()

        # Get recommendations
        self._recommendations = recommend_models(hw)

        for i, rec in enumerate(self._recommendations):
            model = rec.model
            # Build subtitle: size + VRAM
            if model.is_cloud:
                subtitle = t("engine.cloud_subtitle")
            else:
                size = f"{model.download_size_mb}MB"
                if model.download_size_mb >= 1000:
                    size = f"{model.download_size_mb / 1000:.1f}GB"
                subtitle = f"{t('engine.download')}: {size} | {t('hw.vram')}: {model.vram_required_mb}MB"

            # Stars display
            acc_stars = "\u2605" * model.accuracy + "\u2606" * (5 - model.accuracy)
            spd_stars = "\u2605" * model.speed + "\u2606" * (5 - model.speed)
            # Use i18n model description if available
            desc_key = f"model.{model.id}.desc"
            desc_text = t(desc_key)
            if desc_text == desc_key:
                desc_text = model.description
            desc = f"{desc_text}\n{t('engine.accuracy')}: {acc_stars}  {t('engine.speed')}: {spd_stars}"
            if not rec.compatible:
                desc += f"\n\u26a0 {rec.reason}"

            # Translate tags
            translated_tags = []
            for tag in rec.tags:
                if tag == "Recommended":
                    translated_tags.append(t("tag.recommended"))
                elif tag == "Best Accuracy":
                    translated_tags.append(t("tag.best_accuracy"))
                elif tag == "Lightweight":
                    translated_tags.append(t("tag.lightweight"))
                else:
                    translated_tags.append(tag)

            card = SelectableCard(
                self._scroll_frame,
                title=model.display_name,
                subtitle=subtitle,
                description=desc,
                tags=translated_tags if rec.compatible else [],
                enabled=rec.compatible,
                on_select=lambda _t, m=model: self._select_model(m),
            )
            card.grid(row=i, column=0, sticky="ew", pady=4, padx=5)
            self._model_cards[model.id] = card

        # Auto-select recommended model
        for rec in self._recommendations:
            if "Recommended" in rec.tags and rec.compatible:
                self._select_model(rec.model)
                break

    def _select_model(self, model: ModelInfo):
        """Handle model card selection."""
        self.controller.state.selected_model = model

        for model_id, card in self._model_cards.items():
            card.selected = (model_id == model.id)

        self._next_btn.configure(state="normal")

    def _on_back(self):
        self.controller.prev_step()

    def _on_next(self):
        # Save config values to state
        self.controller.state.install_dir = self._dir_entry.get().strip()
        try:
            self.controller.state.port = int(self._port_entry.get().strip())
        except ValueError:
            self.controller.state.port = constants.DEFAULT_WORKER_PORT

        # Network settings
        self.controller.state.use_mirror = self._mirror_var.get()
        self.controller.state.proxy = self._proxy_entry.get().strip()

        # Set device string
        device = self.controller.state.selected_device
        if device == "cuda":
            self.controller.state.selected_device = "cuda:0"
        elif device == "mps":
            self.controller.state.selected_device = "mps"
        else:
            self.controller.state.selected_device = "cpu"

        self.controller.next_step()

    @staticmethod
    def _detect_china_locale() -> bool:
        """Auto-detect if user is likely in China (for mirror default)."""
        import locale
        try:
            loc = locale.getdefaultlocale()[0] or ""
            if loc.startswith("zh"):
                return True
        except Exception:
            pass
        # Check timezone
        import time
        try:
            # CST = UTC+8
            if time.timezone == -28800 or time.altzone == -28800:
                return True
        except Exception:
            pass
        return False
