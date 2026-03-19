use serde::Serialize;
use tauri::AppHandle;

mod constants;
mod hardware;
mod installer;
mod manager_state;
mod paths;
mod worker;

#[derive(Debug, Clone, Serialize)]
struct InstallPathInfo {
    default_base_install_dir: String,
    default_engine_install_dir: String,
}

#[tauri::command]
async fn detect_hardware() -> Result<hardware::HardwareInfo, String> {
    hardware::detect().await
}

#[tauri::command]
async fn get_manager_state(app: AppHandle) -> Result<manager_state::ManagerState, String> {
    manager_state::load_state(&app).await
}

#[tauri::command]
async fn get_install_path_info(app: AppHandle) -> Result<InstallPathInfo, String> {
    let base = paths::default_install_dir();
    let engine = paths::engine_dir(&app, "whisper-openai");
    Ok(InstallPathInfo {
        default_base_install_dir: base.to_string_lossy().to_string(),
        default_engine_install_dir: engine.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn install_whisper_engine(
    app: AppHandle,
    port: u16,
    model_id: String,
    use_mirror: bool,
    proxy: String,
    install_dir: String,
) -> Result<(), String> {
    installer::install_whisper_engine(&app, port, &model_id, use_mirror, proxy.as_str(), install_dir.as_str()).await
}

#[tauri::command]
async fn uninstall_engine(app: AppHandle, engine_id: String) -> Result<(), String> {
    installer::uninstall_engine(&app, &engine_id).await
}

#[tauri::command]
async fn start_worker(app: AppHandle, engine_id: String) -> Result<(), String> {
    worker::start_worker(&app, &engine_id).await
}

#[tauri::command]
async fn stop_worker(app: AppHandle, engine_id: String) -> Result<(), String> {
    worker::stop_worker(&app, &engine_id).await
}

#[tauri::command]
async fn get_worker_status(app: AppHandle, engine_id: String) -> Result<worker::WorkerStatus, String> {
    worker::get_worker_status(&app, &engine_id).await
}

#[tauri::command]
async fn list_worker_models(app: AppHandle, engine_id: String) -> Result<worker::WorkerModelsResponse, String> {
    worker::list_models(&app, &engine_id).await
}

#[tauri::command]
async fn download_worker_model(
    app: AppHandle,
    engine_id: String,
    model_id: String,
    use_mirror: bool,
    proxy: String,
) -> Result<worker::WorkerOperationResponse, String> {
    worker::download_model(&app, &engine_id, &model_id, use_mirror, &proxy).await
}

#[tauri::command]
async fn activate_worker_model(
    app: AppHandle,
    engine_id: String,
    model_id: String,
) -> Result<worker::WorkerOperationResponse, String> {
    worker::activate_model(&app, &engine_id, &model_id).await
}

#[tauri::command]
async fn delete_worker_model(app: AppHandle, engine_id: String, model_id: String) -> Result<serde_json::Value, String> {
    worker::delete_model(&app, &engine_id, &model_id).await
}

#[tauri::command]
async fn unload_worker_model(app: AppHandle, engine_id: String) -> Result<serde_json::Value, String> {
    worker::unload_model(&app, &engine_id).await
}

#[tauri::command]
async fn get_worker_operation_status(
    app: AppHandle,
    engine_id: String,
    operation_id: String,
) -> Result<worker::WorkerOperationStatus, String> {
    worker::get_operation_status(&app, &engine_id, &operation_id).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            get_manager_state,
            get_install_path_info,
            install_whisper_engine,
            uninstall_engine,
            start_worker,
            stop_worker,
            get_worker_status,
            list_worker_models,
            download_worker_model,
            activate_worker_model,
            delete_worker_model,
            unload_worker_model,
            get_worker_operation_status,
        ])
        .setup(|app| {
            let handle = app.handle();
            tauri::async_runtime::block_on(async move {
                let _ = paths::ensure_base_dirs(&handle).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
