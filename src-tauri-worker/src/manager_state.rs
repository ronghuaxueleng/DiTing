use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;

use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub engine_id: String,
    pub display_name: String,
    pub install_dir: String,
    pub port: u16,
    pub installed_at: String,
    pub last_started: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerState {
    pub engines: HashMap<String, EngineInfo>,
}

impl Default for ManagerState {
    fn default() -> Self {
        Self {
            engines: HashMap::new(),
        }
    }
}

pub async fn load_state(app: &AppHandle) -> Result<ManagerState, String> {
    let path = paths::manager_state_path(app);
    match tokio::fs::read_to_string(&path).await {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(ManagerState::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub async fn save_state(app: &AppHandle, state: &ManagerState) -> Result<(), String> {
    let path = paths::manager_state_path(app);
    let data = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data).await.map_err(|e| e.to_string())?;
    Ok(())
}

pub fn now_iso() -> String {
    // Avoid chrono dependency; crude ISO-ish timestamp.
    // This is sufficient for UI display / debug.
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", ts)
}
