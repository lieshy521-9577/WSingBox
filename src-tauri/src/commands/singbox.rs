use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

    let ps_command = format!(
        "Start-Process -FilePath '{}' -ArgumentList 'run','-c','{}' -Verb RunAs -WindowStyle Hidden",
        singbox_path,
        config_path
    );

    let result = hidden_command("powershell")
        .args(["-Command", &ps_command])
        .output()
        .map_err(|e| format!("Failed to start sing-box: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("Failed to elevate sing-box (UAC denied?): {}", stderr));
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

    Ok("sing-box started successfully with admin privileges".to_string())
}

/// Stop sing-box core process and clear system proxy
#[tauri::command]
pub async fn stop_singbox() -> Result<String, String> {
    cleanup_before_exit();
    Ok("sing-box stopped".to_string())
}

pub fn cleanup_before_exit() {
    clear_system_proxy_internal().ok();

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

fn set_system_proxy_internal(host: &str, port: u16) -> Result<(), String> {
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

fn get_config_dir() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.to_string_lossy().to_string()
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
