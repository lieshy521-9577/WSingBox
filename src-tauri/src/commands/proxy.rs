#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::process::Command;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Set system proxy (HTTP proxy mode)
#[tauri::command]
pub async fn set_system_proxy(host: String, port: u16) -> Result<String, String> {
    let proxy_addr = format!("{}:{}", host, port);

    // Enable proxy via Windows registry
    let enable_result = hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyEnable",
            "/t",
            "REG_DWORD",
            "/d",
            "1",
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to enable proxy: {}", e))?;

    if !enable_result.status.success() {
        return Err("Failed to enable system proxy".to_string());
    }

    // Set proxy server address
    let server_result = hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyServer",
            "/t",
            "REG_SZ",
            "/d",
            &proxy_addr,
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to set proxy server: {}", e))?;

    if !server_result.status.success() {
        return Err("Failed to set proxy server address".to_string());
    }

    // Notify system of internet settings change
    notify_internet_settings_change();

    Ok(format!("System proxy set to {}", proxy_addr))
}

/// Clear system proxy settings
#[tauri::command]
pub async fn clear_system_proxy() -> Result<String, String> {
    let result = hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyEnable",
            "/t",
            "REG_DWORD",
            "/d",
            "0",
            "/f",
        ])
        .output()
        .map_err(|e| format!("Failed to clear proxy: {}", e))?;

    if !result.status.success() {
        return Err("Failed to clear system proxy".to_string());
    }

    notify_internet_settings_change();
    Ok("System proxy cleared".to_string())
}

/// Get current proxy status
#[tauri::command]
pub async fn get_proxy_status() -> Result<bool, String> {
    let output = hidden_command("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyEnable",
        ])
        .output()
        .map_err(|e| format!("Failed to query proxy status: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Check if ProxyEnable is set to 1
    Ok(stdout.contains("0x1"))
}

/// Notify Windows that internet settings have changed
fn notify_internet_settings_change() {
    // Use PowerShell to invoke WinINet notification
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

fn hidden_command(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}
