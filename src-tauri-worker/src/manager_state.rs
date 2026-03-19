use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::AppHandle;

use crate::{constants, paths};

fn default_device() -> String {
    "cpu".to_string()
}

fn parse_timestamp(value: Option<&str>) -> u64 {
    value.and_then(|ts| ts.parse::<u64>().ok()).unwrap_or(0)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineInfo {
    pub engine_id: String,
    pub display_name: String,
    pub install_dir: String,
    pub port: u16,
    pub installed_at: String,
    pub last_started: Option<String>,
    #[serde(default)]
    pub engine_name: String,
    #[serde(default = "default_device")]
    pub device: String,
    #[serde(default)]
    pub server_url: Option<String>,
    #[serde(default)]
    pub initial_model_id: Option<String>,
}

impl EngineInfo {
    pub fn resolved_engine_name(&self) -> String {
        if self.engine_name.trim().is_empty() {
            constants::engine_name_for_id(&self.engine_id)
                .unwrap_or(&self.engine_id)
                .to_string()
        } else {
            self.engine_name.clone()
        }
    }

    pub fn resolved_device(&self) -> String {
        let device = self.device.trim();
        if device.is_empty() {
            "cpu".to_string()
        } else {
            device.to_string()
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManagerState {
    #[serde(default)]
    pub selected_engine_id: Option<String>,
    pub engines: HashMap<String, EngineInfo>,
}

impl ManagerState {
    pub fn preferred_engine_id(&self) -> Option<String> {
        if let Some(engine_id) = self
            .selected_engine_id
            .as_ref()
            .filter(|engine_id| self.engines.contains_key(engine_id.as_str()))
        {
            return Some(engine_id.clone());
        }

        self.engines
            .values()
            .max_by(|left, right| {
                let left_rank = (
                    parse_timestamp(left.last_started.as_deref()),
                    parse_timestamp(Some(left.installed_at.as_str())),
                    left.engine_id.as_str(),
                );
                let right_rank = (
                    parse_timestamp(right.last_started.as_deref()),
                    parse_timestamp(Some(right.installed_at.as_str())),
                    right.engine_id.as_str(),
                );
                left_rank.cmp(&right_rank)
            })
            .map(|engine| engine.engine_id.clone())
    }

    pub fn sync_selected_engine(&mut self) {
        self.selected_engine_id = self.preferred_engine_id();
    }
}

impl Default for ManagerState {
    fn default() -> Self {
        Self {
            selected_engine_id: None,
            engines: HashMap::new(),
        }
    }
}

pub async fn load_state(app: &AppHandle) -> Result<ManagerState, String> {
    let path = paths::manager_state_path(app);
    let mut state = match tokio::fs::read_to_string(&path).await {
        Ok(s) => serde_json::from_str(&s).map_err(|e| e.to_string())?,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => ManagerState::default(),
        Err(e) => return Err(e.to_string()),
    };
    state.sync_selected_engine();
    Ok(state)
}

pub async fn save_state(app: &AppHandle, state: &ManagerState) -> Result<(), String> {
    let path = paths::manager_state_path(app);
    let mut normalized_state = state.clone();
    normalized_state.sync_selected_engine();
    let data = serde_json::to_string_pretty(&normalized_state).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn set_selected_engine(
    app: &AppHandle,
    engine_id: Option<&str>,
) -> Result<ManagerState, String> {
    let mut state = load_state(app).await?;

    if let Some(engine_id) = engine_id {
        if !state.engines.contains_key(engine_id) {
            return Err(format!("Engine {engine_id} not installed"));
        }
        state.selected_engine_id = Some(engine_id.to_string());
    } else {
        state.selected_engine_id = None;
    }

    state.sync_selected_engine();
    save_state(app, &state).await?;
    Ok(state)
}

pub fn now_iso() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", ts)
}
