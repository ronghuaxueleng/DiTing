use crate::{constants, hardware, manager_state, paths, worker};
use serde::Serialize;
use serde_json::json;
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
    InstallStep {
        key: "uv",
        label: "Prepare uv",
    },
    InstallStep {
        key: "python",
        label: "Install Python",
    },
    InstallStep {
        key: "venv",
        label: "Create virtualenv",
    },
    InstallStep {
        key: "deps",
        label: "Install dependencies",
    },
    InstallStep {
        key: "model",
        label: "Download model",
    },
    InstallStep {
        key: "worker",
        label: "Copy worker files",
    },
    InstallStep {
        key: "config",
        label: "Write configuration",
    },
    InstallStep {
        key: "state",
        label: "Save manager state",
    },
];

fn emit(
    app: &AppHandle,
    engine_id: &str,
    step: InstallStep,
    step_index: usize,
    completed_steps: usize,
    message: &str,
    install_dir: &Path,
    done: bool,
    error: Option<String>,
) {
    let payload = InstallProgressPayload {
        engine_id: engine_id.to_string(),
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
    tokio::fs::copy(&source_uv, &dest_uv).await.map_err(|e| {
        format!(
            "Failed to copy uv from {}: {e}",
            source_uv.to_string_lossy()
        )
    })?;

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

fn install_envs(use_mirror: bool, proxy: &str) -> Vec<(String, String)> {
    let mut envs = Vec::new();

    if use_mirror {
        envs.push((
            "UV_PYTHON_INSTALL_MIRROR".to_string(),
            constants::MIRROR_UV_PYTHON.to_string(),
        ));
        envs.push((
            "UV_INDEX_URL".to_string(),
            constants::MIRROR_PYPI.to_string(),
        ));
        envs.push((
            "HF_ENDPOINT".to_string(),
            constants::MIRROR_HF_ENDPOINT.to_string(),
        ));
    }

    let trimmed_proxy = proxy.trim();
    if !trimmed_proxy.is_empty() {
        let proxy_value = trimmed_proxy.to_string();
        envs.push(("HTTP_PROXY".to_string(), proxy_value.clone()));
        envs.push(("HTTPS_PROXY".to_string(), proxy_value.clone()));
        envs.push(("ALL_PROXY".to_string(), proxy_value));
    }

    envs
}

async fn run_uv(app: &AppHandle, args: &[String], envs: &[(String, String)]) -> Result<(), String> {
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

async fn run_python_snippet(
    python: &Path,
    snippet: &str,
    envs: &[(String, String)],
) -> Result<(), String> {
    let mut cmd = Command::new(python);
    cmd.args(["-c", snippet]);

    for (k, v) in envs {
        if !v.is_empty() {
            cmd.env(k, v);
        }
    }

    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(format!(
            "Python command failed: {}\n{}\n{}",
            out.status,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ));
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

fn normalize_device(device: &str) -> String {
    let trimmed = device.trim();
    if trimmed.is_empty() {
        "cpu".to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_optional_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn resolve_compute_key(device: &str, compute_key: &str) -> String {
    let trimmed = compute_key.trim();
    if !trimmed.is_empty() {
        return trimmed.to_string();
    }

    if device == "mps" {
        return "mps".to_string();
    }

    if device.starts_with("cuda") {
        return hardware::detect()
            .await
            .map(|info| info.compute_key)
            .unwrap_or_else(|_| "cpu".to_string());
    }

    "cpu".to_string()
}

fn resolve_model(engine_id: &str, model_id: &str) -> Result<&'static constants::ModelDef, String> {
    let trimmed_model_id = model_id.trim();
    if trimmed_model_id.is_empty() {
        return constants::default_model_for_engine(engine_id)
            .ok_or_else(|| format!("No default model configured for engine {engine_id}"));
    }

    constants::find_model(engine_id, trimmed_model_id)
        .ok_or_else(|| format!("Unknown model {trimmed_model_id} for engine {engine_id}"))
}

async fn install_pytorch(
    app: &AppHandle,
    venv_dir: &Path,
    compute_key: &str,
    use_mirror: bool,
    envs: &[(String, String)],
) -> Result<(), String> {
    let mut args = vec![
        "pip".to_string(),
        "install".to_string(),
        "torch".to_string(),
        "torchaudio".to_string(),
        "--python".to_string(),
        venv_dir.to_string_lossy().to_string(),
    ];

    if let Some(url) = constants::pytorch_index_url(compute_key, use_mirror) {
        args.push("--index-url".to_string());
        args.push(url.to_string());
    }

    run_uv(app, &args, envs).await
}

async fn install_engine_packages(
    app: &AppHandle,
    venv_dir: &Path,
    engine: &constants::EngineDef,
    envs: &[(String, String)],
) -> Result<(), String> {
    let mut args = vec!["pip".to_string(), "install".to_string()];
    args.extend(
        constants::BASE_PIP_PACKAGES
            .iter()
            .map(|pkg| pkg.to_string()),
    );
    args.extend(engine.pip_packages.iter().map(|pkg| pkg.to_string()));
    args.push("--python".to_string());
    args.push(venv_dir.to_string_lossy().to_string());

    run_uv(app, &args, envs).await
}

async fn download_initial_model(
    python: &Path,
    model: &constants::ModelDef,
    models_dir: &Path,
    envs: &[(String, String)],
) -> Result<(), String> {
    let models_dir_str = models_dir.to_string_lossy().to_string();

    let snippet = match model.engine_name {
        "whisper" => format!(
            "import whisper\nwhisper.load_model({:?}, download_root={:?})",
            model.whisper_model_name.unwrap_or(model.model_id),
            models_dir_str
        ),
        "sensevoice" => format!(
            "import os\nos.environ['MODELSCOPE_CACHE'] = {:?}\nfrom modelscope import snapshot_download\nsnapshot_download({:?}, cache_dir={:?})\nsnapshot_download('iic/speech_fsmn_vad_zh-cn-16k-common-pytorch', cache_dir={:?})",
            models_dir_str,
            model.model_id,
            models_dir_str,
            models_dir_str
        ),
        other => return Err(format!("Initial model download is not implemented for engine {other}")),
    };

    run_python_snippet(python, &snippet, envs).await
}

fn build_models_config(model: &constants::ModelDef) -> serde_json::Value {
    match model.engine_name {
        "whisper" => json!({
            "whisper": {
                "model_name": model.whisper_model_name.unwrap_or(model.model_id),
                "download_root": null
            }
        }),
        "sensevoice" => json!({
            "sensevoice": {
                "model_id": model.model_id,
                "vad_model": "iic/speech_fsmn_vad_zh-cn-16k-common-pytorch",
                "vad_max_segment_time": 30000,
                "cache_dir": null
            }
        }),
        _ => json!({}),
    }
}

fn write_worker_config(
    worker_dir: &Path,
    engine_name: &str,
    port: u16,
    device: &str,
    model_base_path: &Path,
    server_url: Option<&str>,
    model: &constants::ModelDef,
) -> Result<(), String> {
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
        models: serde_json::Value,
    }

    let cfg = WorkerConfig {
        engine: engine_name.to_string(),
        port,
        device: device.to_string(),
        max_concurrency: 1,
        server_url: server_url.map(|value| value.to_string()),
        advertise_url: None,
        shared_paths: vec![],
        temp_upload_dir: "temp_uploads".to_string(),
        model_base_path: paths::normalize_yaml_path(model_base_path),
        models: build_models_config(model),
    };

    let yaml = serde_yaml::to_string(&cfg).map_err(|e| e.to_string())?;
    let header = "# DiTing ASR Worker Configuration\n# Generated by DiTing Worker Manager\n\n";
    std::fs::write(
        worker_dir.join("worker_config.yaml"),
        format!("{}{}", header, yaml),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn install_engine(
    app: &AppHandle,
    engine_id: &str,
    port: u16,
    model_id: &str,
    device: &str,
    compute_key: &str,
    use_mirror: bool,
    proxy: &str,
    server_url: &str,
    install_dir: &str,
) -> Result<(), String> {
    let engine =
        constants::find_engine(engine_id).ok_or_else(|| format!("Unknown engine: {engine_id}"))?;
    let model = resolve_model(engine_id, model_id)?;
    let resolved_device = normalize_device(device);
    let resolved_compute_key = resolve_compute_key(&resolved_device, compute_key).await;
    let normalized_server_url = normalize_optional_string(server_url);

    let engine_dir = paths::resolve_engine_install_dir(app, engine_id, install_dir);
    let venv_dir = paths::engine_venv_dir_from_install_dir(&engine_dir);
    let models_dir = paths::engine_models_dir_from_install_dir(&engine_dir);
    let worker_dir = paths::engine_worker_src_dir_from_install_dir(&engine_dir);
    let install_envs = install_envs(use_mirror, proxy);

    let mut current_step_index = 0usize;
    let mut completed_steps = 0usize;

    let result: Result<(), String> = async {
        let _ = worker::stop_worker(app, engine_id).await;

        tokio::fs::create_dir_all(&engine_dir)
            .await
            .map_err(|e| e.to_string())?;
        tokio::fs::create_dir_all(&models_dir)
            .await
            .map_err(|e| e.to_string())?;

        current_step_index = 0;
        completed_steps = 0;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[0],
            current_step_index,
            completed_steps,
            "Preparing uv...",
            &engine_dir,
            false,
            None,
        );
        ensure_uv_ready(app).await?;

        current_step_index = 1;
        completed_steps = 1;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[1],
            current_step_index,
            completed_steps,
            &format!("Installing Python {} via uv...", constants::PYTHON_VERSION),
            &engine_dir,
            false,
            None,
        );
        run_uv(
            app,
            &[
                "python".to_string(),
                "install".to_string(),
                constants::PYTHON_VERSION.to_string(),
            ],
            &install_envs,
        )
        .await?;

        current_step_index = 2;
        completed_steps = 2;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[2],
            current_step_index,
            completed_steps,
            "Creating virtualenv...",
            &engine_dir,
            false,
            None,
        );
        run_uv(
            app,
            &[
                "venv".to_string(),
                venv_dir.to_string_lossy().to_string(),
                "--python".to_string(),
                constants::PYTHON_VERSION.to_string(),
            ],
            &install_envs,
        )
        .await?;

        current_step_index = 3;
        completed_steps = 3;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[3],
            current_step_index,
            completed_steps,
            &format!(
                "Installing dependencies (torch + {})...",
                engine.display_name
            ),
            &engine_dir,
            false,
            None,
        );
        install_pytorch(
            app,
            &venv_dir,
            &resolved_compute_key,
            use_mirror,
            &install_envs,
        )
        .await?;
        install_engine_packages(app, &venv_dir, engine, &install_envs).await?;

        current_step_index = 4;
        completed_steps = 4;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[4],
            current_step_index,
            completed_steps,
            &format!("Downloading initial model: {}...", model.display_name),
            &engine_dir,
            false,
            None,
        );
        let venv_python = constants::venv_python(&venv_dir);
        download_initial_model(&venv_python, model, &models_dir, &install_envs).await?;

        current_step_index = 5;
        completed_steps = 5;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[5],
            current_step_index,
            completed_steps,
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

        current_step_index = 6;
        completed_steps = 6;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[6],
            current_step_index,
            completed_steps,
            "Writing worker_config.yaml...",
            &engine_dir,
            false,
            None,
        );
        write_worker_config(
            &worker_dir,
            engine.engine_name,
            port,
            &resolved_device,
            &models_dir,
            normalized_server_url.as_deref(),
            model,
        )?;

        current_step_index = 7;
        completed_steps = 7;
        emit(
            app,
            engine_id,
            INSTALL_STEPS[7],
            current_step_index,
            completed_steps,
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
                display_name: engine.display_name.to_string(),
                install_dir: engine_dir.to_string_lossy().to_string(),
                port,
                installed_at: manager_state::now_iso(),
                last_started: None,
                engine_name: engine.engine_name.to_string(),
                device: resolved_device.clone(),
                server_url: normalized_server_url.clone(),
                initial_model_id: Some(model.id.to_string()),
            },
        );
        manager_state::save_state(app, &state).await?;

        emit(
            app,
            engine_id,
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
        emit(
            app,
            engine_id,
            INSTALL_STEPS[current_step_index],
            current_step_index,
            completed_steps,
            error,
            &engine_dir,
            true,
            Some(error.clone()),
        );
    }

    result
}

pub async fn install_whisper_engine(
    app: &AppHandle,
    port: u16,
    model_id: &str,
    use_mirror: bool,
    proxy: &str,
    install_dir: &str,
) -> Result<(), String> {
    install_engine(
        app,
        "whisper-openai",
        port,
        model_id,
        "cpu",
        "cpu",
        use_mirror,
        proxy,
        "",
        install_dir,
    )
    .await
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
