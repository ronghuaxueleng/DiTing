use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn default_install_dir() -> PathBuf {
    // match worker_manager/constants.py
    if cfg!(target_os = "windows") {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
            .join("DiTing-Worker")
    } else {
        dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
            .join(".diting-worker")
    }
}

pub fn base_dir(app: &AppHandle) -> PathBuf {
    // allow override via app config in future; currently default
    let _ = app;
    default_install_dir()
}

pub fn uv_dir(app: &AppHandle) -> PathBuf {
    base_dir(app).join("uv")
}

pub fn engines_dir(app: &AppHandle) -> PathBuf {
    base_dir(app).join("engines")
}

pub fn engine_dir(app: &AppHandle, engine_id: &str) -> PathBuf {
    engines_dir(app).join(engine_id)
}

pub fn engine_venv_dir(app: &AppHandle, engine_id: &str) -> PathBuf {
    engine_dir(app, engine_id).join("venv")
}

pub fn engine_worker_src_dir(app: &AppHandle, engine_id: &str) -> PathBuf {
    engine_dir(app, engine_id).join("asr_worker")
}

pub fn engine_models_dir(app: &AppHandle, engine_id: &str) -> PathBuf {
    engine_dir(app, engine_id).join("models")
}

pub fn manager_state_path(app: &AppHandle) -> PathBuf {
    base_dir(app).join("manager_state.json")
}

pub async fn ensure_base_dirs(app: &AppHandle) -> Result<(), String> {
    let base = base_dir(app);
    let engines = engines_dir(app);
    let uv = uv_dir(app);
    tokio::fs::create_dir_all(&base).await.map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&engines).await.map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&uv).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn normalize_yaml_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}
