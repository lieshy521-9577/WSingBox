#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::thread;
use std::time::Duration;

use crate::app_paths;
use serde::{Deserialize, Serialize};
use tauri::Manager;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const DEPRECATED_ENV_VARS: [(&str, &str); 6] = [
    ("ENABLE_DEPRECATED_LEGACY_DNS_SERVERS", "true"),
    ("ENABLE_DEPRECATED_OUTBOUND_DNS_RULE_ITEM", "true"),
    ("ENABLE_DEPRECATED_MISSING_DOMAIN_RESOLVER", "true"),
    ("ENABLE_DEPRECATED_NETWORK_INTERFACE_ADDRESS", "true"),
    ("ENABLE_DEPRECATED_DEFAULT_INTERFACE_ADDRESS", "true"),
    ("ENABLE_DEPRECATED_LEGACY_OOM_KILLER", "true"),
];

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CoreState {
    pub pid: Option<u32>,
    pub launcher_pid: Option<u32>,
    pub binary_path: String,
    pub config_path: String,
    pub log_path: String,
    pub tun_enabled: bool,
    pub started_at: u64,
}

pub fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

pub fn apply_deprecated_envs(command: &mut Command) -> &mut Command {
    for (key, value) in DEPRECATED_ENV_VARS {
        command.env(key, value);
    }
    command
}

pub fn find_singbox_binary() -> Result<String, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        for candidate in collect_binary_candidates_from_exe(&exe_path) {
            if let Some(path) = normalize_existing_binary_path(candidate) {
                return Ok(path);
            }
        }
    }

    if let Ok(output) = hidden_command("where").arg("sing-box").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    if let Some(path) =
        normalize_existing_binary_path(std::path::PathBuf::from(r"C:\_dCode\SingBox\bin\sing-box.exe"))
    {
        return Ok(path);
    }

    Err("sing-box.exe not found. Please place it in the bin/ folder or add it to PATH.".to_string())
}

pub fn find_singbox_binary_with_app(app_handle: &tauri::AppHandle) -> Result<String, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        for candidate in collect_binary_candidates_from_exe(&exe_path) {
            if let Some(path) = normalize_existing_binary_path(candidate) {
                return Ok(path);
            }
        }
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        for candidate in collect_binary_candidates_from_resource_dir(&resource_dir) {
            if let Some(path) = normalize_existing_binary_path(candidate) {
                return Ok(path);
            }
        }
    }

    find_singbox_binary()
}

pub fn is_singbox_running() -> Result<bool, String> {
    if let Some(state) = load_core_state().ok().flatten() {
        if let Some(pid) = state.pid {
            if is_pid_running(pid) {
                return Ok(true);
            }
        }
    }

    let output = hidden_command("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to check sing-box status: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("sing-box.exe"))
}

pub fn stop_singbox_process() -> Result<(), String> {
    if let Some(state) = load_core_state().ok().flatten() {
        if let Some(launcher_pid) = state.launcher_pid {
            let _ = hidden_command("taskkill")
                .args(["/F", "/T", "/PID", &launcher_pid.to_string()])
                .output();
            thread::sleep(Duration::from_millis(300));
        }

        if let Some(pid) = state.pid {
            let _ = hidden_command("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
            thread::sleep(Duration::from_millis(400));
        }
    }

    let output = hidden_command("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output();

    if let Ok(output) = output {
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("not found") && !stderr.contains("æ²¡æœ‰æ‰¾åˆ°") {
                let ps_cmd = "Stop-Process -Name 'sing-box' -Force -ErrorAction SilentlyContinue";
                hidden_command("powershell")
                    .args(["-Command", ps_cmd])
                    .output()
                    .ok();
            }
        }
    }

    thread::sleep(Duration::from_millis(600));

    if is_singbox_running().unwrap_or(false) {
        let launcher_pid = load_core_state()
            .ok()
            .flatten()
            .and_then(|state| state.launcher_pid);
        let elevate_stop = match launcher_pid {
            Some(launcher_pid) => format!(
                "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','taskkill /F /T /PID {launcher_pid}; taskkill /F /IM sing-box.exe' -Verb RunAs -WindowStyle Hidden -Wait"
            ),
            None => "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','taskkill /F /IM sing-box.exe' -Verb RunAs -WindowStyle Hidden -Wait".to_string(),
        };
        let result = hidden_command("powershell")
            .args(["-Command", &elevate_stop])
            .output()
            .map_err(|e| format!("Failed to request elevated stop for sing-box: {}", e))?;

        if !result.status.success() {
            return Err(
                "Failed to stop sing-box with elevation. The UAC prompt may have been denied."
                    .to_string(),
            );
        }

        thread::sleep(Duration::from_millis(800));
    }

    if is_singbox_running().unwrap_or(false) {
        return Err("sing-box is still running after stop. Close the elevated process or restart the app as administrator.".to_string());
    }

    clear_core_state().ok();
    clear_core_pid().ok();

    Ok(())
}

pub fn launch_singbox_with_config(
    singbox_path: &str,
    config_path: &str,
    log_path: &str,
    tun_enabled: bool,
) -> Result<(), String> {
    if tun_enabled {
        let singbox_path_quoted = quote_powershell_literal(singbox_path);
        let config_path_quoted = quote_powershell_literal(config_path);
        let log_path_quoted = quote_powershell_literal(log_path);
        let env_prefix = deprecated_env_powershell_prefix();
        let elevated_command = format!(
            "{env_prefix} & {singbox} run -c {config} *>> {log}",
            env_prefix = env_prefix,
            singbox = singbox_path_quoted,
            config = config_path_quoted,
            log = log_path_quoted,
        );
        let ps_command = format!(
            "(Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',{} -Verb RunAs -WindowStyle Hidden -PassThru).Id",
            quote_powershell_literal(&elevated_command),
        );

        let result = hidden_command("powershell")
            .args(["-Command", &ps_command])
            .output()
            .map_err(|e| format!("Failed to start sing-box: {}", e))?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!(
                "Failed to elevate sing-box (UAC denied?): {}",
                stderr
            ));
        }

        let launcher_pid = String::from_utf8_lossy(&result.stdout)
            .trim()
            .parse::<u32>()
            .ok();

        for _ in 0..20 {
            if let Some(pid) = find_latest_singbox_pid().ok().flatten() {
                save_core_runtime_state(&CoreState {
                    pid: Some(pid),
                    launcher_pid,
                    binary_path: singbox_path.to_string(),
                    config_path: config_path.to_string(),
                    log_path: log_path.to_string(),
                    tun_enabled,
                    started_at: current_unix_timestamp(),
                })?;
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
    } else {
        let log_file = open_runtime_log_file()?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|e| format!("Failed to clone runtime log file handle: {}", e))?;

        let mut command = hidden_command(singbox_path);
        let child = apply_deprecated_envs(&mut command)
            .args(["run", "-c", config_path])
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err))
            .spawn()
            .map_err(|e| format!("Failed to start sing-box without elevation: {}", e))?;

        save_core_runtime_state(&CoreState {
            pid: Some(child.id()),
            launcher_pid: None,
            binary_path: singbox_path.to_string(),
            config_path: config_path.to_string(),
            log_path: log_path.to_string(),
            tun_enabled,
            started_at: current_unix_timestamp(),
        })?;
    }

    Ok(())
}

pub fn load_core_state() -> Result<Option<CoreState>, String> {
    let path = app_paths::core_state_path();
    if !path.exists() {
        return Ok(None);
    }

    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read core state: {}", e))?;
    let state = serde_json::from_str::<CoreState>(&content)
        .map_err(|e| format!("Failed to parse core state: {}", e))?;
    Ok(Some(state))
}

fn save_core_runtime_state(state: &CoreState) -> Result<(), String> {
    if let Some(pid) = state.pid {
        std::fs::write(app_paths::core_pid_path(), pid.to_string())
            .map_err(|e| format!("Failed to save core pid: {}", e))?;
    }

    let content = serde_json::to_string_pretty(state)
        .map_err(|e| format!("Failed to serialize core state: {}", e))?;
    std::fs::write(app_paths::core_state_path(), content)
        .map_err(|e| format!("Failed to save core state: {}", e))?;
    Ok(())
}

fn clear_core_state() -> Result<(), String> {
    let path = app_paths::core_state_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove core state: {}", e))?;
    }
    Ok(())
}

fn clear_core_pid() -> Result<(), String> {
    let path = app_paths::core_pid_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove core pid: {}", e))?;
    }
    Ok(())
}

fn is_pid_running(pid: u32) -> bool {
    hidden_command("tasklist")
        .args(["/FI", &format!("PID eq {}", pid)])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

fn find_latest_singbox_pid() -> Result<Option<u32>, String> {
    let output = hidden_command("tasklist")
        .args(["/FO", "CSV", "/NH", "/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to inspect sing-box pid: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.contains("No tasks are running") {
            continue;
        }

        let parts: Vec<&str> = trimmed
            .split("\",\"")
            .map(|part| part.trim_matches('"'))
            .collect();
        if parts.len() >= 2 {
            if let Ok(pid) = parts[1].parse::<u32>() {
                return Ok(Some(pid));
            }
        }
    }

    Ok(None)
}

fn current_unix_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn deprecated_env_powershell_prefix() -> String {
    DEPRECATED_ENV_VARS
        .iter()
        .map(|(key, value)| format!("$env:{key}={};", quote_powershell_literal(value)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn quote_powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn open_runtime_log_file() -> Result<std::fs::File, String> {
    let path = app_paths::runtime_log_path();
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open runtime log file: {}", e))
}

fn collect_binary_candidates_from_exe(exe_path: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut candidates = Vec::new();
    if let Some(exe_dir) = exe_path.parent() {
        candidates.push(exe_dir.join("sing-box.exe"));
        candidates.push(exe_dir.join("bin").join("sing-box.exe"));
        candidates.push(exe_dir.join("resources").join("sing-box.exe"));
        candidates.push(exe_dir.join("resources").join("bin").join("sing-box.exe"));
        candidates.push(exe_dir.join("..").join("..").join("..").join("bin").join("sing-box.exe"));
        candidates.push(
            exe_dir
                .join("..")
                .join("..")
                .join("..")
                .join("..")
                .join("bin")
                .join("sing-box.exe"),
        );
    }
    candidates
}

fn collect_binary_candidates_from_resource_dir(
    resource_dir: &std::path::Path,
) -> Vec<std::path::PathBuf> {
    vec![
        resource_dir.join("sing-box.exe"),
        resource_dir.join("bin").join("sing-box.exe"),
    ]
}

fn normalize_existing_binary_path(candidate: std::path::PathBuf) -> Option<String> {
    if !candidate.exists() {
        return None;
    }

    let path = candidate
        .canonicalize()
        .unwrap_or(candidate)
        .to_string_lossy()
        .to_string();
    Some(path.strip_prefix(r"\\?\").unwrap_or(&path).to_string())
}
