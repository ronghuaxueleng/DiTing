/// Constants migrated from worker_manager/constants.py and asr_worker/management/catalog.py

pub const PYTHON_VERSION: &str = "3.11";
pub const WORKER_HEALTH_TIMEOUT_SECS: u64 = 30;
pub const WORKER_HEALTH_INTERVAL_SECS: u64 = 2;

/// uv binary name
pub fn uv_binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    { "uv.exe" }
    #[cfg(not(target_os = "windows"))]
    { "uv" }
}

/// Python executable path within a venv
pub fn venv_python(venv_dir: &std::path::Path) -> std::path::PathBuf {
    #[cfg(target_os = "windows")]
    { venv_dir.join("Scripts").join("python.exe") }
    #[cfg(not(target_os = "windows"))]
    { venv_dir.join("bin").join("python") }
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

pub const MIRROR_PYPI: &str = "https://mirrors.aliyun.com/pypi/simple/";
pub const MIRROR_HF_ENDPOINT: &str = "https://hf-mirror.com";
pub const MIRROR_UV_PYTHON: &str = "https://ghp.ci/https://github.com";

// ── Whisper model catalog (MVP: whisper only) ──

pub struct ModelDef {
    pub id: &'static str,
    pub whisper_model_name: &'static str,
}

pub const WHISPER_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "whisper_tiny",
        whisper_model_name: "tiny",
    },
    ModelDef {
        id: "whisper_small",
        whisper_model_name: "small",
    },
    ModelDef {
        id: "whisper_medium",
        whisper_model_name: "medium",
    },
    ModelDef {
        id: "whisper_large_v3_turbo",
        whisper_model_name: "large-v3-turbo",
    },
];

pub fn find_model(model_id: &str) -> Option<&'static ModelDef> {
    WHISPER_MODELS.iter().find(|m| m.id == model_id)
}
