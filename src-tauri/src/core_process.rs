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

/// Check if the current process is running with elevated (admin) privileges.
/// Uses Windows SID check via PowerShell — only called at startup or connect time.
pub fn is_elevated() -> bool {
    #[cfg(windows)]
    {
        // S-1-5-32-544 is the well-known SID for the Administrators group.
        // If the current identity's groups contain it, we're running elevated.
        let output = hidden_command("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "[bool]([Security.Principal.WindowsIdentity]::GetCurrent().Groups -match 'S-1-5-32-544')",
            ])
            .output();

        match output {
            Ok(o) if o.status.success() => {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.trim() == "True"
            }
            _ => false,
        }
    }
    #[cfg(not(windows))]
    {
        true
    }
}

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
    if let Some(mut state) = load_core_state().ok().flatten() {
        if let Some(pid) = state.pid {
            if is_pid_running(pid) {
                return Ok(true);
            }
        }

        if let Some(launcher_pid) = state.launcher_pid {
            if is_pid_running(launcher_pid) {
                if let Some(actual_pid) = find_child_singbox_pid(launcher_pid)? {
                    state.pid = Some(actual_pid);
                    save_core_runtime_state(&state)?;
                    return Ok(true);
                }
            }
        }
    }

    if let Some(state) = detect_managed_singbox_runtime()? {
        save_core_runtime_state(&state)?;
        return Ok(true);
    }

    if let Some(pid) = load_saved_core_pid().ok().flatten() {
        if is_pid_running(pid) {
            return Ok(true);
        }
    }

    Ok(false)
}

pub fn stop_singbox_process() -> Result<(), String> {
    // If already elevated, we can kill admin processes directly — no UAC needed
    let elevated = is_elevated();
    let state = load_core_state()
        .ok()
        .flatten()
        .or_else(|| detect_managed_singbox_runtime().ok().flatten());
    let launcher_pid = state.as_ref().and_then(|saved| saved.launcher_pid);
    let core_pid = state
        .as_ref()
        .and_then(|saved| saved.pid)
        .or_else(|| load_saved_core_pid().ok().flatten());

    if let Some(launcher_pid) = launcher_pid {
        if is_pid_running(launcher_pid) {
            let _ = hidden_command("taskkill")
                .args(["/F", "/T", "/PID", &launcher_pid.to_string()])
                .output();
            thread::sleep(Duration::from_millis(300));
        }
    }

    if let Some(pid) = core_pid {
        if is_pid_running(pid) {
            let _ = hidden_command("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .output();
            thread::sleep(Duration::from_millis(400));
        }
    }

    thread::sleep(Duration::from_millis(600));

    // Only need elevated kill if we ourselves are NOT admin
    if is_singbox_running().unwrap_or(false) && !elevated {
        let mut stop_commands = Vec::new();
        if let Some(pid) = launcher_pid {
            stop_commands.push(format!(
                "Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"
            ));
        }
        if let Some(pid) = core_pid {
            stop_commands.push(format!(
                "Stop-Process -Id {pid} -Force -ErrorAction SilentlyContinue"
            ));
        }

        if stop_commands.is_empty() {
            clear_core_state().ok();
            clear_core_pid().ok();
            return Ok(());
        }

        let elevate_stop = format!(
            "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',{} -Verb RunAs -WindowStyle Hidden -Wait",
            quote_powershell_literal(&stop_commands.join("; "))
        );
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
        // If already running as admin, spawn sing-box directly — no UAC needed
        if is_elevated() {
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
                .map_err(|e| format!("Failed to start sing-box directly: {}", e))?;

            save_core_runtime_state(&CoreState {
                pid: Some(child.id()),
                launcher_pid: None,
                binary_path: singbox_path.to_string(),
                config_path: config_path.to_string(),
                log_path: log_path.to_string(),
                tun_enabled,
                started_at: current_unix_timestamp(),
            })?;
            return Ok(());
        }

        // Not elevated — use single combined elevated script that kills old + starts new
        // This reduces from 3 UAC prompts (separate stop + start) to 1 UAC per action
        let singbox_path_quoted = quote_powershell_literal(singbox_path);
        let config_path_quoted = quote_powershell_literal(config_path);
        let log_path_quoted = quote_powershell_literal(log_path);
        let pid_path = app_paths::core_pid_path().to_string_lossy().to_string();
        let pid_path_quoted = quote_powershell_literal(&pid_path);
        let env_prefix = deprecated_env_powershell_prefix();

        let inner_command = format!(
            "Remove-Item -LiteralPath {pidfile} -ErrorAction SilentlyContinue; {env_prefix} $process = Start-Process -FilePath {singbox} -ArgumentList @('run','-c',{config}) -WindowStyle Hidden -RedirectStandardOutput {log} -RedirectStandardError {log} -PassThru; Set-Content -LiteralPath {pidfile} -Value $process.Id; Wait-Process -Id $process.Id",
            env_prefix = env_prefix,
            pidfile = pid_path_quoted,
            singbox = singbox_path_quoted,
            config = config_path_quoted,
            log = log_path_quoted,
        );
        let ps_command = format!(
            "(Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',{} -Verb RunAs -WindowStyle Hidden -PassThru).Id",
            quote_powershell_literal(&inner_command),
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
            if let Some(pid) = load_saved_core_pid().ok().flatten() {
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

        if load_saved_core_pid().ok().flatten().is_none() {
            return Err("Failed to capture sing-box PID from elevated start".to_string());
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

pub fn clear_core_state() -> Result<(), String> {
    let path = app_paths::core_state_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove core state: {}", e))?;
    }
    Ok(())
}

pub fn clear_core_pid() -> Result<(), String> {
    let path = app_paths::core_pid_path();
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("Failed to remove core pid: {}", e))?;
    }
    Ok(())
}

fn load_saved_core_pid() -> Result<Option<u32>, String> {
    let path = app_paths::core_pid_path();
    if !path.exists() {
        return Ok(None);
    }

    let content =
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read core pid: {}", e))?;
    Ok(content.trim().parse::<u32>().ok())
}

fn is_pid_running(pid: u32) -> bool {
    hidden_command("tasklist")
        .args(["/FI", &format!("PID eq {}", pid)])
        .output()
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

fn find_child_singbox_pid(parent_pid: u32) -> Result<Option<u32>, String> {
    let output = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'sing-box.exe' -and $_.ParentProcessId -eq {} }} | Select-Object -First 1 -ExpandProperty ProcessId)",
                parent_pid
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to inspect child sing-box pid: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    Ok(String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .ok())
}

fn detect_managed_singbox_runtime() -> Result<Option<CoreState>, String> {
    let config_path = normalize_existing_binary_path(app_paths::runtime_config_path())
        .unwrap_or_else(|| app_paths::runtime_config_path().to_string_lossy().to_string());
    let bootstrap_path = normalize_existing_binary_path(app_paths::runtime_bootstrap_config_path())
        .unwrap_or_else(|| app_paths::runtime_bootstrap_config_path().to_string_lossy().to_string());

    let script = format!(
        "$process = Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'sing-box.exe' -and ($_.CommandLine -like '*{config}*' -or $_.CommandLine -like '*{bootstrap}*') }} | Select-Object -First 1 ProcessId,ParentProcessId,ExecutablePath,CommandLine; if ($process) {{ $process | ConvertTo-Json -Compress }}",
        config = escape_powershell_wildcard_path(&config_path),
        bootstrap = escape_powershell_wildcard_path(&bootstrap_path),
    );

    let output = hidden_command("powershell")
        .args(["-NoProfile", "-Command", &script])
        .output()
        .map_err(|e| format!("Failed to inspect managed sing-box runtime: {}", e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Ok(None);
    }

    let value: serde_json::Value =
        serde_json::from_str(&stdout).map_err(|e| format!("Failed to parse managed runtime info: {}", e))?;
    let pid = value
        .get("ProcessId")
        .and_then(|item| item.as_u64())
        .map(|item| item as u32);
    let launcher_pid = value
        .get("ParentProcessId")
        .and_then(|item| item.as_u64())
        .map(|item| item as u32)
        .filter(|parent_pid| is_powershell_process(*parent_pid));
    let executable_path = value
        .get("ExecutablePath")
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .to_string();
    let command_line = value
        .get("CommandLine")
        .and_then(|item| item.as_str())
        .unwrap_or_default()
        .to_string();

    let Some(pid) = pid else {
        return Ok(None);
    };

    let resolved_config_path = if command_line.contains("config.bootstrap.json") {
        app_paths::runtime_bootstrap_config_path()
            .to_string_lossy()
            .to_string()
    } else {
        app_paths::runtime_config_path().to_string_lossy().to_string()
    };

    Ok(Some(CoreState {
        pid: Some(pid),
        launcher_pid,
        binary_path: if executable_path.is_empty() {
            find_singbox_binary().unwrap_or_default()
        } else {
            executable_path
        },
        config_path: resolved_config_path.clone(),
        log_path: app_paths::runtime_log_path().to_string_lossy().to_string(),
        tun_enabled: resolved_config_path.contains("bootstrap")
            || std::fs::read_to_string(&resolved_config_path)
                .ok()
                .map(|content| content.contains("\"type\": \"tun\""))
                .unwrap_or(false),
        started_at: current_unix_timestamp(),
    }))
}

fn is_powershell_process(pid: u32) -> bool {
    hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "(Get-CimInstance Win32_Process -Filter \"ProcessId = {}\" | Select-Object -ExpandProperty Name)",
                pid
            ),
        ])
        .output()
        .ok()
        .map(|output| {
            let name = String::from_utf8_lossy(&output.stdout).trim().to_ascii_lowercase();
            name == "powershell.exe" || name == "pwsh.exe"
        })
        .unwrap_or(false)
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

fn escape_powershell_wildcard_path(value: &str) -> String {
    value.replace('`', "``")
        .replace('*', "`*")
        .replace('?', "`?")
        .replace('[', "`[")
        .replace(']', "`]")
        .replace('\'', "''")
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

// ── Elevation intent persistence for auto-connect after admin restart ──

/// Save a flag to disk indicating the app should auto-connect after restarting as admin.
pub fn save_elevation_intent() -> Result<(), String> {
    let path = app_paths::app_data_dir().join("elevation-intent.json");
    let payload = serde_json::json!({
        "auto_connect": true,
        "timestamp": current_unix_timestamp(),
    });
    std::fs::write(&path, serde_json::to_string(&payload).unwrap_or_default())
        .map_err(|e| format!("Failed to save elevation intent: {}", e))
}

/// Load and consume the elevation intent flag. Returns true if auto-connect is requested.
/// Deletes the file after reading (one-shot flag).
pub fn load_elevation_intent() -> bool {
    let path = app_paths::app_data_dir().join("elevation-intent.json");
    if !path.exists() {
        return false;
    }

    let result = std::fs::read_to_string(&path).ok().and_then(|content| {
        serde_json::from_str::<serde_json::Value>(&content).ok()
    });

    // Always delete after reading — this is a one-shot signal
    let _ = std::fs::remove_file(&path);

    result
        .and_then(|v| v.get("auto_connect").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

/// Restart the current Tauri app as administrator (UAC prompt).
/// The caller should save elevation intent before calling this,
/// and the restarted app will read it to auto-connect.
pub fn restart_as_admin() -> Result<(), String> {
    let exe_path = std::env::current_exe()
        .map_err(|e| format!("Failed to get current exe path: {}", e))?;
    let exe_str = exe_path.to_string_lossy().to_string();

    let result = hidden_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Start-Process -FilePath '{}' -Verb RunAs", exe_str),
        ])
        .output()
        .map_err(|e| format!("Failed to restart as admin: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&result.stdout).trim().to_string();
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "UAC prompt was canceled or the admin restart failed".to_string()
        };
        return Err(message);
    }

    Ok(())
}
