use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;
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
    #[serde(default)]
    pub runtime_root: String,
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
    pub advertise_url: Option<String>,
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

    pub fn resolved_runtime_root(&self, app: &AppHandle) -> PathBuf {
        let trimmed = self.runtime_root.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed);
        }

        paths::infer_runtime_root_from_install_dir(app, &self.engine_id, PathBuf::from(&self.install_dir).as_path())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ManagerState {
    #[serde(default)]
    pub selected_engine_id: Option<String>,
    pub engines: HashMap<String, EngineInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct AppManagerStateIndex {
    #[serde(default)]
    selected_runtime_root: Option<String>,
    #[serde(default)]
    runtime_roots: Vec<String>,
}

impl AppManagerStateIndex {
    fn normalize(&mut self) {
        let mut unique = BTreeMap::new();
        for runtime_root in self.runtime_roots.drain(..) {
            let trimmed = runtime_root.trim();
            if !trimmed.is_empty() {
                unique.insert(trimmed.to_string(), ());
            }
        }
        self.runtime_roots = unique.into_keys().collect();

        self.selected_runtime_root = self
            .selected_runtime_root
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty() && self.runtime_roots.iter().any(|root| root == value));

        if self.selected_runtime_root.is_none() {
            self.selected_runtime_root = self.runtime_roots.last().cloned();
        }
    }

    fn remove_runtime_root(&mut self, runtime_root: &std::path::Path) {
        let target = paths::display_path(runtime_root);
        self.runtime_roots.retain(|root| root != &target);
        if self.selected_runtime_root.as_deref() == Some(target.as_str()) {
            self.selected_runtime_root = None;
        }
        self.normalize();
    }

    fn upsert_runtime_root(&mut self, runtime_root: &std::path::Path) {
        let runtime_root = paths::display_path(runtime_root);
        if !self.runtime_roots.iter().any(|root| root == &runtime_root) {
            self.runtime_roots.push(runtime_root.clone());
        }
        self.selected_runtime_root = Some(runtime_root);
        self.normalize();
    }
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

fn normalize_state(app: &AppHandle, state: &mut ManagerState) {
    for engine in state.engines.values_mut() {
        if engine.runtime_root.trim().is_empty() {
            engine.runtime_root = engine
                .resolved_runtime_root(app)
                .to_string_lossy()
                .to_string();
        }
    }

    state.sync_selected_engine();
}

async fn load_app_state_index(app: &AppHandle) -> Result<AppManagerStateIndex, String> {
    let path = paths::app_manager_state_path(app)?;
    let mut index = match tokio::fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).map_err(|e| e.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => AppManagerStateIndex::default(),
        Err(error) => return Err(error.to_string()),
    };
    index.normalize();
    Ok(index)
}

async fn save_app_state_index(app: &AppHandle, index: &AppManagerStateIndex) -> Result<(), String> {
    let path = paths::app_manager_state_path(app)?;
    let mut normalized_index = index.clone();
    normalized_index.normalize();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(&normalized_index).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn load_state_for_runtime_root(
    app: &AppHandle,
    runtime_root: &std::path::Path,
) -> Result<ManagerState, String> {
    let path = paths::manager_state_path_for_runtime_root(runtime_root);
    let mut state = match tokio::fs::read_to_string(&path).await {
        Ok(content) => serde_json::from_str(&content).map_err(|e| e.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => ManagerState::default(),
        Err(error) => return Err(error.to_string()),
    };
    normalize_state(app, &mut state);
    Ok(state)
}

pub async fn load_state(app: &AppHandle) -> Result<ManagerState, String> {
    let index = load_app_state_index(app).await?;
    let Some(runtime_root) = index.selected_runtime_root else {
        return Ok(ManagerState::default());
    };
    load_state_for_runtime_root(app, PathBuf::from(runtime_root).as_path()).await
}

pub async fn load_state_for_engine(
    app: &AppHandle,
    engine_id: &str,
) -> Result<(PathBuf, ManagerState), String> {
    let current_state = load_state(app).await?;
    if let Some(engine) = current_state.engines.get(engine_id) {
        return Ok((engine.resolved_runtime_root(app), current_state));
    }

    let index = load_app_state_index(app).await?;
    for runtime_root in index.runtime_roots {
        let runtime_root_path = PathBuf::from(&runtime_root);
        let state = load_state_for_runtime_root(app, &runtime_root_path).await?;
        if state.engines.contains_key(engine_id) {
            return Ok((runtime_root_path, state));
        }
    }

    Err(format!("Engine {engine_id} not installed"))
}

async fn save_state_to_path(app: &AppHandle, path: PathBuf, state: &ManagerState) -> Result<(), String> {
    let mut normalized_state = state.clone();
    normalize_state(app, &mut normalized_state);
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(&normalized_state).map_err(|e| e.to_string())?;
    tokio::fs::write(&path, data)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn save_state_for_runtime_root(
    app: &AppHandle,
    runtime_root: &std::path::Path,
    state: &ManagerState,
) -> Result<(), String> {
    save_state_to_path(
        app,
        paths::manager_state_path_for_runtime_root(runtime_root),
        state,
    )
    .await?;

    let mut index = load_app_state_index(app).await?;
    if state.engines.is_empty() {
        index.remove_runtime_root(runtime_root);
    } else {
        index.upsert_runtime_root(runtime_root);
    }
    save_app_state_index(app, &index).await
}

pub async fn set_selected_engine(
    app: &AppHandle,
    engine_id: Option<&str>,
) -> Result<ManagerState, String> {
    let (runtime_root, mut state) = match engine_id {
        Some(engine_id) => load_state_for_engine(app, engine_id).await?,
        None => {
            let index = load_app_state_index(app).await?;
            let runtime_root = index
                .selected_runtime_root
                .map(PathBuf::from)
                .ok_or_else(|| "No runtime root selected".to_string())?;
            let state = load_state_for_runtime_root(app, &runtime_root).await?;
            (runtime_root, state)
        }
    };

    if let Some(engine_id) = engine_id {
        if !state.engines.contains_key(engine_id) {
            return Err(format!("Engine {engine_id} not installed"));
        }
        state.selected_engine_id = Some(engine_id.to_string());
    } else {
        state.selected_engine_id = None;
    }

    normalize_state(app, &mut state);
    save_state_for_runtime_root(app, &runtime_root, &state).await?;
    Ok(state)
}

pub fn now_iso() -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    format!("{}", ts)
}
