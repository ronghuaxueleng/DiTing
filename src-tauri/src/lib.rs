use std::path::PathBuf;
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use tauri::{
    AppHandle, Manager, RunEvent, State, WindowEvent,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};

const SERVER_URL: &str = "http://127.0.0.1:5023/app/";
const WIZARD_URL: &str = "http://127.0.0.1:5023/app/wizard.html";
const HEALTH_URL: &str = "http://127.0.0.1:5023/api/system/version";

struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    child_pid: Mutex<Option<u32>>,
    server_ready: AtomicBool,
    exiting: AtomicBool,
}

/// Check if this is the first run (no DB and no setup marker).
fn is_first_run(data_dir: &PathBuf) -> bool {
    let setup_marker = data_dir.join(".setup_done");
    let db_file = data_dir.join("db").join("diting_prod.db");
    let result = !setup_marker.exists() && !db_file.exists();
    println!("[tauri] is_first_run={result}, data_dir={}", data_dir.display());
    result
}

/// Resolve the `data/` directory.
fn get_data_dir(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .resource_dir()
        .unwrap_or_else(|_| std::env::current_dir().unwrap());
    base.join("data")
}

/// Navigate the main window to the sidecar server URL.
fn navigate_to_server(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.navigate(SERVER_URL.parse().unwrap());
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Kill the sidecar process tree.
fn kill_sidecar(app: &AppHandle) {
    let state: State<SidecarState> = app.state();
    // First: kill the entire process tree via taskkill while parent-child relationship is intact
    // Must run BEFORE child.kill() — otherwise the wrapper dies and orphans the Python process
    #[cfg(windows)]
    if let Ok(guard) = state.child_pid.lock() {
        if let Some(pid) = *guard {
            let _ = std::process::Command::new("taskkill")
                .args(["/F", "/T", "/PID", &pid.to_string()])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .status(); // blocks until taskkill finishes
        }
    };
    // Fallback: also kill via Tauri handle in case taskkill missed it
    if let Ok(mut guard) = state.child.lock() {
        if let Some(child) = guard.take() {
            let _ = child.kill();
        }
    };
}
/// Start the Python sidecar server.
fn spawn_sidecar(app: &AppHandle) -> Result<(CommandChild, u32), String> {
    let shell = app.shell();
    let cmd = shell
        .sidecar("diting-server")
        .map_err(|e| format!("Failed to create sidecar command: {e}"))?
        .args(["--host", "127.0.0.1", "--port", "5023"]);

    let (mut rx, child) = cmd.spawn().map_err(|e| format!("Failed to spawn sidecar: {e}"))?;
    let pid = child.pid();

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
                    break;
                }
                _ => {}
            }
        }
    });

    Ok((child, pid))
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
    let data_dir = get_data_dir(&app);
    is_first_run(&data_dir)
}

#[tauri::command]
fn mark_setup_done(app: AppHandle) -> Result<(), String> {
    let data_dir = get_data_dir(&app);
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    let marker = data_dir.join(".setup_done");
    std::fs::write(marker, "1").map_err(|e| e.to_string())?;
    navigate_to_server(&app);
    if let Some(w) = app.get_webview_window("wizard") {
        let _ = w.hide();
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
    let mut guard = state.child.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
    let (new_child, new_pid) = spawn_sidecar(&app)?;
    *guard = Some(new_child);
    if let Ok(mut pid_guard) = state.child_pid.lock() {
        *pid_guard = Some(new_pid);
    }
    Ok(())
}
// ─── App Entry ───

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
            child_pid: Mutex::new(None),
            server_ready: AtomicBool::new(false),
            exiting: AtomicBool::new(false),
        })
        .invoke_handler(tauri::generate_handler![
            check_first_run,
            mark_setup_done,
            get_server_status,
            restart_server,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Check first run BEFORE sidecar starts (sidecar creates the DB) ──
            let data_dir = get_data_dir(&handle);
            let first_run = is_first_run(&data_dir);

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
                            navigate_to_server(app_handle);
                        }
                        "restart" => {
                            let state: State<SidecarState> = app_handle.state();
                            let _ = restart_server(app_handle.clone(), state);
                        }
                        "quit" => {
                            let state: State<SidecarState> = app_handle.state();
                            state.exiting.store(true, Ordering::Relaxed);
                            kill_sidecar(app_handle);
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
                        navigate_to_server(app);
                    }
                })
                .build(app)?;

            // ── Spawn Sidecar ──
            match spawn_sidecar(&handle) {
                Ok((sidecar_child, pid)) => {
                    let state: State<SidecarState> = handle.state();
                    *state.child.lock().unwrap() = Some(sidecar_child);
                    *state.child_pid.lock().unwrap() = Some(pid);
                    println!("[tauri] Sidecar started (pid={pid})");
                }
                Err(e) => {
                    eprintln!("[tauri] Sidecar not available: {e}");
                    eprintln!("[tauri] Running in dev mode");
                }
            }

            // ── Wait for server, then show appropriate window ──
            let setup_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let ready = wait_for_server_ready(30).await;
                if ready {
                    println!("[tauri] Server is ready");
                    let state: State<SidecarState> = setup_handle.state();
                    state.server_ready.store(true, Ordering::Relaxed);
                } else {
                    eprintln!("[tauri] Server did not become ready in 30s");
                }

                if first_run && ready {
                    // Navigate wizard to sidecar URL (assets need /app/ prefix from FastAPI)
                    if let Some(w) = setup_handle.get_webview_window("wizard") {
                        let _ = w.navigate(WIZARD_URL.parse().unwrap());
                        let _ = w.show();
                        let _ = w.set_focus();
                    }
                } else {
                    // Navigate main window to sidecar
                    navigate_to_server(&setup_handle);
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
                        api.prevent_close();
                        if let Some(w) = app_handle.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                }
                RunEvent::ExitRequested { api, .. } => {
                    let state: State<SidecarState> = app_handle.state();
                    if !state.exiting.load(Ordering::Relaxed) {
                        api.prevent_exit();
                    }
                }
                _ => {}
            }
        });
}
