use serde::Serialize;
use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize)]
pub struct HardwareInfo {
    pub cpu_name: String,
    pub cpu_cores: u32,
    pub ram_gb: u32,
    pub has_cuda: bool,
    pub gpu_name: String,
    pub vram_mb: u32,
    pub cuda_version: Option<String>,
    pub has_mps: bool,
    pub recommended_device: String,
    pub compute_key: String,
}

pub async fn detect() -> Result<HardwareInfo, String> {
    let cpu_cores = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(1);

    let cpu_name = detect_cpu_name();
    let ram_gb = detect_ram_gb();
    let (has_cuda, gpu_name, vram_mb, cuda_version) = detect_cuda();
    let has_mps = detect_mps();

    let (recommended_device, compute_key) = if has_cuda {
        let key = cuda_compute_key(cuda_version.as_deref());
        ("cuda".to_string(), key)
    } else if has_mps {
        ("mps".to_string(), "mps".to_string())
    } else {
        ("cpu".to_string(), "cpu".to_string())
    };

    Ok(HardwareInfo {
        cpu_name,
        cpu_cores,
        ram_gb,
        has_cuda,
        gpu_name,
        vram_mb,
        cuda_version,
        has_mps,
        recommended_device,
        compute_key,
    })
}

fn detect_cpu_name() -> String {
    #[cfg(target_os = "windows")]
    {
        let output = Command::new("wmic")
            .args(["cpu", "get", "Name", "/value"])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                if let Some(name) = line.strip_prefix("Name=") {
                    let name = name.trim();
                    if !name.is_empty() {
                        return name.to_string();
                    }
                }
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output();
        if let Ok(out) = output {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return name;
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/cpuinfo") {
            for line in content.lines() {
                if line.starts_with("model name") {
                    if let Some(name) = line.split(':').nth(1) {
                        let name = name.trim();
                        if !name.is_empty() {
                            return name.to_string();
                        }
                    }
                }
            }
        }
    }
    "Unknown CPU".to_string()
}

fn detect_ram_gb() -> u32 {
    #[cfg(target_os = "windows")]
    {
        // Use windows-sys GlobalMemoryStatusEx
        use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        unsafe {
            let mut mem: MEMORYSTATUSEX = std::mem::zeroed();
            mem.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut mem) != 0 {
                return (mem.ullTotalPhys / (1024 * 1024 * 1024)) as u32;
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("sysctl").args(["-n", "hw.memsize"]).output();
        if let Ok(out) = output {
            if let Ok(bytes) = String::from_utf8_lossy(&out.stdout).trim().parse::<u64>() {
                return (bytes / (1024 * 1024 * 1024)) as u32;
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(content) = std::fs::read_to_string("/proc/meminfo") {
            for line in content.lines() {
                if line.starts_with("MemTotal:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if let Some(kb_str) = parts.get(1) {
                        if let Ok(kb) = kb_str.parse::<u64>() {
                            return (kb / (1024 * 1024)) as u32;
                        }
                    }
                }
            }
        }
    }
    0
}

fn detect_cuda() -> (bool, String, u32, Option<String>) {
    let mut cmd = Command::new("nvidia-smi");
    cmd.args([
        "--query-gpu=name,memory.total,driver_version",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            if let Some(line) = text.lines().next() {
                let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                let gpu_name = parts.first().unwrap_or(&"Unknown GPU").to_string();
                let vram_mb = parts
                    .get(1)
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0);
                let driver = parts.get(2).map(|s| s.to_string());

                // Get CUDA version from nvidia-smi header
                let cuda_ver = detect_cuda_version();

                return (true, gpu_name, vram_mb, cuda_ver.or(driver));
            }
            (false, String::new(), 0, None)
        }
        _ => (false, String::new(), 0, None),
    }
}

fn detect_cuda_version() -> Option<String> {
    let mut cmd = Command::new("nvidia-smi");
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    match cmd.output() {
        Ok(out) if out.status.success() => {
            let text = String::from_utf8_lossy(&out.stdout);
            // Look for "CUDA Version: XX.X"
            for line in text.lines() {
                if let Some(pos) = line.find("CUDA Version:") {
                    let ver = line[pos + 13..].trim();
                    let ver = ver.split_whitespace().next().unwrap_or(ver);
                    return Some(ver.to_string());
                }
            }
            None
        }
        _ => None,
    }
}

fn cuda_compute_key(cuda_version: Option<&str>) -> String {
    match cuda_version {
        Some(ver) => {
            let major_minor: f32 = ver.parse().unwrap_or(0.0);
            if major_minor >= 12.4 {
                "cu124".to_string()
            } else if major_minor >= 12.1 {
                "cu121".to_string()
            } else {
                "cpu".to_string()
            }
        }
        None => "cpu".to_string(),
    }
}

fn detect_mps() -> bool {
    #[cfg(target_os = "macos")]
    {
        // Check for Apple Silicon via uname -m
        if let Ok(out) = Command::new("uname").arg("-m").output() {
            let arch = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if arch == "arm64" {
                return true;
            }
        }
        // Fallback: check system_profiler for Metal support
        if let Ok(out) = Command::new("system_profiler")
            .arg("SPDisplaysDataType")
            .output()
        {
            let text = String::from_utf8_lossy(&out.stdout);
            return text.contains("Metal") || text.contains("Apple M");
        }
    }
    false
}
