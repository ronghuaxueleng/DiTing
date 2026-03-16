"""Model metadata registry — all available ASR engine/model combinations."""

from dataclasses import dataclass


@dataclass
class ModelInfo:
    """Metadata for a single ASR engine + model combination."""
    id: str
    engine: str           # sensevoice, whisper, qwen3asr, bailian
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

_register(ModelInfo(
    id="bailian",
    engine="bailian",
    model_id="cloud",
    display_name="Bailian Cloud ASR",
    download_size_mb=0,
    vram_required_mb=0,
    accuracy=4,
    speed=4,
    supports_mps=True,
    is_cloud=True,
    description="Alibaba Cloud ASR service. No GPU needed, requires API key and internet.",
    pip_extras=[],
))


def get_model(model_id: str) -> ModelInfo | None:
    return MODELS.get(model_id)


def get_models_for_engine(engine: str) -> list[ModelInfo]:
    return [m for m in MODELS.values() if m.engine == engine]


def get_all_models() -> list[ModelInfo]:
    return list(MODELS.values())
