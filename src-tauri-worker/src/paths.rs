use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

fn app_install_dir(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .resource_dir()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.to_path_buf()))
        .or_else(|| app.path().app_data_dir().ok())
}

pub fn default_runtime_root() -> PathBuf {
    // match worker_manager/constants.py
    if cfg!(target_os = "windows") {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("DiTing-Worker")
    } else {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(".diting-worker")
    }
}

pub fn default_runtime_root_for_app(app: &AppHandle) -> PathBuf {
    app_install_dir(app).unwrap_or_else(default_runtime_root)
}

pub fn resolve_runtime_root(app: &AppHandle, install_dir: &str) -> PathBuf {
    let trimmed = install_dir.trim();
    if trimmed.is_empty() {
        default_runtime_root_for_app(app)
    } else {
        PathBuf::from(trimmed)
    }
}

pub fn runtime_uv_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("uv")
}

pub fn runtime_engines_dir(runtime_root: &Path) -> PathBuf {
    runtime_root.join("engines")
}

pub fn runtime_engine_dir(runtime_root: &Path, engine_id: &str) -> PathBuf {
    runtime_engines_dir(runtime_root).join(engine_id)
}

pub fn default_engine_install_dir(app: &AppHandle, engine_id: &str) -> PathBuf {
    runtime_engine_dir(&default_runtime_root_for_app(app), engine_id)
}

pub fn infer_runtime_root_from_install_dir(app: &AppHandle, engine_id: &str, install_dir: &Path) -> PathBuf {
    let default_root = default_runtime_root_for_app(app);
    if install_dir == default_engine_install_dir(app, engine_id) {
        return default_root;
    }

    let engines_dir_name = install_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str());
    let engine_dir_name = install_dir.file_name().and_then(|name| name.to_str());

    if engines_dir_name == Some("engines") && engine_dir_name == Some(engine_id) {
        return install_dir
            .parent()
            .and_then(|parent| parent.parent())
            .map(|path| path.to_path_buf())
            .unwrap_or(default_root);
    }

    default_root
}

pub fn engine_venv_dir_from_install_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("venv")
}

pub fn engine_worker_src_dir_from_install_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("asr_worker")
}

pub fn engine_models_dir_from_install_dir(install_dir: &Path) -> PathBuf {
    install_dir.join("models")
}

pub fn manager_state_path_for_runtime_root(runtime_root: &Path) -> PathBuf {
    runtime_root.join("manager_state.json")
}

pub fn app_state_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(app_dir.join("worker-manager-state"))
}

pub fn app_manager_state_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(manager_state_path_for_runtime_root(&app_state_runtime_root(app)?))
}

pub async fn ensure_runtime_root_dirs(runtime_root: &Path) -> Result<(), String> {
    tokio::fs::create_dir_all(runtime_root)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(runtime_engines_dir(runtime_root))
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(runtime_uv_dir(runtime_root))
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn normalize_yaml_path(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/")
}

pub fn display_path(path: &Path) -> String {
    #[cfg(windows)]
    {
        let raw = path.to_string_lossy();
        raw
            .strip_prefix("\\\\?\\")
            .unwrap_or(raw.as_ref())
            .to_string()
    }

    #[cfg(not(windows))]
    {
        path.to_string_lossy().to_string()
    }
}
