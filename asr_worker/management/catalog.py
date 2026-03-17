"""Model metadata registry and hardware-based recommendation.

Merged from worker_manager/catalog/models.py + recommender.py.
No i18n dependency — uses plain English strings.
Excludes 'bailian' (cloud engine managed by Server directly).
"""

from dataclasses import dataclass
from .hardware.detector import HardwareInfo


@dataclass
class ModelInfo:
    """Metadata for a single ASR engine + model combination."""
    id: str
    engine: str           # sensevoice, whisper, qwen3asr
    model_id: str         # Model identifier used by the engine
    display_name: str     # Human-readable name
    download_size_mb: int # Approximate download size
    vram_required_mb: int # Minimum VRAM needed (0 = no GPU)
    accuracy: int         # 1-5 stars
    speed: int            # 1-5 stars
    supports_mps: bool    # Works on Apple Silicon MPS
    is_cloud: bool = False
    description: str = ""

    # Extra dependencies beyond base worker deps
    pip_extras: list[str] | None = None
    # For whisper, the model_name param (tiny, small, medium, large-v3-turbo)
    whisper_model_name: str | None = None


# ── Model Registry ──
MODELS: dict[str, ModelInfo] = {}


def _register(m: ModelInfo):
    MODELS[m.id] = m


_register(ModelInfo(
    id="sensevoice_small",
    engine="sensevoice",
    model_id="iic/SenseVoiceSmall",
    display_name="SenseVoice Small",
    download_size_mb=500,
    vram_required_mb=800,
    accuracy=3,
    speed=5,
    supports_mps=False,
    description="Fast Chinese ASR by Alibaba FunASR. Best balance of speed and accuracy for Chinese content.",
    pip_extras=["funasr>=1.3.0", "modelscope>=1.34.0", "huggingface_hub"],
))

_register(ModelInfo(
    id="whisper_tiny",
    engine="whisper",
    model_id="tiny",
    display_name="Whisper Tiny",
    download_size_mb=39,
    vram_required_mb=400,
    accuracy=2,
    speed=5,
    supports_mps=True,
    whisper_model_name="tiny",
    description="Smallest Whisper model. Good for testing or low-resource machines.",
    pip_extras=["openai-whisper>=20250625"],
))

_register(ModelInfo(
    id="whisper_small",
    engine="whisper",
    model_id="small",
    display_name="Whisper Small",
    download_size_mb=480,
    vram_required_mb=1500,
    accuracy=3,
    speed=4,
    supports_mps=True,
    whisper_model_name="small",
    description="Good accuracy for most languages. Works well on 4GB+ GPUs.",
    pip_extras=["openai-whisper>=20250625"],
))

_register(ModelInfo(
    id="whisper_medium",
    engine="whisper",
    model_id="medium",
    display_name="Whisper Medium",
    download_size_mb=1500,
    vram_required_mb=3000,
    accuracy=4,
    speed=3,
    supports_mps=True,
    whisper_model_name="medium",
    description="High accuracy multi-language ASR. Needs 4GB+ VRAM.",
    pip_extras=["openai-whisper>=20250625"],
))

_register(ModelInfo(
    id="whisper_large_v3_turbo",
    engine="whisper",
    model_id="large-v3-turbo",
    display_name="Whisper Large v3 Turbo",
    download_size_mb=1600,
    vram_required_mb=4000,
    accuracy=5,
    speed=3,
    supports_mps=True,
    whisper_model_name="large-v3-turbo",
    description="Best Whisper model. Excellent accuracy with turbo speed optimization.",
    pip_extras=["openai-whisper>=20250625"],
))

_register(ModelInfo(
    id="qwen3_asr",
    engine="qwen3asr",
    model_id="Qwen/Qwen3-ASR-1.7B",
    display_name="Qwen3-ASR 1.7B",
    download_size_mb=2300,
    vram_required_mb=5000,
    accuracy=5,
    speed=2,
    supports_mps=False,
    description="State-of-the-art ASR by Qwen. Best accuracy, supports character-level timestamps. Warning: may OOM on audio >10min.",
    pip_extras=["qwen-asr>=0.0.6"],
))


def get_model(model_id: str) -> ModelInfo | None:
    return MODELS.get(model_id)


def get_models_for_engine(engine: str) -> list[ModelInfo]:
    return [m for m in MODELS.values() if m.engine == engine]


def get_all_models() -> list[ModelInfo]:
    return list(MODELS.values())


# ── Recommendation ──

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
            reason = "Not supported on Apple MPS"

        # Check VRAM
        if not model.is_cloud and device == "cuda":
            if model.vram_required_mb > vram_mb:
                compatible = False
                reason = f"Requires {model.vram_required_mb}MB VRAM, only {vram_mb}MB available"

        # CPU-only: only small models are practical
        if device == "cpu" and not model.is_cloud:
            if model.vram_required_mb > 2000:
                compatible = False
                reason = "Too large for CPU-only inference"

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
    compatible = [r for r in recs if r.compatible]

    if not compatible:
        return

    # Find best compatible model for recommendation
    recommended_id = _pick_recommended(hw.vram_mb, hw.recommended_device)
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
        return "whisper_tiny"  # Smallest local model for CPU-only

    # CUDA GPU
    # Note: qwen3_asr excluded from auto-recommendation due to OOM on audio >10min
    if vram_mb >= 6000:
        return "whisper_large_v3_turbo"
    elif vram_mb >= 2000:
        return "sensevoice_small"
    else:
        return "whisper_tiny"
