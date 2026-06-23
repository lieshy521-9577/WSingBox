use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::process::Stdio;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProxyStateSnapshot {
    proxy_enable: Option<u32>,
    proxy_server: Option<String>,
    proxy_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeLogEntry {
    pub id: usize,
    pub timestamp: String,
    pub level: String,
    pub message: String,
}

/// Start sing-box core process with elevation (admin privileges for TUN)
#[tauri::command]
pub async fn start_singbox(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_dir = get_config_dir();
    let config_path = format!("{}\\config.json", config_dir);

    if !std::path::Path::new(&config_path).exists() {
        return Err("Configuration file not found. Please import a config or add nodes first.".to_string());
    }

    let singbox_path = find_singbox_binary(&app_handle)?;

    hidden_command("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output()
        .ok();

    thread::sleep(Duration::from_millis(500));

    clear_runtime_log_file().ok();

    let tun_enabled = config_has_tun_inbound(&config_path)?;
    let log_path = get_runtime_log_file_path();

    if tun_enabled {
        let singbox_path_quoted = quote_powershell_literal(&singbox_path);
        let config_path_quoted = quote_powershell_literal(&config_path);
        let log_path_quoted = quote_powershell_literal(&log_path);
        let elevated_command = format!(
            "& {singbox} run -c {config} *>> {log}",
            singbox = singbox_path_quoted,
            config = config_path_quoted,
            log = log_path_quoted,
        );
        let ps_command = format!(
            "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command',{} -Verb RunAs -WindowStyle Hidden",
            quote_powershell_literal(&elevated_command),
        );

        let result = hidden_command("powershell")
            .args(["-Command", &ps_command])
            .output()
            .map_err(|e| format!("Failed to start sing-box: {}", e))?;

        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            return Err(format!("Failed to elevate sing-box (UAC denied?): {}", stderr));
        }
    } else {
        let log_file = open_runtime_log_file()?;
        let log_file_err = log_file
            .try_clone()
            .map_err(|e| format!("Failed to clone runtime log file handle: {}", e))?;

        hidden_command(&singbox_path)
            .args(["run", "-c", &config_path])
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err))
            .spawn()
            .map_err(|e| format!("Failed to start sing-box without elevation: {}", e))?;
    }

    thread::sleep(Duration::from_secs(2));

    let check = hidden_command("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to verify sing-box status: {}", e))?;

    let stdout = String::from_utf8_lossy(&check.stdout);
    if !stdout.contains("sing-box.exe") {
        return Err("sing-box failed to start. Check if the configuration is correct.".to_string());
    }

    let (proxy_host, proxy_port) = get_mixed_inbound_endpoint(&config_path)?;
    set_system_proxy_internal(&proxy_host, proxy_port)?;

    Ok(if tun_enabled {
        "sing-box started successfully with TUN elevation".to_string()
    } else {
        "sing-box started successfully".to_string()
    })
}

/// Stop sing-box core process and clear system proxy
#[tauri::command]
pub async fn stop_singbox() -> Result<String, String> {
    cleanup_before_exit()?;
    Ok("sing-box stopped".to_string())
}

#[tauri::command]
pub async fn quit_application(app_handle: tauri::AppHandle) -> Result<(), String> {
    cleanup_before_exit()?;
    app_handle.exit(0);
    Ok(())
}

pub fn cleanup_before_exit() -> Result<(), String> {
    restore_system_proxy_internal()?;
    stop_singbox_process()?;
    Ok(())
}

fn stop_singbox_process() -> Result<(), String> {
    let output = hidden_command("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output();

    if let Ok(output) = output {
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            if !stderr.contains("not found") && !stderr.contains("没有找到") {
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
        let elevate_stop = "Start-Process -FilePath 'powershell' -ArgumentList '-NoProfile','-WindowStyle','Hidden','-Command','taskkill /F /IM sing-box.exe' -Verb RunAs -WindowStyle Hidden -Wait";
        let result = hidden_command("powershell")
            .args(["-Command", elevate_stop])
            .output()
            .map_err(|e| format!("Failed to request elevated stop for sing-box: {}", e))?;

        if !result.status.success() {
            return Err("Failed to stop sing-box with elevation. The UAC prompt may have been denied.".to_string());
        }

        thread::sleep(Duration::from_millis(800));
    }

    if is_singbox_running().unwrap_or(false) {
        return Err("sing-box is still running after stop. Close the elevated process or restart the app as administrator.".to_string());
    }

    Ok(())
}

/// Check if sing-box is currently running
#[tauri::command]
pub async fn get_singbox_status() -> Result<bool, String> {
    let output = hidden_command("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to check status: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("sing-box.exe"))
}

#[tauri::command]
pub async fn get_runtime_logs() -> Result<Vec<RuntimeLogEntry>, String> {
    let path = get_runtime_log_file_path();
    if !std::path::Path::new(&path).exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read runtime log file: {}", e))?;

    let lines: Vec<&str> = content.lines().collect();
    let start = lines.len().saturating_sub(500);
    Ok(lines[start..]
        .iter()
        .enumerate()
        .filter_map(|(idx, line)| parse_runtime_log_line(start + idx + 1, line))
        .collect())
}

#[tauri::command]
pub async fn clear_runtime_logs() -> Result<String, String> {
    clear_runtime_log_file()?;
    Ok("Runtime logs cleared".to_string())
}

fn set_system_proxy_internal(host: &str, port: u16) -> Result<(), String> {
    save_proxy_state_snapshot()?;

    let proxy_addr = format!("{}:{}", host, port);

    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyEnable",
            "/t", "REG_DWORD",
            "/d", "1",
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to enable proxy: {}", e))?;

    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyServer",
            "/t", "REG_SZ",
            "/d", &proxy_addr,
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to set proxy server: {}", e))?;

    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyOverride",
            "/t", "REG_SZ",
            "/d", "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;192.168.*;<local>",
            "/f",
        ])
        .output()
        .ok();

    notify_internet_settings_change();
    Ok(())
}

fn clear_system_proxy_internal() -> Result<(), String> {
    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyEnable",
            "/t", "REG_DWORD",
            "/d", "0",
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to clear proxy: {}", e))?;

    notify_internet_settings_change();
    Ok(())
}

fn restore_system_proxy_internal() -> Result<(), String> {
    if let Some(snapshot) = load_proxy_state_snapshot()? {
        write_proxy_enable(snapshot.proxy_enable.unwrap_or(0))?;
        write_or_delete_reg_value("ProxyServer", snapshot.proxy_server.as_deref())?;
        write_or_delete_reg_value("ProxyOverride", snapshot.proxy_override.as_deref())?;
        notify_internet_settings_change();
        delete_proxy_state_snapshot().ok();
        return Ok(());
    }

    clear_system_proxy_internal()?;
    write_or_delete_reg_value("ProxyServer", None)?;
    write_or_delete_reg_value("ProxyOverride", None)?;
    notify_internet_settings_change();
    Ok(())
}

fn notify_internet_settings_change() {
    hidden_command("powershell")
        .args([
            "-Command",
            r#"
            Add-Type -TypeDefinition @"
            using System;
            using System.Runtime.InteropServices;
            public class WinINet {
                [DllImport("wininet.dll", SetLastError=true)]
                public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
                public const int INTERNET_OPTION_SETTINGS_CHANGED = 39;
                public const int INTERNET_OPTION_REFRESH = 37;
            }
"@
            [WinINet]::InternetSetOption([IntPtr]::Zero, [WinINet]::INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0)
            [WinINet]::InternetSetOption([IntPtr]::Zero, [WinINet]::INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0)
            "#,
        ])
        .output()
        .ok();
}

fn find_singbox_binary(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            let candidates = vec![
                exe_dir.join("sing-box.exe"),
                exe_dir.join("bin").join("sing-box.exe"),
                exe_dir.join("..").join("..").join("..").join("bin").join("sing-box.exe"),
                exe_dir.join("..").join("..").join("..").join("..").join("bin").join("sing-box.exe"),
            ];

            for candidate in candidates {
                if candidate.exists() {
                    let path = candidate
                        .canonicalize()
                        .unwrap_or(candidate)
                        .to_string_lossy()
                        .to_string();
                    let path = path.strip_prefix(r"\\?\").unwrap_or(&path).to_string();
                    return Ok(path);
                }
            }
        }
    }

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let resource_bin = resource_dir.join("bin").join("sing-box.exe");
        if resource_bin.exists() {
            return Ok(resource_bin.to_string_lossy().to_string());
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

    let dev_path = std::path::PathBuf::from(r"C:\_dCode\SingBox\bin\sing-box.exe");
    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("sing-box.exe not found. Please place it in the bin/ folder or add it to PATH.".to_string())
}

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

fn quote_powershell_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn get_config_dir() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.to_string_lossy().to_string()
}

fn get_runtime_log_file_path() -> String {
    format!("{}\\singbox-runtime.log", get_config_dir())
}

fn open_runtime_log_file() -> Result<std::fs::File, String> {
    let path = get_runtime_log_file_path();
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open runtime log file: {}", e))
}

fn clear_runtime_log_file() -> Result<(), String> {
    let path = get_runtime_log_file_path();
    fs::write(&path, "")
        .map_err(|e| format!("Failed to clear runtime log file: {}", e))
}

fn get_proxy_state_file_path() -> String {
    format!("{}\\proxy-state.json", get_config_dir())
}

fn save_proxy_state_snapshot() -> Result<(), String> {
    let path = get_proxy_state_file_path();
    if std::path::Path::new(&path).exists() {
        return Ok(());
    }

    let snapshot = ProxyStateSnapshot {
        proxy_enable: query_proxy_enable().ok(),
        proxy_server: query_reg_value("ProxyServer").ok().flatten(),
        proxy_override: query_reg_value("ProxyOverride").ok().flatten(),
    };

    let content = serde_json::to_string_pretty(&snapshot)
        .map_err(|e| format!("Failed to serialize proxy state snapshot: {}", e))?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save proxy state snapshot: {}", e))?;
    Ok(())
}

fn load_proxy_state_snapshot() -> Result<Option<ProxyStateSnapshot>, String> {
    let path = get_proxy_state_file_path();
    if !std::path::Path::new(&path).exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read proxy state snapshot: {}", e))?;
    let snapshot = serde_json::from_str::<ProxyStateSnapshot>(&content)
        .map_err(|e| format!("Failed to parse proxy state snapshot: {}", e))?;
    Ok(Some(snapshot))
}

fn delete_proxy_state_snapshot() -> Result<(), String> {
    let path = get_proxy_state_file_path();
    if std::path::Path::new(&path).exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete proxy state snapshot: {}", e))?;
    }
    Ok(())
}

fn query_proxy_enable() -> Result<u32, String> {
    let output = hidden_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyEnable",
        ])
        .output()
        .map_err(|e| format!("Failed to query ProxyEnable: {}", e))?;

    if !output.status.success() {
        return Ok(0);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    if stdout.contains("0x1") {
        Ok(1)
    } else {
        Ok(0)
    }
}

fn query_reg_value(name: &str) -> Result<Option<String>, String> {
    let output = hidden_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", name,
        ])
        .output()
        .map_err(|e| format!("Failed to query registry value '{}': {}", name, e))?;

    if !output.status.success() {
        return Ok(None);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value = stdout
        .lines()
        .find(|line| line.contains(name))
        .and_then(|line| line.split_whitespace().last())
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty());

    Ok(value)
}

fn write_proxy_enable(value: u32) -> Result<(), String> {
    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyEnable",
            "/t", "REG_DWORD",
            "/d", &value.to_string(),
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to write ProxyEnable: {}", e))?;
    Ok(())
}

fn write_or_delete_reg_value(name: &str, value: Option<&str>) -> Result<(), String> {
    let mut command = hidden_command("reg");
    match value {
        Some(value) if !value.is_empty() => {
            command.args([
                "add",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v", name,
                "/t", "REG_SZ",
                "/d", value,
                "/f",
            ]);
        }
        _ => {
            command.args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v", name,
                "/f",
            ]);
        }
    }

    let output = command
        .output()
        .map_err(|e| format!("Failed to update registry value '{}': {}", name, e))?;

    if !output.status.success() && value.is_some() {
        return Err(format!("Failed to write registry value '{}'", name));
    }

    Ok(())
}

fn is_singbox_running() -> Result<bool, String> {
    let output = hidden_command("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to check sing-box status: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("sing-box.exe"))
}

fn parse_runtime_log_line(id: usize, line: &str) -> Option<RuntimeLogEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return None;
    }

    let lower = trimmed.to_ascii_lowercase();
    let level = if lower.contains("error") {
        "error"
    } else if lower.contains("warn") {
        "warn"
    } else if lower.contains("debug") {
        "debug"
    } else {
        "info"
    }.to_string();

    let (timestamp, message) = if let Some((first, rest)) = trimmed.split_once(' ') {
        if first.contains(':') || first.contains('T') {
            (first.to_string(), rest.trim().to_string())
        } else {
            ("".to_string(), trimmed.to_string())
        }
    } else {
        ("".to_string(), trimmed.to_string())
    };

    Some(RuntimeLogEntry {
        id,
        timestamp,
        level,
        message,
    })
}

fn get_mixed_inbound_endpoint(config_path: &str) -> Result<(String, u16), String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config for proxy settings: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for proxy settings: {}", e))?;

    let mixed = config
        .get("inbounds")
        .and_then(|v| v.as_array())
        .and_then(|inbounds| {
            inbounds.iter().find(|ib| {
                ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed"
            })
        })
        .ok_or("No mixed inbound found in current config".to_string())?;

    let host = mixed
        .get("listen")
        .and_then(|v| v.as_str())
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = mixed
        .get("listen_port")
        .and_then(|v| v.as_u64())
        .unwrap_or(7890) as u16;

    Ok((host, port))
}

fn config_has_tun_inbound(config_path: &str) -> Result<bool, String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config for TUN detection: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for TUN detection: {}", e))?;

    Ok(config
        .get("inbounds")
        .and_then(|v| v.as_array())
        .map(|inbounds| {
            inbounds.iter().any(|inbound| {
                inbound.get("type").and_then(|v| v.as_str()) == Some("tun")
            })
        })
        .unwrap_or(false))
}
