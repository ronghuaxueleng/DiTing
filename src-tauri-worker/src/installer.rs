use crate::{constants, hardware, manager_state, paths, worker};
use flate2::read::GzDecoder;
use reqwest::{Client, Proxy, Url};
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};
use tar::Archive;
use tokio::process::Command;
use zip::ZipArchive;

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

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(windows)]
fn hide_console_window(cmd: &mut Command) {
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console_window(_: &mut Command) {}

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
        install_dir: paths::display_path(install_dir),
        done,
        error,
    };
    let _ = app.emit("install-progress", payload);
}

fn emit_uv_status(app: &AppHandle, engine_id: &str, runtime_root: &Path, message: &str) {
    emit(
        app,
        engine_id,
        INSTALL_STEPS[0],
        0,
        0,
        message,
        runtime_root,
        false,
        None,
    );
}

fn uv_path(runtime_root: &Path) -> PathBuf {
    paths::runtime_uv_dir(runtime_root).join(constants::uv_binary_name())
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

fn resolve_existing_runtime_uv(runtime_root: &Path) -> Option<PathBuf> {
    let path = uv_path(runtime_root);
    path.is_file().then_some(path)
}

fn resolve_dev_uv_source(app: &AppHandle) -> Option<PathBuf> {
    candidate_uv_sources(app)
        .into_iter()
        .find(|candidate| candidate.is_file())
}

fn candidate_worker_sources(app: &AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = resource_dir(app) {
        candidates.push(resource_dir.join("asr_worker"));
        candidates.push(resource_dir.join("resources").join("asr_worker"));
        candidates.push(resource_dir.join("_up_").join("asr_worker"));
        if let Some(parent) = resource_dir.parent() {
            candidates.push(parent.join("_up_").join("asr_worker"));
        }
    }

    if let Ok(current_dir) = std::env::current_dir() {
        candidates.push(current_dir.join("asr_worker"));
        candidates.push(current_dir.join("_up_").join("asr_worker"));
        if let Some(parent) = current_dir.parent() {
            candidates.push(parent.join("asr_worker"));
            candidates.push(parent.join("_up_").join("asr_worker"));
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
            .map(|p| paths::display_path(p))
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

fn build_uv_download_urls(release: &constants::UvPlatformRelease, use_mirror: bool) -> Vec<String> {
    let mut urls = Vec::new();
    if use_mirror {
        urls.push(format!(
            "{}/{}/{}",
            constants::UV_RELEASE_MIRROR_PREFIX,
            constants::UV_VERSION,
            release.archive_name
        ));
    }
    urls.push(format!(
        "{}/{}/{}",
        constants::UV_RELEASE_BASE_URL,
        constants::UV_VERSION,
        release.archive_name
    ));
    urls
}

fn validate_uv_download_url(raw_url: &str) -> Result<Url, String> {
    let url = Url::parse(raw_url).map_err(|e| format!("Invalid uv download URL {raw_url}: {e}"))?;
    if url.scheme() != "https" {
        return Err(format!("uv download URL must use HTTPS: {raw_url}"));
    }
    match url.host_str() {
        Some("github.com") | Some("ghp.ci") => Ok(url),
        other => Err(format!(
            "uv download URL host is not allowed: {}",
            other.unwrap_or("<missing>")
        )),
    }
}

fn build_http_client(proxy: &str) -> Result<Client, String> {
    let mut builder = Client::builder();
    let trimmed_proxy = proxy.trim();
    if !trimmed_proxy.is_empty() {
        let reqwest_proxy = Proxy::all(trimmed_proxy)
            .map_err(|e| format!("Invalid proxy for uv download: {e}"))?;
        builder = builder.proxy(reqwest_proxy);
    }
    builder
        .build()
        .map_err(|e| format!("Failed to build HTTP client for uv download: {e}"))
}

async fn download_uv_archive(
    client: &Client,
    url: &Url,
    archive_path: &Path,
) -> Result<(), String> {
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|e| format!("Failed to download uv from {}: {e}", url))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download uv from {}: HTTP {}",
            url,
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read uv download from {}: {e}", url))?;
    tokio::fs::write(archive_path, &bytes)
        .await
        .map_err(|e| format!("Failed to save uv archive to {}: {e}", paths::display_path(archive_path)))
}

fn is_safe_archive_path(path: &Path) -> bool {
    if path.is_absolute() || has_windows_drive_prefix(path) {
        return false;
    }
    path.components().all(|component| match component {
        Component::Normal(_) => true,
        Component::CurDir => true,
        _ => false,
    })
}

fn has_windows_drive_prefix(path: &Path) -> bool {
    let raw = path.to_string_lossy();
    raw.len() >= 2
        && raw.as_bytes()[1] == b':'
        && raw.as_bytes()[0].is_ascii_alphabetic()
}

fn extract_uv_binary(
    archive_path: &Path,
    archive_kind: constants::UvArchiveKind,
    temp_binary_path: &Path,
) -> Result<(), String> {
    let expected_name = constants::uv_binary_name();
    match archive_kind {
        constants::UvArchiveKind::Zip => {
            let file = File::open(archive_path).map_err(|e| e.to_string())?;
            let mut archive = ZipArchive::new(file)
                .map_err(|e| format!("Failed to open uv zip archive: {e}"))?;
            for index in 0..archive.len() {
                let mut entry = archive
                    .by_index(index)
                    .map_err(|e| format!("Failed to read uv zip entry: {e}"))?;
                let entry_path = Path::new(entry.name());
                if !is_safe_archive_path(entry_path) {
                    continue;
                }
                if entry_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    == Some(expected_name)
                {
                    let mut output = File::create(temp_binary_path)
                        .map_err(|e| format!("Failed to create temporary uv binary: {e}"))?;
                    std::io::copy(&mut entry, &mut output)
                        .map_err(|e| format!("Failed to extract uv binary: {e}"))?;
                    output.flush().map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
        constants::UvArchiveKind::TarGz => {
            let file = File::open(archive_path).map_err(|e| e.to_string())?;
            let decoder = GzDecoder::new(file);
            let mut archive = Archive::new(decoder);
            let entries = archive
                .entries()
                .map_err(|e| format!("Failed to read uv tar.gz archive: {e}"))?;
            for entry in entries {
                let mut entry = entry.map_err(|e| format!("Failed to read uv tar.gz entry: {e}"))?;
                let entry_path = entry
                    .path()
                    .map_err(|e| format!("Failed to inspect uv tar.gz entry path: {e}"))?;
                if !is_safe_archive_path(&entry_path) {
                    continue;
                }
                if entry_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    == Some(expected_name)
                {
                    let mut output = File::create(temp_binary_path)
                        .map_err(|e| format!("Failed to create temporary uv binary: {e}"))?;
                    std::io::copy(&mut entry, &mut output)
                        .map_err(|e| format!("Failed to extract uv binary: {e}"))?;
                    output.flush().map_err(|e| e.to_string())?;
                    return Ok(());
                }
            }
        }
    }

    Err(format!(
        "uv archive did not contain {}",
        constants::uv_binary_name()
    ))
}

fn verify_archive_checksum(
    archive_path: &Path,
    expected_sha256: Option<&str>,
) -> Result<(), String> {
    let Some(expected_sha256) = expected_sha256 else {
        return Ok(());
    };

    let mut file = File::open(archive_path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 8192];
    loop {
        let read = file.read(&mut buf).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buf[..read]);
    }
    let actual = format!("{:x}", hasher.finalize());
    if actual != expected_sha256.to_ascii_lowercase() {
        return Err(format!(
            "uv archive checksum mismatch: expected {}, got {}",
            expected_sha256, actual
        ));
    }
    Ok(())
}

async fn install_uv_atomically(temp_binary_path: &Path, final_uv_path: &Path) -> Result<(), String> {
    let final_dir = final_uv_path
        .parent()
        .ok_or_else(|| "Invalid uv install path".to_string())?;
    tokio::fs::create_dir_all(final_dir)
        .await
        .map_err(|e| format!("Failed to create uv directory {}: {e}", paths::display_path(final_dir)))?;

    let staging_path = final_uv_path.with_extension("tmp");
    if staging_path.exists() {
        let _ = tokio::fs::remove_file(&staging_path).await;
    }

    tokio::fs::copy(temp_binary_path, &staging_path)
        .await
        .map_err(|e| format!("Failed to stage uv binary: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = tokio::fs::metadata(&staging_path)
            .await
            .map_err(|e| e.to_string())?
            .permissions();
        perms.set_mode(0o755);
        tokio::fs::set_permissions(&staging_path, perms)
            .await
            .map_err(|e| e.to_string())?;
    }

    tokio::fs::rename(&staging_path, final_uv_path)
        .await
        .map_err(|e| format!("Failed to install uv into {}: {e}", paths::display_path(final_uv_path)))
}

async fn verify_uv_binary(uv: &Path) -> Result<(), String> {
    let mut cmd = Command::new(uv);
    hide_console_window(&mut cmd);
    let output = cmd
        .arg("--version")
        .output()
        .await
        .map_err(|e| format!("Failed to execute uv --version: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "uv --version failed: {}\n{}\n{}",
            output.status,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let expected_prefix = format!("uv {}", constants::UV_VERSION);
    if stdout == expected_prefix
        || stdout.starts_with(&format!("{expected_prefix} "))
        || stdout.starts_with(&format!("{expected_prefix}("))
    {
        return Ok(());
    }

    Err(format!(
        "Unexpected uv --version output: expected prefix '{expected_prefix}', got '{stdout}'"
    ))
}

async fn ensure_uv_ready(
    app: &AppHandle,
    engine_id: &str,
    runtime_root: &Path,
    use_mirror: bool,
    proxy: &str,
) -> Result<(), String> {
    emit_uv_status(app, engine_id, runtime_root, "Checking existing uv...");
    if let Some(existing_uv) = resolve_existing_runtime_uv(runtime_root) {
        emit_uv_status(app, engine_id, runtime_root, "Validating existing uv binary...");
        verify_uv_binary(&existing_uv).await?;
        return Ok(());
    }

    paths::ensure_runtime_root_dirs(runtime_root).await?;
    let final_uv_path = uv_path(runtime_root);

    emit_uv_status(app, engine_id, runtime_root, "Trying local development uv...");
    if let Some(source_uv) = resolve_dev_uv_source(app) {
        let temp_binary_path = final_uv_path.with_extension("download");
        tokio::fs::copy(&source_uv, &temp_binary_path)
            .await
            .map_err(|e| format!("Failed to copy development uv from {}: {e}", paths::display_path(&source_uv)))?;
        install_uv_atomically(&temp_binary_path, &final_uv_path).await?;
        emit_uv_status(app, engine_id, runtime_root, "Validating uv binary...");
        verify_uv_binary(&final_uv_path).await?;
        return Ok(());
    }

    let release = constants::uv_release_for_current_platform().ok_or_else(|| {
        "Unsupported platform for uv bootstrap. Supported platforms: windows_x86_64, darwin_x86_64, darwin_aarch64, linux_x86_64".to_string()
    })?;
    let client = build_http_client(proxy)?;
    let download_urls = build_uv_download_urls(release, use_mirror);
    let temp_dir = std::env::temp_dir().join(format!(
        "diting-worker-uv-{}",
        std::process::id()
    ));
    tokio::fs::create_dir_all(&temp_dir)
        .await
        .map_err(|e| format!("Failed to create temporary uv download directory: {e}"))?;

    let archive_path = temp_dir.join(release.archive_name);
    let extracted_path = temp_dir.join(constants::uv_binary_name());
    let mut errors = Vec::new();

    for (index, raw_url) in download_urls.iter().enumerate() {
        let url = match validate_uv_download_url(raw_url) {
            Ok(url) => url,
            Err(error) => {
                errors.push(error);
                continue;
            }
        };

        let using_mirror = use_mirror && index == 0;
        emit_uv_status(
            app,
            engine_id,
            runtime_root,
            if using_mirror {
                "Downloading uv from mirror..."
            } else {
                "Downloading uv from official release..."
            },
        );

        let attempt = async {
            download_uv_archive(&client, &url, &archive_path).await?;
            emit_uv_status(app, engine_id, runtime_root, "Verifying download...");
            verify_archive_checksum(&archive_path, release.sha256)?;
            emit_uv_status(app, engine_id, runtime_root, "Extracting uv...");
            extract_uv_binary(&archive_path, release.archive_kind, &extracted_path)?;
            install_uv_atomically(&extracted_path, &final_uv_path).await?;
            emit_uv_status(app, engine_id, runtime_root, "Validating uv binary...");
            verify_uv_binary(&final_uv_path).await
        }
        .await;

        match attempt {
            Ok(()) => return Ok(()),
            Err(error) => errors.push(format!("{}: {}", url, error)),
        }
    }

    Err(format!(
        "Failed to obtain uv for platform {}. Checked local development paths and online downloads. Errors: {}",
        release.platform_key,
        errors.join(" | ")
    ))
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

async fn run_uv(
    runtime_root: &Path,
    args: &[String],
    envs: &[(String, String)],
) -> Result<(), String> {
    let uv = uv_path(runtime_root);
    if !uv.is_file() {
        return Err(format!("uv not found at {}", paths::display_path(&uv)));
    }

    let mut cmd = Command::new(uv);
    hide_console_window(&mut cmd);
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
    hide_console_window(&mut cmd);
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

fn resolve_model(engine_id: &str, model_id: &str) -> Result<Option<&'static constants::ModelDef>, String> {
    let trimmed_model_id = model_id.trim();
    if trimmed_model_id.is_empty() {
        return Ok(constants::default_model_for_engine(engine_id));
    }
    if trimmed_model_id == "__none__" {
        return Ok(None);
    }

    constants::find_model(engine_id, trimmed_model_id)
        .map(Some)
        .ok_or_else(|| format!("Unknown model {trimmed_model_id} for engine {engine_id}"))
}

async fn install_pytorch(
    runtime_root: &Path,
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

    run_uv(runtime_root, &args, envs).await
}

async fn install_engine_packages(
    runtime_root: &Path,
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

    run_uv(runtime_root, &args, envs).await
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
        "qwen3asr" => format!(
            "from huggingface_hub import snapshot_download\nsnapshot_download({:?}, cache_dir={:?})\nsnapshot_download('Qwen/Qwen3-ForcedAligner-0.6B', cache_dir={:?})",
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
        "qwen3asr" => json!({
            "qwen3asr": {
                "model_name": model.model_id,
                "aligner_name": "Qwen/Qwen3-ForcedAligner-0.6B",
                "use_aligner": true
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
    advertise_url: Option<&str>,
    model: Option<&constants::ModelDef>,
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

    let models_config = match model {
        Some(m) => build_models_config(m),
        None => json!({}),
    };

    let cfg = WorkerConfig {
        engine: engine_name.to_string(),
        port,
        device: device.to_string(),
        max_concurrency: 1,
        server_url: server_url.map(|value| value.to_string()),
        advertise_url: advertise_url.map(|value| value.to_string()),
        shared_paths: vec![],
        temp_upload_dir: "temp_uploads".to_string(),
        model_base_path: paths::normalize_yaml_path(model_base_path),
        models: models_config,
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
    advertise_url: &str,
    install_dir: &str,
) -> Result<(), String> {
    let engine =
        constants::find_engine(engine_id).ok_or_else(|| format!("Unknown engine: {engine_id}"))?;
    let model = resolve_model(engine_id, model_id)?;
    let resolved_device = normalize_device(device);
    let resolved_compute_key = resolve_compute_key(&resolved_device, compute_key).await;
    let normalized_server_url = normalize_optional_string(server_url);
    let normalized_advertise_url = normalize_optional_string(advertise_url);

    let runtime_root = paths::resolve_runtime_root(app, install_dir);
    let engine_dir = paths::runtime_engine_dir(&runtime_root, engine_id);
    let venv_dir = paths::engine_venv_dir_from_install_dir(&engine_dir);
    let models_dir = paths::engine_models_dir_from_install_dir(&engine_dir);
    let worker_dir = paths::engine_worker_src_dir_from_install_dir(&engine_dir);
    let install_envs = install_envs(use_mirror, proxy);

    let mut current_step_index = 0usize;
    let mut completed_steps = 0usize;

    let result: Result<(), String> = async {
        let _ = worker::stop_worker(app, engine_id).await;

        paths::ensure_runtime_root_dirs(&runtime_root).await?;
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
            "Checking existing uv...",
            &engine_dir,
            false,
            None,
        );
        ensure_uv_ready(app, engine_id, &runtime_root, use_mirror, proxy).await?;

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
            &runtime_root,
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
            &runtime_root,
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
            &runtime_root,
            &venv_dir,
            &resolved_compute_key,
            use_mirror,
            &install_envs,
        )
        .await?;
        install_engine_packages(&runtime_root, &venv_dir, engine, &install_envs).await?;

        current_step_index = 4;
        completed_steps = 4;
        if let Some(model) = model {
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
        } else {
            emit(
                app,
                engine_id,
                INSTALL_STEPS[4],
                current_step_index,
                completed_steps,
                "Skipping model download (manual placement)...",
                &engine_dir,
                false,
                None,
            );
        }

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
            normalized_advertise_url.as_deref(),
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
        let mut state = manager_state::load_state_for_runtime_root(app, &runtime_root).await?;
        state.engines.insert(
            engine_id.to_string(),
            manager_state::EngineInfo {
                engine_id: engine_id.to_string(),
                display_name: engine.display_name.to_string(),
                install_dir: paths::display_path(&engine_dir),
                runtime_root: paths::display_path(&runtime_root),
                port,
                installed_at: manager_state::now_iso(),
                last_started: None,
                engine_name: engine.engine_name.to_string(),
                device: resolved_device.clone(),
                server_url: normalized_server_url.clone(),
                advertise_url: normalized_advertise_url.clone(),
                initial_model_id: model.map(|m| m.id.to_string()),
            },
        );
        manager_state::save_state_for_runtime_root(app, &runtime_root, &state).await?;

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
        "",
        install_dir,
    )
    .await
}

pub async fn update_engine_network_settings(
    app: &AppHandle,
    engine_id: &str,
    port: u16,
    server_url: &str,
    advertise_url: &str,
) -> Result<manager_state::ManagerState, String> {
    let normalized_server_url = normalize_optional_string(server_url);
    let normalized_advertise_url = normalize_optional_string(advertise_url);

    let (runtime_root, mut state) = manager_state::load_state_for_engine(app, engine_id).await?;
    let engine = state
        .engines
        .get_mut(engine_id)
        .ok_or_else(|| format!("Engine {engine_id} not installed"))?;

    engine.port = port;
    engine.server_url = normalized_server_url.clone();
    engine.advertise_url = normalized_advertise_url.clone();

    let model = engine
        .initial_model_id
        .as_deref()
        .filter(|id| *id != "__none__")
        .and_then(|model_id| constants::find_model(engine_id, model_id))
        .or_else(|| constants::default_model_for_engine(engine_id));

    let install_dir = PathBuf::from(&engine.install_dir);
    let worker_dir = paths::engine_worker_src_dir_from_install_dir(&install_dir);
    let models_dir = paths::engine_models_dir_from_install_dir(&install_dir);

    write_worker_config(
        &worker_dir,
        &engine.resolved_engine_name(),
        engine.port,
        &engine.resolved_device(),
        &models_dir,
        normalized_server_url.as_deref(),
        normalized_advertise_url.as_deref(),
        model,
    )?;

    manager_state::save_state_for_runtime_root(app, &runtime_root, &state).await?;
    Ok(state)
}

pub async fn uninstall_engine(app: &AppHandle, engine_id: &str) -> Result<(), String> {
    let _ = worker::stop_worker(app, engine_id).await;

    let (runtime_root, mut state) = manager_state::load_state_for_engine(app, engine_id).await?;
    let engine_dir = state
        .engines
        .get(engine_id)
        .map(|engine| PathBuf::from(&engine.install_dir))
        .ok_or_else(|| format!("Engine {engine_id} not installed"))?;

    if engine_dir.exists() {
        tokio::fs::remove_dir_all(&engine_dir)
            .await
            .map_err(|e| format!("Failed to remove engine directory: {e}"))?;
    }

    state.engines.remove(engine_id);
    manager_state::save_state_for_runtime_root(app, &runtime_root, &state).await?;
    Ok(())
}
