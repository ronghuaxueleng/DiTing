use crate::{constants, manager_state, paths};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, process::ExitStatus, sync::Mutex};
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};

static CHILD: once_cell::sync::Lazy<Mutex<HashMap<String, Child>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HealthPayload {
    pub status: Option<String>,
    pub engine: Option<String>,
    pub loaded: Option<bool>,
    pub device: Option<String>,
    pub model_id: Option<String>,
    pub management: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WorkerStatus {
    pub running: bool,
    pub healthy: bool,
    pub url: String,
    pub engine: String,
    pub loaded: bool,
    pub model_id: Option<String>,
    pub device: Option<String>,
    pub management: bool,
}

fn default_status(url: String) -> WorkerStatus {
    WorkerStatus {
        running: false,
        healthy: false,
        url,
        engine: "whisper".to_string(),
        loaded: false,
        model_id: None,
        device: None,
        management: false,
    }
}

fn unhealthy_status(url: String) -> WorkerStatus {
    WorkerStatus {
        running: true,
        healthy: false,
        url,
        engine: "whisper".to_string(),
        loaded: false,
        model_id: None,
        device: None,
        management: false,
    }
}

async fn remove_child(engine_id: &str) {
    let child = {
        let mut map = CHILD.lock().unwrap();
        map.remove(engine_id)
    };

    if let Some(mut child) = child {
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
}

fn take_exited_child(engine_id: &str) -> Result<Option<(Child, ExitStatus)>, String> {
    let mut map = CHILD.lock().unwrap();
    let Some(mut child) = map.remove(engine_id) else {
        return Err("Worker process disappeared before health check".to_string());
    };

    match child.try_wait() {
        Ok(Some(status)) => Ok(Some((child, status))),
        Ok(None) => {
            map.insert(engine_id.to_string(), child);
            Ok(None)
        }
        Err(err) => Err(format!("Failed to inspect worker process: {err}")),
    }
}

async fn read_child_stderr(child: &mut Child) -> String {
    if let Some(mut pipe) = child.stderr.take() {
        use tokio::io::AsyncReadExt;
        let mut buf = Vec::new();
        if pipe.read_to_end(&mut buf).await.is_ok() {
            return String::from_utf8_lossy(&buf).trim().to_string();
        }
    }

    String::new()
}

pub async fn start_worker(app: &AppHandle, engine_id: &str) -> Result<(), String> {
    let state = manager_state::load_state(app).await?;
    let engine = state
        .engines
        .get(engine_id)
        .ok_or_else(|| format!("Engine {engine_id} not installed"))?;

    remove_child(engine_id).await;

    let venv_dir = paths::engine_venv_dir(app, engine_id);
    let python = constants::venv_python(&venv_dir);
    let worker_dir = paths::engine_worker_src_dir(app, engine_id);
    let main_py = worker_dir.join("main.py");

    if !main_py.exists() {
        return Err(format!("worker main.py not found: {}", main_py.to_string_lossy()));
    }

    let mut cmd = Command::new(&python);
    cmd.arg(&main_py);
    cmd.current_dir(&worker_dir);
    cmd.env("PORT", engine.port.to_string());
    cmd.env("ASR_ENGINE", "whisper");
    cmd.env("ASR_DEVICE", "cpu");
    cmd.env(
        "MODEL_BASE_PATH",
        paths::engine_models_dir(app, engine_id)
            .to_string_lossy()
            .to_string(),
    );
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let child = cmd.spawn().map_err(|e| e.to_string())?;

    {
        let mut map = CHILD.lock().unwrap();
        map.insert(engine_id.to_string(), child);
    }

    let url = format!("http://127.0.0.1:{}", engine.port);
    let deadline = tokio::time::Instant::now()
        + tokio::time::Duration::from_secs(constants::WORKER_HEALTH_TIMEOUT_SECS);
    let mut last_error: Option<String> = None;

    while tokio::time::Instant::now() < deadline {
        match take_exited_child(engine_id)? {
            Some((mut child, status)) => {
                let stderr = read_child_stderr(&mut child).await;
                let _ = child.wait().await;
                if stderr.is_empty() {
                    return Err(format!("Worker exited early: {status}"));
                }
                return Err(format!("Worker exited early: {status}\n{stderr}"));
            }
            None => {}
        }

        match check_health(engine.port).await {
            Ok(status) if status.healthy => {
                let _ = app.emit("worker-log", format!("Worker healthy at {}", url));
                return Ok(());
            }
            Ok(status) => {
                last_error = Some(format!(
                    "Health endpoint not ready yet (loaded={}, management={})",
                    status.loaded, status.management
                ));
            }
            Err(err) => {
                last_error = Some(err);
            }
        }

        tokio::time::sleep(tokio::time::Duration::from_secs(
            constants::WORKER_HEALTH_INTERVAL_SECS,
        ))
        .await;
    }

    Err(format!(
        "Worker failed to become healthy within timeout. Last error: {}",
        last_error.unwrap_or_else(|| "unknown".to_string())
    ))
}

pub async fn stop_worker(_app: &AppHandle, engine_id: &str) -> Result<(), String> {
    remove_child(engine_id).await;
    Ok(())
}

pub async fn get_worker_status(app: &AppHandle, engine_id: &str) -> Result<WorkerStatus, String> {
    let state = manager_state::load_state(app).await?;
    let engine = state
        .engines
        .get(engine_id)
        .ok_or_else(|| format!("Engine {engine_id} not installed"))?;

    let url = format!("http://127.0.0.1:{}", engine.port);
    let running = {
        let map = CHILD.lock().unwrap();
        map.contains_key(engine_id)
    };

    if !running {
        return Ok(default_status(url));
    }

    check_health(engine.port)
        .await
        .or_else(|_| Ok(unhealthy_status(url)))
}

pub async fn check_health(port: u16) -> Result<WorkerStatus, String> {
    let url = format!("http://127.0.0.1:{}", port);
    let resp = reqwest::get(format!("{}/health", url))
        .await
        .map_err(|e| e.to_string())?;
    let healthy = resp.status().is_success();
    let payload = resp.json::<HealthPayload>().await.unwrap_or_default();

    Ok(WorkerStatus {
        running: true,
        healthy,
        url,
        engine: payload.engine.unwrap_or_else(|| "whisper".to_string()),
        loaded: payload.loaded.unwrap_or(false),
        model_id: payload.model_id,
        device: payload.device,
        management: payload.management.unwrap_or(false),
    })
}
