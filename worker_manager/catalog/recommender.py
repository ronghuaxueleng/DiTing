"""Hardware → model recommendation matching algorithm."""

from dataclasses import dataclass

from ..hardware.detector import HardwareInfo
from ..i18n import t
from .models import ModelInfo, get_all_models


@dataclass
class Recommendation:
    """A model with recommendation metadata."""
    model: ModelInfo
    tags: list[str]
    compatible: bool
    reason: str = ""


def recommend_models(hw: HardwareInfo) -> list[Recommendation]:
    """
    Given hardware info, return all models sorted by recommendation priority.
    Each model gets tags and compatibility status.
    """
    vram_mb = hw.vram_mb
    device = hw.recommended_device
    results = []

    for model in get_all_models():
        tags = []
        compatible = True
        reason = ""

        # Check MPS compatibility
        if device == "mps" and not model.supports_mps and not model.is_cloud:
            compatible = False
            reason = t("reason.no_mps")

        # Check VRAM
        if not model.is_cloud and device == "cuda":
            if model.vram_required_mb > vram_mb:
                compatible = False
                reason = t("reason.vram", required=model.vram_required_mb, available=vram_mb)

        # CPU-only: only small models and cloud are practical
        if device == "cpu" and not model.is_cloud:
            if model.vram_required_mb > 2000:
                compatible = False
                reason = t("reason.too_large_cpu")

        results.append(Recommendation(
            model=model,
            tags=tags,
            compatible=compatible,
            reason=reason,
        ))

    # Apply recommendation tags
    _apply_tags(results, hw)

    # Sort: recommended first, then compatible, then by accuracy desc
    results.sort(key=lambda r: (
        "Recommended" not in r.tags,
        not r.compatible,
        -r.model.accuracy,
        -r.model.speed,
    ))

    return results


def _apply_tags(recs: list[Recommendation], hw: HardwareInfo):
    """Apply Recommended / Best Accuracy / Lightweight tags based on hardware."""
    vram_mb = hw.vram_mb
    device = hw.recommended_device
    compatible = [r for r in recs if r.compatible]

    if not compatible:
        return

    # Find best compatible model for recommendation
    recommended_id = _pick_recommended(vram_mb, device)
    for r in recs:
        if r.model.id == recommended_id and r.compatible:
            r.tags.append("Recommended")
            break

    # Best Accuracy: highest accuracy among compatible
    best_acc = max(compatible, key=lambda r: r.model.accuracy)
    if "Recommended" not in best_acc.tags:
        best_acc.tags.append("Best Accuracy")

    # Lightweight: smallest compatible non-cloud model
    non_cloud = [r for r in compatible if not r.model.is_cloud]
    if non_cloud:
        lightest = min(non_cloud, key=lambda r: r.model.download_size_mb)
        if "Recommended" not in lightest.tags and "Best Accuracy" not in lightest.tags:
            lightest.tags.append("Lightweight")


def _pick_recommended(vram_mb: int, device: str) -> str:
    """Pick the single best model ID for this hardware."""
    if device == "mps":
        # macOS Apple Silicon: prefer Whisper (FunASR doesn't support MPS)
        if vram_mb >= 4000 or vram_mb == 0:
            # Apple Silicon uses unified memory, generous with "VRAM"
            return "whisper_large_v3_turbo"
        return "whisper_small"

    if device == "cpu":
        return "bailian"  # Cloud is best for no-GPU setups

    # CUDA GPU
    # Note: qwen3_asr excluded from auto-recommendation due to OOM on audio >10min
    if vram_mb >= 6000:
        return "whisper_large_v3_turbo"
    elif vram_mb >= 4000:
        return "sensevoice_small"
    elif vram_mb >= 2000:
        return "sensevoice_small"
    else:
        return "whisper_tiny"
