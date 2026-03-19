/// Constants migrated from worker_manager/constants.py and asr_worker/management/catalog.py

pub const PYTHON_VERSION: &str = "3.11";
pub const WORKER_HEALTH_TIMEOUT_SECS: u64 = 30;
pub const WORKER_HEALTH_INTERVAL_SECS: u64 = 2;

pub const MIRROR_PYPI: &str = "https://mirrors.aliyun.com/pypi/simple/";
pub const MIRROR_HF_ENDPOINT: &str = "https://hf-mirror.com";
pub const MIRROR_UV_PYTHON: &str = "https://ghp.ci/https://github.com";

pub const BASE_PIP_PACKAGES: &[&str] = &[
    "fastapi>=0.128.0",
    "uvicorn>=0.40.0",
    "python-multipart>=0.0.21",
    "pyyaml",
    "numpy",
    "pydantic>=2",
    "starlette>=0.47.0",
    "httpx>=0.28.0",
];

pub const WHISPER_PIP_PACKAGES: &[&str] = &["openai-whisper>=20250625"];
pub const SENSEVOICE_PIP_PACKAGES: &[&str] =
    &["funasr>=1.3.0", "modelscope>=1.34.0", "huggingface_hub"];

#[derive(Debug, Clone, Copy)]
pub struct EngineDef {
    pub id: &'static str,
    pub engine_name: &'static str,
    pub display_name: &'static str,
    pub default_model_id: &'static str,
    pub pip_packages: &'static [&'static str],
}

#[derive(Debug, Clone, Copy)]
pub struct ModelDef {
    pub id: &'static str,
    pub engine_id: &'static str,
    pub engine_name: &'static str,
    pub model_id: &'static str,
    pub display_name: &'static str,
    pub whisper_model_name: Option<&'static str>,
}

pub const ENGINES: &[EngineDef] = &[
    EngineDef {
        id: "whisper-openai",
        engine_name: "whisper",
        display_name: "Whisper (OpenAI)",
        default_model_id: "whisper_large_v3_turbo",
        pip_packages: WHISPER_PIP_PACKAGES,
    },
    EngineDef {
        id: "sensevoice",
        engine_name: "sensevoice",
        display_name: "SenseVoice",
        default_model_id: "sensevoice_small",
        pip_packages: SENSEVOICE_PIP_PACKAGES,
    },
];

pub const MODELS: &[ModelDef] = &[
    ModelDef {
        id: "whisper_tiny",
        engine_id: "whisper-openai",
        engine_name: "whisper",
        model_id: "tiny",
        display_name: "Whisper Tiny",
        whisper_model_name: Some("tiny"),
    },
    ModelDef {
        id: "whisper_small",
        engine_id: "whisper-openai",
        engine_name: "whisper",
        model_id: "small",
        display_name: "Whisper Small",
        whisper_model_name: Some("small"),
    },
    ModelDef {
        id: "whisper_medium",
        engine_id: "whisper-openai",
        engine_name: "whisper",
        model_id: "medium",
        display_name: "Whisper Medium",
        whisper_model_name: Some("medium"),
    },
    ModelDef {
        id: "whisper_large_v3_turbo",
        engine_id: "whisper-openai",
        engine_name: "whisper",
        model_id: "large-v3-turbo",
        display_name: "Whisper Large V3 Turbo",
        whisper_model_name: Some("large-v3-turbo"),
    },
    ModelDef {
        id: "sensevoice_small",
        engine_id: "sensevoice",
        engine_name: "sensevoice",
        model_id: "iic/SenseVoiceSmall",
        display_name: "SenseVoice Small",
        whisper_model_name: None,
    },
];

/// uv binary name
pub fn uv_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "uv.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "uv"
    }
}

/// Python executable path within a venv
pub fn venv_python(venv_dir: &std::path::Path) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    {
        venv_dir.join("Scripts").join("python.exe")
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv_dir.join("bin").join("python")
    }
}

pub fn find_engine(engine_id: &str) -> Option<&'static EngineDef> {
    ENGINES.iter().find(|engine| engine.id == engine_id)
}

pub fn engine_name_for_id(engine_id: &str) -> Option<&'static str> {
    find_engine(engine_id).map(|engine| engine.engine_name)
}

pub fn display_name_for_id(engine_id: &str) -> Option<&'static str> {
    find_engine(engine_id).map(|engine| engine.display_name)
}

pub fn find_model(engine_id: &str, model_id: &str) -> Option<&'static ModelDef> {
    MODELS
        .iter()
        .find(|model| model.engine_id == engine_id && model.id == model_id)
}

pub fn default_model_for_engine(engine_id: &str) -> Option<&'static ModelDef> {
    let engine = find_engine(engine_id)?;
    find_model(engine_id, engine.default_model_id)
}

// ── PyTorch index URLs ──

pub fn pytorch_index_url(compute_key: &str, use_mirror: bool) -> Option<&'static str> {
    if use_mirror {
        match compute_key {
            "cu121" => Some("https://mirror.sjtu.edu.cn/pytorch-wheels/cu121"),
            "cu124" => Some("https://mirror.sjtu.edu.cn/pytorch-wheels/cu124"),
            "cpu" => Some("https://mirror.sjtu.edu.cn/pytorch-wheels/cpu"),
            _ => None, // mps uses default PyPI
        }
    } else {
        match compute_key {
            "cu121" => Some("https://download.pytorch.org/whl/cu121"),
            "cu124" => Some("https://download.pytorch.org/whl/cu124"),
            "cpu" => Some("https://download.pytorch.org/whl/cpu"),
            _ => None,
        }
    }
}
