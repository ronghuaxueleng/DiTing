/// Constants migrated from worker_manager/constants.py and asr_worker/management/catalog.py

pub const UV_VERSION: &str = "0.7.12";
pub const PYTHON_VERSION: &str = "3.11";
pub const DEFAULT_WORKER_PORT: u16 = 8001;
pub const WORKER_HEALTH_TIMEOUT_SECS: u64 = 30;
pub const WORKER_HEALTH_INTERVAL_SECS: u64 = 2;

/// uv download URLs keyed by (os, arch)
pub fn uv_download_url() -> &'static str {
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    { concat!("https://github.com/astral-sh/uv/releases/download/0.7.12/uv-x86_64-pc-windows-msvc.zip") }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    { concat!("https://github.com/astral-sh/uv/releases/download/0.7.12/uv-x86_64-apple-darwin.tar.gz") }
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    { concat!("https://github.com/astral-sh/uv/releases/download/0.7.12/uv-aarch64-apple-darwin.tar.gz") }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    { concat!("https://github.com/astral-sh/uv/releases/download/0.7.12/uv-x86_64-unknown-linux-gnu.tar.gz") }
}

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
    pub engine: &'static str,
    pub model_id: &'static str,
    pub display_name: &'static str,
    pub download_size_mb: u32,
    pub vram_required_mb: u32,
    pub accuracy: u8,
    pub speed: u8,
    pub whisper_model_name: &'static str,
    pub pip_extras: &'static [&'static str],
}

pub const WHISPER_MODELS: &[ModelDef] = &[
    ModelDef {
        id: "whisper_tiny",
        engine: "whisper",
        model_id: "tiny",
        display_name: "Whisper Tiny",
        download_size_mb: 39,
        vram_required_mb: 400,
        accuracy: 2,
        speed: 5,
        whisper_model_name: "tiny",
        pip_extras: &["openai-whisper>=20250625"],
    },
    ModelDef {
        id: "whisper_small",
        engine: "whisper",
        model_id: "small",
        display_name: "Whisper Small",
        download_size_mb: 480,
        vram_required_mb: 1500,
        accuracy: 3,
        speed: 4,
        whisper_model_name: "small",
        pip_extras: &["openai-whisper>=20250625"],
    },
    ModelDef {
        id: "whisper_medium",
        engine: "whisper",
        model_id: "medium",
        display_name: "Whisper Medium",
        download_size_mb: 1500,
        vram_required_mb: 3000,
        accuracy: 4,
        speed: 3,
        whisper_model_name: "medium",
        pip_extras: &["openai-whisper>=20250625"],
    },
    ModelDef {
        id: "whisper_large_v3_turbo",
        engine: "whisper",
        model_id: "large-v3-turbo",
        display_name: "Whisper Large v3 Turbo",
        download_size_mb: 1600,
        vram_required_mb: 4000,
        accuracy: 5,
        speed: 3,
        whisper_model_name: "large-v3-turbo",
        pip_extras: &["openai-whisper>=20250625"],
    },
];

pub fn find_model(model_id: &str) -> Option<&'static ModelDef> {
    WHISPER_MODELS.iter().find(|m| m.id == model_id)
}

pub fn recommend_model(device: &str, vram_mb: u32) -> &'static str {
    match device {
        "mps" => {
            if vram_mb >= 4000 || vram_mb == 0 {
                "whisper_large_v3_turbo"
            } else {
                "whisper_small"
            }
        }
        "cpu" => "whisper_tiny",
        _ => {
            // CUDA
            if vram_mb >= 6000 {
                "whisper_large_v3_turbo"
            } else if vram_mb >= 2000 {
                "whisper_small"
            } else {
                "whisper_tiny"
            }
        }
    }
}
