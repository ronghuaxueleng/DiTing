use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, RunEvent, State, WindowEvent,
};

mod constants;
mod hardware;
mod installer;
mod manager_state;
mod paths;
mod worker;

const TRAY_ID: &str = "worker-manager-tray";
const TRAY_SHOW_ID: &str = "show";
const TRAY_START_ID: &str = "start";
const TRAY_STOP_ID: &str = "stop";
const TRAY_QUIT_ID: &str = "quit";
const TRAY_TOOLTIP_PREFIX: &str = "DiTing Worker Manager";

#[derive(Debug, Clone, Serialize)]
struct InstallPathInfo {
    default_runtime_root: String,
    default_engine_install_dir: String,
    default_uv_path: String,
    default_manager_state_path: String,
    app_install_dir: String,
}

#[derive(Debug, Clone, Serialize)]
struct InstallPathPreview {
    runtime_root: String,
    engine_install_dir: String,
    uv_path: String,
    manager_state_path: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallEngineRequest {
    engine_id: String,
    port: u16,
    model_id: String,
    device: String,
    compute_key: Option<String>,
    use_mirror: bool,
    proxy: String,
    server_url: Option<String>,
    advertise_url: Option<String>,
    install_dir: String,
}

fn resolve_app_install_dir(app: &AppHandle) -> String {
    let path = paths::default_runtime_root_for_app(app);

    paths::display_path(&path)
}

fn build_install_path_preview(app: &AppHandle, engine_id: &str, install_dir: &str) -> InstallPathPreview {
    let runtime_root = paths::resolve_runtime_root(app, install_dir);
    let engine_install_dir = paths::runtime_engine_dir(&runtime_root, engine_id);
    let uv_path = paths::runtime_uv_dir(&runtime_root).join(constants::uv_binary_name());
    let manager_state_path = paths::manager_state_path_for_runtime_root(&runtime_root);

    InstallPathPreview {
        runtime_root: paths::display_path(&runtime_root),
        engine_install_dir: paths::display_path(&engine_install_dir),
        uv_path: paths::display_path(&uv_path),
        manager_state_path: paths::display_path(&manager_state_path),
    }
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
async fn set_selected_engine(
    app: AppHandle,
    engine_id: Option<String>,
) -> Result<manager_state::ManagerState, String> {
    let state = manager_state::set_selected_engine(&app, engine_id.as_deref()).await?;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    Ok(state)
}

#[tauri::command]
async fn get_install_path_info(
    app: AppHandle,
    engine_id: Option<String>,
) -> Result<InstallPathInfo, String> {
    let requested_engine_id = engine_id.unwrap_or_else(|| "whisper-openai".to_string());
    let default_preview = build_install_path_preview(&app, &requested_engine_id, "");
    Ok(InstallPathInfo {
        default_runtime_root: default_preview.runtime_root,
        default_engine_install_dir: default_preview.engine_install_dir,
        default_uv_path: default_preview.uv_path,
        default_manager_state_path: default_preview.manager_state_path,
        app_install_dir: resolve_app_install_dir(&app),
    })
}

#[tauri::command]
async fn preview_install_paths(
    app: AppHandle,
    request: InstallPathPreviewRequest,
) -> Result<InstallPathPreview, String> {
    Ok(build_install_path_preview(
        &app,
        &request.engine_id,
        &request.install_dir,
    ))
}

#[tauri::command]
async fn install_engine(app: AppHandle, request: InstallEngineRequest) -> Result<(), String> {
    let result = installer::install_engine(
        &app,
        &request.engine_id,
        request.port,
        &request.model_id,
        &request.device,
        request.compute_key.as_deref().unwrap_or(""),
        request.use_mirror,
        &request.proxy,
        request.server_url.as_deref().unwrap_or(""),
        request.advertise_url.as_deref().unwrap_or(""),
        &request.install_dir,
    )
    .await;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    result
}

#[tauri::command]
async fn update_engine_network_settings(
    app: AppHandle,
    engine_id: String,
    port: u16,
    server_url: Option<String>,
    advertise_url: Option<String>,
) -> Result<manager_state::ManagerState, String> {
    let state = installer::update_engine_network_settings(
        &app,
        &engine_id,
        port,
        server_url.as_deref().unwrap_or(""),
        advertise_url.as_deref().unwrap_or(""),
    )
    .await?;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    Ok(state)
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
    let result = installer::install_whisper_engine(
        &app,
        port,
        &model_id,
        use_mirror,
        proxy.as_str(),
        install_dir.as_str(),
    )
    .await;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    result
}

#[tauri::command]
async fn uninstall_engine(app: AppHandle, engine_id: String) -> Result<(), String> {
    let result = installer::uninstall_engine(&app, &engine_id).await;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    result
}

#[tauri::command]
async fn start_worker(app: AppHandle, engine_id: String) -> Result<(), String> {
    let result = worker::start_worker(&app, &engine_id).await;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    result
}

#[tauri::command]
async fn stop_worker(app: AppHandle, engine_id: String) -> Result<(), String> {
    let result = worker::stop_worker(&app, &engine_id).await;
    tauri::async_runtime::spawn({
        let app = app.clone();
        async move {
            let _ = update_tray_state(&app).await;
        }
    });
    result
}

#[tauri::command]
async fn get_worker_status(
    app: AppHandle,
    engine_id: String,
) -> Result<worker::WorkerStatus, String> {
    worker::get_worker_status(&app, &engine_id).await
}

#[tauri::command]
async fn list_worker_models(
    app: AppHandle,
    engine_id: String,
) -> Result<worker::WorkerModelsResponse, String> {
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
async fn delete_worker_model(
    app: AppHandle,
    engine_id: String,
    model_id: String,
) -> Result<serde_json::Value, String> {
    worker::delete_model(&app, &engine_id, &model_id).await
}

#[tauri::command]
async fn unload_worker_model(
    app: AppHandle,
    engine_id: String,
) -> Result<serde_json::Value, String> {
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn selected_engine_label(state: &manager_state::ManagerState) -> String {
    state
        .preferred_engine_id()
        .as_ref()
        .and_then(|engine_id| state.engines.get(engine_id))
        .map(|engine| engine.display_name.clone())
        .unwrap_or_else(|| "No engine selected".to_string())
}

fn tray_tooltip(state: &manager_state::ManagerState, running: bool) -> String {
    let engine_label = selected_engine_label(state);
    let worker_state = if running { "running" } else { "stopped" };
    format!("{TRAY_TOOLTIP_PREFIX}\n{engine_label}\nWorker {worker_state}")
}

async fn update_tray_state(app: &AppHandle) -> Result<(), String> {
    let state = manager_state::load_state(app).await?;
    let selected_engine_id = state.preferred_engine_id();
    let selected_engine_running = if let Some(engine_id) = selected_engine_id.as_ref() {
        worker::get_worker_status(app, engine_id)
            .await
            .map(|status| status.running)
            .unwrap_or(false)
    } else {
        false
    };

    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let start_label = if let Some(engine_id) = selected_engine_id.as_ref() {
            let engine_label = state
                .engines
                .get(engine_id)
                .map(|engine| engine.display_name.as_str())
                .unwrap_or(engine_id.as_str());
            format!("Start {engine_label}")
        } else {
            "Start engine".to_string()
        };
        let stop_label = if let Some(engine_id) = selected_engine_id.as_ref() {
            let engine_label = state
                .engines
                .get(engine_id)
                .map(|engine| engine.display_name.as_str())
                .unwrap_or(engine_id.as_str());
            format!("Stop {engine_label}")
        } else {
            "Stop engine".to_string()
        };

        let show_item =
            MenuItem::with_id(app, TRAY_SHOW_ID, "Show Worker Manager", true, None::<&str>)
                .map_err(|e| e.to_string())?;
        let start_item = MenuItem::with_id(
            app,
            TRAY_START_ID,
            start_label,
            selected_engine_id.is_some() && !selected_engine_running,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        let stop_item = MenuItem::with_id(
            app,
            TRAY_STOP_ID,
            stop_label,
            selected_engine_id.is_some() && selected_engine_running,
            None::<&str>,
        )
        .map_err(|e| e.to_string())?;
        let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)
            .map_err(|e| e.to_string())?;
        let tray_menu = Menu::with_items(app, &[&show_item, &start_item, &stop_item, &quit_item])
            .map_err(|e| e.to_string())?;

        let _ = tray.set_menu(Some(tray_menu));
        let _ = tray.set_tooltip(Some(tray_tooltip(&state, selected_engine_running)));
    }

    Ok(())
}

fn handle_tray_action(app: &AppHandle, action_id: &str) {
    match action_id {
        TRAY_SHOW_ID => show_main_window(app),
        TRAY_START_ID => {
            if let Ok(state) = tauri::async_runtime::block_on(manager_state::load_state(app)) {
                if let Some(engine_id) = state.preferred_engine_id() {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = worker::start_worker(&app_handle, &engine_id).await;
                        let _ = update_tray_state(&app_handle).await;
                    });
                    show_main_window(app);
                }
            }
        }
        TRAY_STOP_ID => {
            if let Ok(state) = tauri::async_runtime::block_on(manager_state::load_state(app)) {
                if let Some(engine_id) = state.preferred_engine_id() {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = worker::stop_worker(&app_handle, &engine_id).await;
                        let _ = update_tray_state(&app_handle).await;
                    });
                }
            }
        }
        TRAY_QUIT_ID => {
            let lifecycle: State<'_, AppLifecycleState> = app.state();
            lifecycle
                .exiting
                .store(true, std::sync::atomic::Ordering::Relaxed);
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                worker::stop_all_workers().await;
                app_handle.exit(0);
            });
        }
        _ => {}
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallPathPreviewRequest {
    engine_id: String,
    install_dir: String,
}

#[derive(Default)]
struct AppLifecycleState {
    exiting: std::sync::atomic::AtomicBool,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppLifecycleState::default())
        .invoke_handler(tauri::generate_handler![
            detect_hardware,
            get_manager_state,
            set_selected_engine,
            get_install_path_info,
            preview_install_paths,
            install_engine,
            update_engine_network_settings,
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
            let show_item =
                MenuItem::with_id(app, TRAY_SHOW_ID, "Show Worker Manager", true, None::<&str>)?;
            let start_item =
                MenuItem::with_id(app, TRAY_START_ID, "Start engine", false, None::<&str>)?;
            let stop_item =
                MenuItem::with_id(app, TRAY_STOP_ID, "Stop engine", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, TRAY_QUIT_ID, "Quit", true, None::<&str>)?;
            let tray_menu =
                Menu::with_items(app, &[&show_item, &start_item, &stop_item, &quit_item])?;

            TrayIconBuilder::with_id(TRAY_ID)
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip(TRAY_TOOLTIP_PREFIX)
                .menu(&tray_menu)
                .on_menu_event(move |app_handle, event| {
                    handle_tray_action(app_handle, event.id().as_ref());
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            tauri::async_runtime::spawn({
                let app = app.handle().clone();
                async move {
                    let _ = update_tray_state(&app).await;
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::WindowEvent {
                label,
                event: WindowEvent::CloseRequested { api, .. },
                ..
            } => {
                if label == "main" {
                    let lifecycle: State<'_, AppLifecycleState> = app.state();
                    if !lifecycle.exiting.load(std::sync::atomic::Ordering::Relaxed) {
                        api.prevent_close();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
            }
            RunEvent::ExitRequested { api, .. } => {
                let lifecycle: State<'_, AppLifecycleState> = app.state();
                if !lifecycle.exiting.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
            _ => {}
        });
}
