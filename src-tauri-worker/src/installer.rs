use crate::{constants, manager_state, paths, worker};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgressPayload {
    pub engine_id: String,
    pub step: String,
    pub message: String,
}

fn emit(app: &AppHandle, step: &str, message: &str) {
    let payload = InstallProgressPayload {
        engine_id: "whisper-openai".to_string(),
        step: step.to_string(),
        message: message.to_string(),
    };
    let _ = app.emit("install-progress", payload);
}

fn uv_path(app: &AppHandle) -> PathBuf {
    paths::uv_dir(app).join(constants::uv_binary_name())
}

fn resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().resource_dir().map_err(|e| e.to_string())
}

fn candidate_uv_sources(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = resource_dir(app) {
        candidates.push(
            resource_dir
                .join("resources")
                .join("uv")
                .join(constants::uv_binary_name()),
        );
        candidates.push(resource_dir.join("uv").join(constants::uv_binary_name()));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(
            current_dir
                .join("src-tauri-worker")
                .join("resources")
                .join("uv")
                .join(constants::uv_binary_name()),
        );
        candidates.push(
            current_dir
                .join("resources")
                .join("uv")
                .join(constants::uv_binary_name()),
        );
        candidates.push(
            current_dir
                .join("build")
                .join("uv_bundle")
                .join(constants::uv_binary_name()),
        );

        if let Some(parent) = current_dir.parent() {
            candidates.push(
                parent
                    .join("src-tauri-worker")
                    .join("resources")
                    .join("uv")
                    .join(constants::uv_binary_name()),
            );
            candidates.push(
                parent
                    .join("build")
                    .join("uv_bundle")
                    .join(constants::uv_binary_name()),
            );
        }
    }

    candidates
}

fn resolve_uv_source(app: &AppHandle) -> Result<PathBuf, String> {
    let candidates = candidate_uv_sources(app);
    for candidate in &candidates {
        if candidate.is_file() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "Bundled uv binary not found. Checked: {}",
        candidates
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn candidate_worker_sources(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = resource_dir(app) {
        candidates.push(resource_dir.join("asr_worker"));
        candidates.push(resource_dir.join("resources").join("asr_worker"));
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("asr_worker"));
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.join("asr_worker"));
        }
    }

    candidates
}

fn resolve_worker_source(app: &AppHandle) -> Result<PathBuf, String> {
    let candidates = candidate_worker_sources(app);
    for candidate in &candidates {
        if candidate.join("main.py").is_file() {
            return Ok(candidate.clone());
        }
    }

    Err(format!(
        "asr_worker source directory not found. Checked: {}",
        candidates
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

async fn ensure_uv_ready(app: &AppHandle) -> Result<(), String> {
    let dest_uv = uv_path(app);
    if dest_uv.is_file() {
        return Ok(());
    }

    let source_uv = resolve_uv_source(app)?;
    tokio::fs::create_dir_all(paths::uv_dir(app))
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::copy(&source_uv, &dest_uv)
        .await
        .map_err(|e| format!("Failed to copy uv from {}: {e}", source_uv.to_string_lossy()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&dest_uv)
            .await
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(&dest_uv, perms)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

async fn run_uv(app: &AppHandle, args: &[&str], envs: Vec<(&str, String)>) -> Result<(), String> {
    let uv = uv_path(app);
    if !uv.is_file() {
        return Err(format!("uv not found at {}", uv.to_string_lossy()));
    }

    let mut cmd = Command::new(uv);
    cmd.args(args);
    cmd.env("UV_NO_PROGRESS", "1");

    for (k, v) in envs {
        if !v.is_empty() {
            cmd.env(k, v);
        }
    }

    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("uv failed: {}\n{}\n{}", out.status, stdout, stderr));
    }
    Ok(())
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];

    while let Some((src_dir, dst_dir)) = stack.pop() {
        tokio::fs::create_dir_all(&dst_dir)
            .await
            .map_err(|e| e.to_string())?;

        let mut rd = tokio::fs::read_dir(&src_dir)
            .await
            .map_err(|e| e.to_string())?;
        while let Some(ent) = rd.next_entry().await.map_err(|e| e.to_string())? {
            let ft = ent.file_type().await.map_err(|e| e.to_string())?;
            let src_path = ent.path();
            let dst_path = dst_dir.join(ent.file_name());
            if ft.is_dir() {
                stack.push((src_path, dst_path));
            } else if ft.is_file() {
                tokio::fs::copy(&src_path, &dst_path)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }

    Ok(())
}

fn write_worker_config(
    worker_dir: &Path,
    port: u16,
    device: &str,
    model_base_path: &Path,
    model_name: &str,
) -> Result<(), String> {
    #[derive(Serialize)]
    struct ModelsWhisper {
        model_name: String,
        download_root: Option<String>,
    }

    #[derive(Serialize)]
    struct Models {
        whisper: ModelsWhisper,
    }

    #[derive(Serialize)]
    struct WorkerConfig {
        engine: String,
        port: u16,
        device: String,
        max_concurrency: u8,
        server_url: Option<String>,
        advertise_url: Option<String>,
        shared_paths: Vec<String>,
        temp_upload_dir: String,
        model_base_path: String,
        models: Models,
    }

    let cfg = WorkerConfig {
        engine: "whisper".to_string(),
        port,
        device: device.to_string(),
        max_concurrency: 1,
        server_url: None,
        advertise_url: None,
        shared_paths: vec![],
        temp_upload_dir: "temp_uploads".to_string(),
        model_base_path: paths::normalize_yaml_path(model_base_path),
        models: Models {
            whisper: ModelsWhisper {
                model_name: model_name.to_string(),
                download_root: None,
            },
        },
    };

    let yaml = serde_yaml::to_string(&cfg).map_err(|e| e.to_string())?;
    let header = "# DiTing ASR Worker Configuration\n# Generated by DiTing Worker Manager\n\n";
    std::fs::write(worker_dir.join("worker_config.yaml"), format!("{}{}", header, yaml))
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn install_whisper_engine(
    app: &AppHandle,
    port: u16,
    model_id: &str,
    use_mirror: bool,
    proxy: &str,
) -> Result<(), String> {
    let engine_id = "whisper-openai";
    let engine_dir = paths::engine_dir(app, engine_id);
    let venv_dir = paths::engine_venv_dir(app, engine_id);
    let models_dir = paths::engine_models_dir(app, engine_id);
    let worker_dir = paths::engine_worker_src_dir(app, engine_id);
    let whisper_model_name = constants::find_model(model_id)
        .map(|m| m.whisper_model_name)
        .unwrap_or(model_id);

    let _ = worker::stop_worker(app, engine_id).await;

    tokio::fs::create_dir_all(&engine_dir)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::create_dir_all(&models_dir)
        .await
        .map_err(|e| e.to_string())?;

    emit(app, "uv", "Preparing uv...");
    ensure_uv_ready(app).await?;

    let mut envs: Vec<(&str, String)> = vec![];
    if use_mirror {
        envs.push(("UV_PYTHON_INSTALL_MIRROR", constants::MIRROR_UV_PYTHON.to_string()));
        envs.push(("UV_INDEX_URL", constants::MIRROR_PYPI.to_string()));
        envs.push(("HF_ENDPOINT", constants::MIRROR_HF_ENDPOINT.to_string()));
    }
    if !proxy.is_empty() {
        envs.push(("HTTP_PROXY", proxy.to_string()));
        envs.push(("HTTPS_PROXY", proxy.to_string()));
        envs.push(("ALL_PROXY", proxy.to_string()));
    }

    emit(app, "python", "Installing Python 3.11 via uv...");
    run_uv(app, &["python", "install", constants::PYTHON_VERSION], envs.clone()).await?;

    emit(app, "venv", "Creating virtualenv...");
    run_uv(
        app,
        &[
            "venv",
            venv_dir.to_string_lossy().as_ref(),
            "--python",
            constants::PYTHON_VERSION,
        ],
        envs.clone(),
    )
    .await?;

    emit(app, "deps", "Installing dependencies (torch + whisper + fastapi)...");
    if let Some(url) = constants::pytorch_index_url("cpu", use_mirror) {
        run_uv(
            app,
            &[
                "pip",
                "install",
                "torch",
                "torchaudio",
                "--python",
                venv_dir.to_string_lossy().as_ref(),
                "--index-url",
                url,
            ],
            envs.clone(),
        )
        .await?;
    } else {
        run_uv(
            app,
            &[
                "pip",
                "install",
                "torch",
                "torchaudio",
                "--python",
                venv_dir.to_string_lossy().as_ref(),
            ],
            envs.clone(),
        )
        .await?;
    }

    run_uv(
        app,
        &[
            "pip",
            "install",
            "openai-whisper>=20250625",
            "fastapi>=0.128.0",
            "uvicorn>=0.40.0",
            "python-multipart>=0.0.21",
            "pyyaml",
            "numpy",
            "pydantic>=2",
            "starlette>=0.47.0",
            "httpx>=0.28.0",
            "--python",
            venv_dir.to_string_lossy().as_ref(),
        ],
        envs.clone(),
    )
    .await?;

    emit(app, "model", "Downloading whisper model...");
    let venv_python = constants::venv_python(&venv_dir);
    let snippet = format!(
        "import os, whisper; os.environ['WHISPER_MODEL_PATH']=r'{}'; whisper.load_model('{}')",
        models_dir.to_string_lossy(),
        whisper_model_name
    );
    let out = Command::new(&venv_python)
        .args(["-c", &snippet])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "model download failed: {}\n{}\n{}",
            out.status,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ));
    }

    emit(app, "worker", "Copying asr_worker sources...");
    let worker_source = resolve_worker_source(app)?;
    if worker_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&worker_dir).await;
    }
    copy_dir_recursive(&worker_source, &worker_dir).await?;

    emit(app, "config", "Writing worker_config.yaml...");
    write_worker_config(&worker_dir, port, "cpu", &models_dir, whisper_model_name)?;

    emit(app, "state", "Saving manager state...");
    let mut state = manager_state::load_state(app).await?;
    state.engines.insert(
        engine_id.to_string(),
        manager_state::EngineInfo {
            engine_id: engine_id.to_string(),
            display_name: "Whisper (OpenAI)".to_string(),
            install_dir: engine_dir.to_string_lossy().to_string(),
            port,
            installed_at: manager_state::now_iso(),
            last_started: None,
        },
    );
    manager_state::save_state(app, &state).await?;

    emit(app, "done", "Installation complete.");
    Ok(())
}

pub async fn uninstall_engine(app: &AppHandle, engine_id: &str) -> Result<(), String> {
    let _ = worker::stop_worker(app, engine_id).await;

    let engine_dir = paths::engine_dir(app, engine_id);
    if engine_dir.exists() {
        tokio::fs::remove_dir_all(&engine_dir)
            .await
            .map_err(|e| format!("Failed to remove engine directory: {e}"))?;
    }

    let mut state = manager_state::load_state(app).await?;
    state.engines.remove(engine_id);
    manager_state::save_state(app, &state).await?;
    Ok(())
}
