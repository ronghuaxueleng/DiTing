use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager, RunEvent, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

const SERVER_PORT: u16 = 5023;
const HEALTH_URL: &str = "http://127.0.0.1:5023/api/system/version";

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
}

/// Check if this is the first run (no DB and no setup marker).
fn is_first_run(app: &AppHandle) -> bool {
    let data_dir = get_data_dir(app);
    let setup_marker = data_dir.join(".setup_done");
    let db_file = data_dir.join("db").join("diting_prod.db");
    !setup_marker.exists() && !db_file.exists()
}

/// Resolve the `data/` directory relative to the sidecar / project root.
fn get_data_dir(app: &AppHandle) -> PathBuf {
    // In dev, data/ is at project root. In production, next to the executable.
    let resource_dir = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());
    resource_dir.join("data")
}

/// Start the Python sidecar server.
fn spawn_sidecar(app: &AppHandle) -> Result<CommandChild, String> {
    let shell = app.shell();
    let cmd = shell
        .sidecar("binaries/diting-server")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(["--host", "127.0.0.1", "--port", &SERVER_PORT.to_string()]);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {e}"))?;

    // Log sidecar stdout/stderr in background
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    println!("[sidecar] {text}");
                }
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line);
                    eprintln!("[sidecar:err] {text}");
                }
                CommandEvent::Terminated(payload) => {
                    eprintln!("[sidecar] terminated: code={:?}", payload.code);
                    // TODO: auto-restart logic if needed
                    let _ = app_handle;
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(child)
}

/// Poll the sidecar health endpoint until it responds.
async fn wait_for_server_ready(timeout_secs: u64) -> bool {
    let client = reqwest::Client::new();
    let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_secs);

    while tokio::time::Instant::now() < deadline {
        if let Ok(resp) = client.get(HEALTH_URL).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
    }
    false
}

// ─── Tauri Commands ───

#[tauri::command]
fn check_first_run(app: AppHandle) -> bool {
    is_first_run(&app)
}

#[tauri::command]
fn mark_setup_done(app: AppHandle) -> Result<(), String> {
    let data_dir = get_data_dir(&app);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let marker = data_dir.join(".setup_done");
    std::fs::write(marker, "1").map_err(|e| e.to_string())?;

    // Show main window pointing to sidecar
    if let Some(w) = app.get_webview_window("main") {
        let url = format!("http://127.0.0.1:{SERVER_PORT}/app/");
        let _ = w.navigate(url.parse().unwrap());
        let _ = w.show();
        let _ = w.set_focus();
    }
    Ok(())
}

#[tauri::command]
async fn get_server_status() -> bool {
    let client = reqwest::Client::new();
    client
        .get(HEALTH_URL)
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

#[tauri::command]
fn restart_server(app: AppHandle, state: State<'_, SidecarState>) -> Result<(), String> {
    // Kill existing
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    // Spawn new
    let new_child = spawn_sidecar(&app)?;
    *guard = Some(new_child);
    Ok(())
}

// ─── App Entry ───

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_first_run,
            mark_setup_done,
            get_server_status,
            restart_server,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── System Tray ──
            let open_i = MenuItem::with_id(app, "open", "Open Dashboard", true, None::<&str>)?;
            let restart_i = MenuItem::with_id(app, "restart", "Restart Server", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_i, &restart_i, &quit_i])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("DiTing")
                .menu(&menu)
                .on_menu_event(move |app_handle, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(w) = app_handle.get_webview_window("main") {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                        "restart" => {
                            let state: State<SidecarState> = app_handle.state();
                            let _ = restart_server(app_handle.clone(), state);
                        }
                        "quit" => {
                            // Kill sidecar then exit
                            let state: State<SidecarState> = app_handle.state();
                            if let Ok(mut guard) = state.child.lock() {
                                if let Some(child) = guard.take() {
                                    let _ = child.kill();
                                }
                            }
                            app_handle.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            // ── Spawn Sidecar ──
            let sidecar_child = spawn_sidecar(&handle)
                .map_err(|e| Box::<dyn std::error::Error>::from(e))?;
            {
                let state: State<SidecarState> = handle.state();
                let mut guard = state.child.lock().unwrap();
                *guard = Some(sidecar_child);
            }

            // ── Wait for server, then show appropriate window ──
            let setup_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let ready = wait_for_server_ready(30).await;
                if !ready {
                    eprintln!("[tauri] Server did not become ready in 30s");
                }

                let first_run = is_first_run(&setup_handle);
                if first_run {
                    // Show wizard window
                    if let Some(w) = setup_handle.get_webview_window("wizard") {
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                } else {
                    // Navigate main window to sidecar URL and show
                    if let Some(w) = setup_handle.get_webview_window("main") {
                        if ready {
                            let url = format!("http://127.0.0.1:{SERVER_PORT}/app/");
                            let _ = w.navigate(url.parse().unwrap());
                        }
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } => {
                    if label == "main" {
                        // Minimize to tray instead of closing
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                }
                RunEvent::ExitRequested { api, .. } => {
                    // Prevent exit when all windows are hidden (tray keeps running)
                    api.prevent_exit();
                }
                _ => {}
            }
        });
}
