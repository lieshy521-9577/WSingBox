use std::process::Command;
use std::thread;
use std::time::Duration;

/// Start sing-box core process with elevation (admin privileges for TUN)
#[tauri::command]
pub async fn start_singbox(app_handle: tauri::AppHandle) -> Result<String, String> {
    let config_dir = get_config_dir();
    let config_path = format!("{}\\config.json", config_dir);

    // Check if config file exists
    if !std::path::Path::new(&config_path).exists() {
        return Err("Configuration file not found. Please import a config or add nodes first.".to_string());
    }

    // Find sing-box binary
    let singbox_path = find_singbox_binary(&app_handle)?;

    // Kill any existing sing-box process first
    Command::new("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output()
        .ok();

    // Wait for process to terminate
    thread::sleep(Duration::from_millis(500));

    // Start sing-box with admin elevation using PowerShell
    // This triggers a UAC prompt for the user
    // Note: PowerShell single-quoted strings treat backslashes literally, no escaping needed
    let ps_command = format!(
        "Start-Process -FilePath '{}' -ArgumentList 'run','-c','{}' -Verb RunAs -WindowStyle Hidden",
        singbox_path,
        config_path
    );

    let result = Command::new("powershell")
        .args(["-Command", &ps_command])
        .output()
        .map_err(|e| format!("Failed to start sing-box: {}", e))?;

    if !result.status.success() {
        let stderr = String::from_utf8_lossy(&result.stderr);
        return Err(format!("Failed to elevate sing-box (UAC denied?): {}", stderr));
    }

    // Wait for sing-box to initialize
    thread::sleep(Duration::from_secs(2));

    // Verify sing-box is running
    let check = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to verify sing-box status: {}", e))?;

    let stdout = String::from_utf8_lossy(&check.stdout);
    if !stdout.contains("sing-box.exe") {
        return Err("sing-box failed to start. Check if the configuration is correct.".to_string());
    }

    // Set system proxy to the mixed inbound port
    set_system_proxy_internal("127.0.0.1", 7890)?;

    Ok("sing-box started successfully with admin privileges".to_string())
}

/// Stop sing-box core process and clear system proxy
#[tauri::command]
pub async fn stop_singbox() -> Result<String, String> {
    // Clear system proxy first
    clear_system_proxy_internal().ok();

    // On Windows, use taskkill to terminate sing-box (works for elevated processes too)
    let output = Command::new("taskkill")
        .args(["/F", "/IM", "sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to stop sing-box: {}", e))?;

    if output.status.success() {
        Ok("sing-box stopped successfully".to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Not running is also considered success
        if stderr.contains("not found") || stderr.contains("没有找到") {
            Ok("sing-box is not running".to_string())
        } else {
            // Try elevated taskkill
            let ps_cmd = "Stop-Process -Name 'sing-box' -Force -ErrorAction SilentlyContinue";
            Command::new("powershell")
                .args(["-Command", ps_cmd])
                .output()
                .ok();
            Ok("sing-box stopped".to_string())
        }
    }
}

/// Check if sing-box is currently running
#[tauri::command]
pub async fn get_singbox_status() -> Result<bool, String> {
    let output = Command::new("tasklist")
        .args(["/FI", "IMAGENAME eq sing-box.exe"])
        .output()
        .map_err(|e| format!("Failed to check status: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.contains("sing-box.exe"))
}

/// Internal helper: set system proxy
fn set_system_proxy_internal(host: &str, port: u16) -> Result<(), String> {
    let proxy_addr = format!("{}:{}", host, port);

    Command::new("reg")
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

    Command::new("reg")
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

    // Set bypass list for local addresses
    Command::new("reg")
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

/// Internal helper: clear system proxy
fn clear_system_proxy_internal() -> Result<(), String> {
    Command::new("reg")
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

/// Notify Windows that internet settings have changed
fn notify_internet_settings_change() {
    Command::new("powershell")
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

/// Find sing-box binary in multiple locations
fn find_singbox_binary(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // 1. Check bin/ directory relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            // In dev mode: project_root/src-tauri/target/debug/
            // We want: project_root/bin/sing-box.exe
            let candidates = vec![
                exe_dir.join("sing-box.exe"),
                exe_dir.join("bin").join("sing-box.exe"),
                exe_dir.join("..").join("..").join("..").join("bin").join("sing-box.exe"),
                exe_dir.join("..").join("..").join("..").join("..").join("bin").join("sing-box.exe"),
            ];

            for candidate in candidates {
                if candidate.exists() {
                    let path = candidate.canonicalize()
                        .unwrap_or(candidate)
                        .to_string_lossy()
                        .to_string();
                    // Strip Windows extended-length path prefix \\?\
                    let path = path.strip_prefix(r"\\?\").unwrap_or(&path).to_string();
                    return Ok(path);
                }
            }
        }
    }

    // 2. Check app resource directory (for bundled release)
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let resource_bin = resource_dir.join("bin").join("sing-box.exe");
        if resource_bin.exists() {
            return Ok(resource_bin.to_string_lossy().to_string());
        }
    }

    // 3. Check if in PATH
    if let Ok(output) = Command::new("where").arg("sing-box").output() {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return Ok(path.lines().next().unwrap_or(&path).to_string());
            }
        }
    }

    // 4. Hardcoded fallback for development
    let dev_path = std::path::PathBuf::from(r"C:\_dCode\SingBox\bin\sing-box.exe");
    if dev_path.exists() {
        return Ok(dev_path.to_string_lossy().to_string());
    }

    Err("sing-box.exe not found. Please place it in the bin/ folder or add it to PATH.".to_string())
}

fn get_config_dir() -> String {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    std::fs::create_dir_all(&config_dir).ok();
    config_dir.to_string_lossy().to_string()
}
