use crate::{constants, manager_state, paths, worker};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tokio::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgressPayload {
    pub engine_id: String,
    pub step_key: String,
    pub step_label: String,
    pub step_index: u8,
    pub step_total: u8,
    pub completed_steps: u8,
    pub message: String,
    pub install_dir: String,
    pub done: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy)]
struct InstallStep {
    key: &'static str,
    label: &'static str,
}

const INSTALL_STEPS: [InstallStep; 8] = [
    InstallStep { key: "uv", label: "Prepare uv" },
    InstallStep { key: "python", label: "Install Python" },
    InstallStep { key: "venv", label: "Create virtualenv" },
    InstallStep { key: "deps", label: "Install dependencies" },
    InstallStep { key: "model", label: "Download model" },
    InstallStep { key: "worker", label: "Copy worker files" },
    InstallStep { key: "config", label: "Write configuration" },
    InstallStep { key: "state", label: "Save manager state" },
];

fn emit(
    app: &AppHandle,
    step: InstallStep,
    step_index: usize,
    completed_steps: usize,
    message: &str,
    install_dir: &Path,
    done: bool,
    error: Option<String>,
) {
    let payload = InstallProgressPayload {
        engine_id: "whisper-openai".to_string(),
        step_key: step.key.to_string(),
        step_label: step.label.to_string(),
        step_index: (step_index + 1) as u8,
        step_total: INSTALL_STEPS.len() as u8,
        completed_steps: completed_steps as u8,
        message: message.to_string(),
        install_dir: install_dir.to_string_lossy().to_string(),
        done,
        error,
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
    install_dir: &str,
) -> Result<(), String> {
    let engine_id = "whisper-openai";
    let engine_dir = paths::resolve_engine_install_dir(app, engine_id, install_dir);
    let venv_dir = paths::engine_venv_dir_from_install_dir(&engine_dir);
    let models_dir = paths::engine_models_dir_from_install_dir(&engine_dir);
    let worker_dir = paths::engine_worker_src_dir_from_install_dir(&engine_dir);
    let whisper_model_name = constants::find_model(model_id)
        .map(|m| m.whisper_model_name)
        .unwrap_or(model_id);

    let result: Result<(), String> = async {
        let _ = worker::stop_worker(app, engine_id).await;

        tokio::fs::create_dir_all(&engine_dir)
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::create_dir_all(&models_dir)
            .await
            .map_err(|e| e.to_string())?;

        emit(app, INSTALL_STEPS[0], 0, 0, "Preparing uv...", &engine_dir, false, None);
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

        emit(
            app,
            INSTALL_STEPS[1],
            1,
            1,
            "Installing Python 3.11 via uv...",
            &engine_dir,
            false,
            None,
        );
        run_uv(app, &["python", "install", constants::PYTHON_VERSION], envs.clone()).await?;

        emit(
            app,
            INSTALL_STEPS[2],
            2,
            2,
            "Creating virtualenv...",
            &engine_dir,
            false,
            None,
        );
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

        emit(
            app,
            INSTALL_STEPS[3],
            3,
            3,
            "Installing dependencies (torch + whisper + fastapi)...",
            &engine_dir,
            false,
            None,
        );
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

        emit(
            app,
            INSTALL_STEPS[4],
            4,
            4,
            "Downloading whisper model...",
            &engine_dir,
            false,
            None,
        );
        let venv_python = constants::venv_python(&venv_dir);
        let snippet = format!(
            "import whisper; whisper.load_model('{}', download_root=r'{}')",
            whisper_model_name,
            models_dir.to_string_lossy()
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

        emit(
            app,
            INSTALL_STEPS[5],
            5,
            5,
            "Copying asr_worker sources...",
            &engine_dir,
            false,
            None,
        );
        let worker_source = resolve_worker_source(app)?;
        if worker_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&worker_dir).await;
        }
        copy_dir_recursive(&worker_source, &worker_dir).await?;

        emit(
            app,
            INSTALL_STEPS[6],
            6,
            6,
            "Writing worker_config.yaml...",
            &engine_dir,
            false,
            None,
        );
        write_worker_config(&worker_dir, port, "cpu", &models_dir, whisper_model_name)?;

        emit(
            app,
            INSTALL_STEPS[7],
            7,
            7,
            "Saving manager state...",
            &engine_dir,
            false,
            None,
        );
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

        emit(
            app,
            INSTALL_STEPS[7],
            7,
            INSTALL_STEPS.len(),
            "Installation complete.",
            &engine_dir,
            true,
            None,
        );
        Ok(())
    }
    .await;

    if let Err(error) = &result {
        let (step, step_index, completed_steps) = match INSTALL_STEPS.last() {
            Some(step) => (*step, INSTALL_STEPS.len() - 1, 0),
            None => (
                InstallStep {
                    key: "failed",
                    label: "Install failed",
                },
                0,
                0,
            ),
        };
        emit(
            app,
            step,
            step_index,
            completed_steps,
            error,
            &engine_dir,
            true,
            Some(error.clone()),
        );
    }

    result
}

pub async fn uninstall_engine(app: &AppHandle, engine_id: &str) -> Result<(), String> {
    let _ = worker::stop_worker(app, engine_id).await;

    let mut state = manager_state::load_state(app).await?;
    let engine_dir = state
        .engines
        .get(engine_id)
        .map(|engine| PathBuf::from(&engine.install_dir))
        .unwrap_or_else(|| paths::engine_dir(app, engine_id));

    if engine_dir.exists() {
        tokio::fs::remove_dir_all(&engine_dir)
            .await
            .map_err(|e| format!("Failed to remove engine directory: {e}"))?;
    }

    state.engines.remove(engine_id);
    manager_state::save_state(app, &state).await?;
    Ok(())
}
