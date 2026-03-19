use tauri::AppHandle;

mod constants;
mod hardware;
mod installer;
mod manager_state;
mod paths;
mod worker;

#[tauri::command]
async fn detect_hardware() -> Result<hardware::HardwareInfo, String> {
    hardware::detect().await
}

#[tauri::command]
async fn get_manager_state(app: AppHandle) -> Result<manager_state::ManagerState, String> {
    manager_state::load_state(&app).await
}

#[tauri::command]
async fn install_whisper_engine(
    app: AppHandle,
    port: u16,
    model_id: String,
    use_mirror: bool,
    proxy: String,
) -> Result<(), String> {
    installer::install_whisper_engine(&app, port, &model_id, use_mirror, proxy.as_str()).await
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            get_manager_state,
            install_whisper_engine,
            uninstall_engine,
            start_worker,
            stop_worker,
            get_worker_status,
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
