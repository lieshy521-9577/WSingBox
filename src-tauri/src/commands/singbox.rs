use crate::apply_tray_icon;
use crate::{app_paths, core_process};
use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpStream;
use std::process::Command;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};

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

#[derive(Debug, Clone, Serialize)]
struct CoreEventPayload {
    status: String,
    message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RuntimeReconcileSnapshot {
    pub running: bool,
    pub proxy_enabled: bool,
    pub adopted_existing_runtime: bool,
    pub cleared_stale_state: bool,
    pub message: String,
}

/// Start sing-box core process with elevation (admin privileges for TUN)
#[tauri::command]
pub async fn start_singbox(app_handle: tauri::AppHandle) -> Result<String, String> {
    let _ = app_handle.emit(
        "core-starting",
        CoreEventPayload {
            status: "starting".to_string(),
            message: "Starting sing-box...".to_string(),
        },
    );

    let config_path = app_paths::runtime_config_path();
    let bootstrap_config_path = app_paths::runtime_bootstrap_config_path();

    if !config_path.exists() {
        let message =
            "Configuration file not found. Please import a config or add nodes first.".to_string();
        let _ = app_handle.emit(
            "core-failed",
            CoreEventPayload {
                status: "failed".to_string(),
                message: message.clone(),
            },
        );
        return Err(message);
    }

    prepare_runtime_config_for_bootstrap(&config_path.to_string_lossy())?;
    let _ = fs::remove_file(&bootstrap_config_path);

    let singbox_path = core_process::find_singbox_binary_with_app(&app_handle)?;
    if core_process::load_core_state().ok().flatten().is_some()
        || core_process::is_singbox_running().unwrap_or(false)
    {
        let _ = core_process::stop_singbox_process();
        thread::sleep(Duration::from_millis(400));
    }
    core_process::clear_core_state().ok();
    core_process::clear_core_pid().ok();

    clear_runtime_log_file().ok();

    let tun_enabled = config_has_tun_inbound(&config_path.to_string_lossy())?;
    let log_path = get_runtime_log_file_path();
    let (proxy_host, proxy_port) = get_mixed_inbound_endpoint(&config_path.to_string_lossy())?;
    let mut started_with_fallback = false;
    let mut started = false;
    let mut startup_config_path = config_path.to_string_lossy().to_string();

    if build_rule_set_bootstrap_config(
        &config_path.to_string_lossy(),
        &bootstrap_config_path.to_string_lossy(),
        Some("direct"),
    )? {
        startup_config_path = bootstrap_config_path.to_string_lossy().to_string();
    }

    launch_singbox_with_config(&singbox_path, &startup_config_path, &log_path, tun_enabled)?;

    if wait_for_mixed_inbound(&proxy_host, proxy_port, Duration::from_secs(6)) {
        started = true;
    } else {
        let details = get_runtime_start_failure_details().unwrap_or_default();
        let has_remote_rule_sets = config_has_remote_rule_sets(&config_path.to_string_lossy());
        let should_retry_rule_set_bootstrap =
            should_retry_without_remote_rule_sets(&details) || has_remote_rule_sets;

        if should_retry_rule_set_bootstrap {
            let removed_rule_sets = build_bootstrap_config_without_remote_rule_sets(
                &config_path.to_string_lossy(),
                &bootstrap_config_path.to_string_lossy(),
            )?;
            if removed_rule_sets > 0 {
                // launch_singbox_with_config now includes "kill old + start new"
                // in a single elevated script — no separate stop needed, only 1 UAC
                core_process::clear_core_state().ok();
                core_process::clear_core_pid().ok();
                clear_runtime_log_file().ok();
                launch_singbox_with_config(
                    &singbox_path,
                    &bootstrap_config_path.to_string_lossy(),
                    &log_path,
                    tun_enabled,
                )?;
                if wait_for_mixed_inbound(&proxy_host, proxy_port, Duration::from_secs(6)) {
                    started_with_fallback = true;
                    started = true;
                }
            }
        } else if !started {
            let removed_rule_sets = build_bootstrap_config_without_remote_rule_sets(
                &config_path.to_string_lossy(),
                &bootstrap_config_path.to_string_lossy(),
            )?;
            if removed_rule_sets > 0 && details.to_ascii_lowercase().contains("rule-set") {
                core_process::clear_core_state().ok();
                core_process::clear_core_pid().ok();
                clear_runtime_log_file().ok();
                launch_singbox_with_config(
                    &singbox_path,
                    &bootstrap_config_path.to_string_lossy(),
                    &log_path,
                    tun_enabled,
                )?;
                if wait_for_mixed_inbound(&proxy_host, proxy_port, Duration::from_secs(6)) {
                    started_with_fallback = true;
                    started = true;
                }
            }
        }
    }

    if !started {
        let details = get_runtime_start_failure_details().unwrap_or_default();
        if details.is_empty() {
            let message = "sing-box failed to start. The mixed inbound port did not open in time."
                .to_string();
            let _ = app_handle.emit(
                "core-failed",
                CoreEventPayload {
                    status: "failed".to_string(),
                    message: message.clone(),
                },
            );
            return Err(message);
        }
        let message = format!("sing-box failed to start. {}", details);
        let _ = app_handle.emit(
            "core-failed",
            CoreEventPayload {
                status: "failed".to_string(),
                message: message.clone(),
            },
        );
        return Err(message);
    }

    let proxy_applied = set_system_proxy_internal(&proxy_host, proxy_port)?;
    let _ = apply_tray_icon(&app_handle, true);
    let message = if started_with_fallback {
        "sing-box started with remote rule-set bootstrap skipped".to_string()
    } else if !proxy_applied {
        "sing-box started; existing system proxy was left unchanged".to_string()
    } else if tun_enabled {
        "sing-box started successfully with TUN elevation".to_string()
    } else {
        "sing-box started successfully".to_string()
    };

    let _ = app_handle.emit(
        "core-ready",
        CoreEventPayload {
            status: "ready".to_string(),
            message: message.clone(),
        },
    );

    Ok(message)
}

/// Stop sing-box core process and clear system proxy
#[tauri::command]
pub async fn stop_singbox(app_handle: tauri::AppHandle) -> Result<String, String> {
    cleanup_before_exit()?;
    let _ = apply_tray_icon(&app_handle, false);
    let _ = app_handle.emit(
        "core-stopped",
        CoreEventPayload {
            status: "stopped".to_string(),
            message: "sing-box stopped".to_string(),
        },
    );
    Ok("sing-box stopped".to_string())
}

#[tauri::command]
pub async fn quit_application(app_handle: tauri::AppHandle) -> Result<(), String> {
    cleanup_before_exit()?;
    let _ = apply_tray_icon(&app_handle, false);
    let _ = app_handle.emit(
        "core-stopped",
        CoreEventPayload {
            status: "stopped".to_string(),
            message: "sing-box stopped".to_string(),
        },
    );
    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn hide_main_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    let window = app_handle
        .get_webview_window("main")
        .ok_or("Main window not found".to_string())?;

    window
        .set_skip_taskbar(true)
        .map_err(|e| format!("Failed to hide taskbar entry: {}", e))?;
    window
        .hide()
        .map_err(|e| format!("Failed to hide main window: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn set_tray_connection_state(
    app_handle: tauri::AppHandle,
    connected: bool,
) -> Result<(), String> {
    apply_tray_icon(&app_handle, connected)
}

pub fn cleanup_before_exit() -> Result<(), String> {
    restore_system_proxy_internal()?;
    core_process::stop_singbox_process()?;
    Ok(())
}

#[allow(dead_code)]
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

    Ok(())
}

/// Check if sing-box is currently running
#[tauri::command]
pub async fn get_singbox_status() -> Result<bool, String> {
    if core_process::is_singbox_running()? {
        return Ok(true);
    }

    if let Some(state) = core_process::load_core_state().ok().flatten() {
        if let Ok((host, port)) = get_mixed_inbound_endpoint(&state.config_path) {
            if TcpStream::connect_timeout(
                &format!("{}:{}", host, port)
                    .parse()
                    .map_err(|e| format!("Invalid mixed inbound endpoint: {}", e))?,
                Duration::from_millis(350),
            )
            .is_ok()
            {
                return Ok(true);
            }
        }
    }

    Ok(false)
}

#[tauri::command]
pub async fn reconcile_runtime_state(
    app_handle: tauri::AppHandle,
) -> Result<RuntimeReconcileSnapshot, String> {
    let running = get_singbox_status().await?;
    let proxy_enabled = crate::commands::proxy::get_proxy_status()
        .await
        .unwrap_or(false);

    if running {
        let _ = apply_tray_icon(&app_handle, true);
        return Ok(RuntimeReconcileSnapshot {
            running: true,
            proxy_enabled,
            adopted_existing_runtime: true,
            cleared_stale_state: false,
            message: "Adopted existing sing-box runtime".to_string(),
        });
    }

    let had_state = core_process::load_core_state().ok().flatten().is_some()
        || app_paths::core_pid_path().exists();

    if had_state {
        core_process::clear_core_state().ok();
        core_process::clear_core_pid().ok();
    }

    let _ = apply_tray_icon(&app_handle, false);

    Ok(RuntimeReconcileSnapshot {
        running: false,
        proxy_enabled,
        adopted_existing_runtime: false,
        cleared_stale_state: had_state,
        message: if had_state {
            "Cleared stale sing-box runtime state".to_string()
        } else {
            "No active sing-box runtime detected".to_string()
        },
    })
}

/// Check if the app is running with elevated (admin) privileges
#[tauri::command]
pub async fn is_elevated() -> Result<bool, String> {
    Ok(core_process::is_elevated())
}

/// Request the app to restart with admin elevation (triggers UAC prompt once).
/// Before calling this, the frontend should save its state and call
/// save_elevation_intent so the restarted app auto-connects.
#[tauri::command]
pub async fn request_elevation(app_handle: tauri::AppHandle) -> Result<(), String> {
    core_process::save_elevation_intent()?;
    if let Err(err) = core_process::restart_as_admin() {
        let _ = std::fs::remove_file(crate::app_paths::app_data_dir().join("elevation-intent.json"));
        return Err(err);
    }
    // Exit the current (non-elevated) instance after spawning the elevated one
    app_handle.exit(0);
    Ok(())
}

/// Check if there's a pending elevation intent (auto-connect after admin restart).
/// Frontend calls this on startup; if true, it should auto-start the proxy.
#[tauri::command]
pub async fn check_elevation_intent() -> Result<bool, String> {
    Ok(core_process::load_elevation_intent())
}

#[tauri::command]
pub async fn get_runtime_logs() -> Result<Vec<RuntimeLogEntry>, String> {
    let path = get_runtime_log_file_path();
    if !std::path::Path::new(&path).exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read runtime log file: {}", e))?;

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

fn set_system_proxy_internal(host: &str, port: u16) -> Result<bool, String> {
    save_proxy_state_snapshot()?;

    let proxy_addr = format!("{}:{}", host, port);
    if has_external_system_proxy(&proxy_addr) {
        return Ok(false);
    }

    hidden_command("reg")
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

    hidden_command("reg")
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

    hidden_command("reg")
        .args([
            "add",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v",
            "ProxyOverride",
            "/t",
            "REG_SZ",
            "/d",
            "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;192.168.*;<local>",
            "/f",
        ])
        .output()
        .ok();

    notify_internet_settings_change();
    Ok(true)
}

fn has_external_system_proxy(target_proxy_addr: &str) -> bool {
    if query_proxy_enable().unwrap_or(0) != 1 {
        return false;
    }

    query_reg_value("ProxyServer")
        .ok()
        .flatten()
        .map(|value| {
            normalize_proxy_server_value(&value) != normalize_proxy_server_value(target_proxy_addr)
        })
        .unwrap_or(false)
}

fn normalize_proxy_server_value(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("http://")
        .trim_start_matches("https://")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn clear_system_proxy_internal() -> Result<(), String> {
    hidden_command("reg")
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

#[allow(dead_code)]
fn find_singbox_binary(app_handle: &tauri::AppHandle) -> Result<String, String> {
    core_process::find_singbox_binary_with_app(app_handle)
}

#[allow(dead_code)]
pub fn find_singbox_binary_for_version() -> Result<String, String> {
    core_process::find_singbox_binary()
}

fn hidden_command(program: &str) -> Command {
    core_process::hidden_command(program)
}

fn launch_singbox_with_config(
    singbox_path: &str,
    config_path: &str,
    log_path: &str,
    tun_enabled: bool,
) -> Result<(), String> {
    core_process::launch_singbox_with_config(singbox_path, config_path, log_path, tun_enabled)
}

#[allow(dead_code)]
fn get_config_dir() -> String {
    app_paths::app_data_dir().to_string_lossy().to_string()
}

fn get_runtime_log_file_path() -> String {
    app_paths::runtime_log_path().to_string_lossy().to_string()
}

fn prepare_runtime_config_for_bootstrap(config_path: &str) -> Result<(), String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config for bootstrap preparation: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for bootstrap preparation: {}", e))?;

    let changed_dns = sanitize_runtime_dns_for_bootstrap(&mut config);
    let selected_outbound = detect_selected_outbound_tag(&config);
    let changed_dns_detour = align_runtime_dns_detours(&mut config, selected_outbound.as_deref());
    let mut changed = changed_dns || changed_dns_detour;

    if let Some(rule_sets) = config
        .get_mut("route")
        .and_then(|route| route.get_mut("rule_set"))
        .and_then(|value| value.as_array_mut())
    {
        for rule_set in rule_sets {
            let is_remote = rule_set.get("type").and_then(|value| value.as_str()) == Some("remote");
            if !is_remote {
                continue;
            }

            if let Some(obj) = rule_set.as_object_mut() {
                if obj.get("download_detour").and_then(|value| value.as_str()) != Some("direct") {
                    obj.insert(
                        "download_detour".to_string(),
                        serde_json::Value::String("direct".to_string()),
                    );
                    changed = true;
                }
            }
        }
    }

    if changed {
        let updated = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize bootstrap-prepared config: {}", e))?;
        fs::write(config_path, updated)
            .map_err(|e| format!("Failed to save bootstrap-prepared config: {}", e))?;
    }

    Ok(())
}

fn align_runtime_dns_detours(
    config: &mut serde_json::Value,
    selected_outbound: Option<&str>,
) -> bool {
    let outbound_tags = collect_outbound_tags(config);
    let valid_selected = selected_outbound
        .filter(|tag| outbound_tags.contains(*tag))
        .map(str::to_string);
    let Some(servers) = config
        .get_mut("dns")
        .and_then(|dns| dns.get_mut("servers"))
        .and_then(|value| value.as_array_mut())
    else {
        return false;
    };

    let mut changed = false;
    for server in servers {
        let Some(obj) = server.as_object_mut() else {
            continue;
        };

        let tag = obj
            .get("tag")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if tag == "local" {
            if obj.get("detour").and_then(|value| value.as_str()) != Some("direct") {
                obj.insert(
                    "detour".to_string(),
                    serde_json::Value::String("direct".to_string()),
                );
                changed = true;
            }
            continue;
        }

        let is_remote_dns = tag == "google" || tag == "remote";
        if !is_remote_dns {
            if obj.remove("detour").is_some() {
                changed = true;
            }
            continue;
        }

        match &valid_selected {
            Some(outbound) => {
                if obj.get("detour").and_then(|value| value.as_str()) != Some(outbound.as_str()) {
                    obj.insert(
                        "detour".to_string(),
                        serde_json::Value::String(outbound.clone()),
                    );
                    changed = true;
                }
            }
            None => {
                if obj.remove("detour").is_some() {
                    changed = true;
                }
            }
        }
    }

    changed
}

fn collect_outbound_tags(config: &serde_json::Value) -> std::collections::HashSet<String> {
    config
        .get("outbounds")
        .and_then(|value| value.as_array())
        .map(|outbounds| {
            outbounds
                .iter()
                .filter_map(|outbound| {
                    outbound
                        .get("tag")
                        .and_then(|value| value.as_str())
                        .map(str::to_string)
                })
                .collect()
        })
        .unwrap_or_default()
}

fn sanitize_runtime_dns_for_bootstrap(config: &mut serde_json::Value) -> bool {
    let Some(dns) = config.get_mut("dns") else {
        return false;
    };

    let mut changed = false;

    if let Some(obj) = dns.as_object_mut() {
        let is_auto_strategy = obj
            .get("strategy")
            .and_then(|value| value.as_str())
            .map(|value| {
                let strategy = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
                strategy.is_empty()
                    || strategy == "auto"
                    || strategy == "ipv4_only"
                    || strategy == "ipv4only"
                    || strategy == "ip4_only"
                    || strategy == "ip4only"
            })
            .unwrap_or(false);

        if is_auto_strategy {
            obj.remove("strategy");
            changed = true;
        }
    }

    if let Some(rules) = dns.get_mut("rules").and_then(|value| value.as_array_mut()) {
        let before = rules.len();
        rules.retain(|rule| {
            let routes_any_outbound = rule_routes_any_outbound(rule);
            let routes_local_server =
                rule.get("server").and_then(|value| value.as_str()) == Some("local");
            !(routes_any_outbound && routes_local_server)
        });
        changed |= rules.len() != before;
    }

    if let Some(servers) = dns
        .get_mut("servers")
        .and_then(|value| value.as_array_mut())
    {
        for server in servers {
            let Some(obj) = server.as_object_mut() else {
                continue;
            };

            let is_google_tls = obj.get("tag").and_then(|value| value.as_str()) == Some("google")
                && obj.get("address").and_then(|value| value.as_str()) == Some("tls://8.8.8.8");
            let is_ali_doh = obj.get("tag").and_then(|value| value.as_str()) == Some("local")
                && obj.get("address").and_then(|value| value.as_str())
                    == Some("https://223.5.5.5/dns-query");
            let is_local = obj.get("tag").and_then(|value| value.as_str()) == Some("local");

            if is_google_tls {
                obj.insert(
                    "address".to_string(),
                    serde_json::Value::String("tcp://8.8.8.8".to_string()),
                );
                changed = true;
            }

            if is_ali_doh {
                obj.insert(
                    "address".to_string(),
                    serde_json::Value::String("223.5.5.5".to_string()),
                );
                changed = true;
            }

            if is_local && obj.get("detour").and_then(|value| value.as_str()) != Some("direct") {
                obj.insert(
                    "detour".to_string(),
                    serde_json::Value::String("direct".to_string()),
                );
                changed = true;
            }
        }
    }

    changed |= ensure_runtime_default_domain_resolver(config);

    changed
}

fn rule_routes_any_outbound(rule: &serde_json::Value) -> bool {
    if rule.get("outbound").and_then(|value| value.as_str()) == Some("any") {
        return true;
    }

    rule.get("outbound")
        .and_then(|value| value.as_array())
        .map(|items| items.iter().any(|item| item.as_str() == Some("any")))
        .unwrap_or(false)
}

fn ensure_runtime_default_domain_resolver(config: &mut serde_json::Value) -> bool {
    let has_local_dns = config
        .get("dns")
        .and_then(|dns| dns.get("servers"))
        .and_then(|servers| servers.as_array())
        .map(|servers| {
            servers
                .iter()
                .any(|server| server.get("tag").and_then(|value| value.as_str()) == Some("local"))
        })
        .unwrap_or(false);

    if !has_local_dns {
        return false;
    }

    if config
        .get("route")
        .and_then(|value| value.as_object())
        .is_none()
    {
        config["route"] = serde_json::json!({});
    }

    let Some(route) = config
        .get_mut("route")
        .and_then(|value| value.as_object_mut())
    else {
        return false;
    };

    if route
        .get("default_domain_resolver")
        .and_then(|value| value.as_str())
        == Some("local")
    {
        return false;
    }

    route.insert(
        "default_domain_resolver".to_string(),
        serde_json::Value::String("local".to_string()),
    );
    true
}

fn detect_selected_outbound_tag(config: &serde_json::Value) -> Option<String> {
    let outbounds = config.get("outbounds")?.as_array()?;
    let selector = outbounds
        .iter()
        .find(|outbound| outbound.get("type").and_then(|value| value.as_str()) == Some("selector"))
        .or_else(|| {
            outbounds.iter().find(|outbound| {
                matches!(
                    outbound.get("type").and_then(|value| value.as_str()),
                    Some("selector" | "urltest")
                )
            })
        })?;

    let preferred = selector
        .get("default")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let candidate = preferred.or_else(|| {
        selector
            .get("outbounds")
            .and_then(|value| value.as_array())
            .and_then(|members| {
                members
                    .iter()
                    .find_map(|member| member.as_str().map(str::to_string))
            })
    })?;

    Some(candidate)
}

fn should_retry_without_remote_rule_sets(details: &str) -> bool {
    let lower = details.to_ascii_lowercase();
    lower.contains("rule-set")
        && (lower.contains("initialize rule-set")
            || lower.contains("download")
            || lower.contains("eof")
            || lower.contains("timeout")
            || lower.contains("tls")
            || lower.contains("connection reset")
            || lower.contains("no such host"))
}

fn build_rule_set_bootstrap_config(
    config_path: &str,
    output_path: &str,
    download_detour: Option<&str>,
) -> Result<bool, String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config for rule-set bootstrap: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for rule-set bootstrap: {}", e))?;

    let Some(rule_sets) = config
        .get_mut("route")
        .and_then(|route| route.get_mut("rule_set"))
        .and_then(|value| value.as_array_mut())
    else {
        return Ok(false);
    };

    let mut changed = false;
    let mut found_remote = false;

    for rule_set in rule_sets {
        let is_remote = rule_set.get("type").and_then(|value| value.as_str()) == Some("remote");
        if !is_remote {
            continue;
        }

        found_remote = true;
        if let Some(obj) = rule_set.as_object_mut() {
            match download_detour {
                Some(detour) => {
                    if obj.get("download_detour").and_then(|value| value.as_str()) != Some(detour) {
                        obj.insert(
                            "download_detour".to_string(),
                            serde_json::Value::String(detour.to_string()),
                        );
                        changed = true;
                    }
                }
                None => {
                    if obj.remove("download_detour").is_some() {
                        changed = true;
                    }
                }
            }
        }
    }

    if !found_remote {
        return Ok(false);
    }

    let updated = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize rule-set bootstrap config: {}", e))?;
    fs::write(output_path, updated)
        .map_err(|e| format!("Failed to save rule-set bootstrap config: {}", e))?;

    Ok(changed || found_remote)
}

fn config_has_remote_rule_sets(config_path: &str) -> bool {
    let Ok(content) = fs::read_to_string(config_path) else {
        return false;
    };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&content) else {
        return false;
    };

    config
        .get("route")
        .and_then(|route| route.get("rule_set"))
        .and_then(|value| value.as_array())
        .map(|rule_sets| {
            rule_sets.iter().any(|rule_set| {
                rule_set.get("type").and_then(|value| value.as_str()) == Some("remote")
            })
        })
        .unwrap_or(false)
}

fn build_bootstrap_config_without_remote_rule_sets(
    config_path: &str,
    output_path: &str,
) -> Result<usize, String> {
    let content = fs::read_to_string(config_path)
        .map_err(|e| format!("Failed to read config for bootstrap fallback: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for bootstrap fallback: {}", e))?;

    let mut removed_tags: Vec<String> = Vec::new();

    if let Some(rule_sets) = config
        .get_mut("route")
        .and_then(|route| route.get_mut("rule_set"))
        .and_then(|value| value.as_array_mut())
    {
        let mut kept = Vec::with_capacity(rule_sets.len());
        for rule_set in rule_sets.iter() {
            let is_remote = rule_set.get("type").and_then(|value| value.as_str()) == Some("remote");
            if is_remote {
                if let Some(tag) = rule_set.get("tag").and_then(|value| value.as_str()) {
                    removed_tags.push(tag.to_string());
                }
            } else {
                kept.push(rule_set.clone());
            }
        }
        *rule_sets = kept;
    }

    if removed_tags.is_empty() {
        return Ok(0);
    }

    remove_rules_referencing_rule_sets(config.get_mut("route"), "rules", &removed_tags);
    remove_rules_referencing_rule_sets(config.get_mut("dns"), "rules", &removed_tags);

    let updated = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize bootstrap fallback config: {}", e))?;
    fs::write(output_path, updated)
        .map_err(|e| format!("Failed to save bootstrap fallback config: {}", e))?;

    Ok(removed_tags.len())
}

fn remove_rules_referencing_rule_sets(
    parent: Option<&mut serde_json::Value>,
    rules_key: &str,
    removed_tags: &[String],
) {
    let Some(rules) = parent
        .and_then(|value| value.get_mut(rules_key))
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };

    rules.retain(|rule| !rule_references_any_rule_set(rule, removed_tags));
}

fn rule_references_any_rule_set(rule: &serde_json::Value, removed_tags: &[String]) -> bool {
    let Some(value) = rule.get("rule_set") else {
        return false;
    };

    if let Some(single) = value.as_str() {
        return removed_tags.iter().any(|tag| tag == single);
    }

    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .any(|tag| removed_tags.iter().any(|removed| removed == tag))
        })
        .unwrap_or(false)
}

fn get_runtime_start_failure_details() -> Result<String, String> {
    let path = get_runtime_log_file_path();
    if !std::path::Path::new(&path).exists() {
        return Ok(String::new());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read runtime log file: {}", e))?;
    let lines: Vec<&str> = content
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if lines.is_empty() {
        return Ok(String::new());
    }

    let error_line = lines.iter().rev().find(|line| {
        let lower = line.to_ascii_lowercase();
        lower.contains("error") || lower.contains("fatal") || lower.contains("failed")
    });

    if let Some(line) = error_line {
        return Ok(format!("Last error: {}", line));
    }

    let excerpt = lines.iter().rev().take(3).copied().collect::<Vec<_>>();
    Ok(format!(
        "Recent log: {}",
        excerpt.into_iter().rev().collect::<Vec<_>>().join(" | ")
    ))
}

#[allow(dead_code)]
fn open_runtime_log_file() -> Result<std::fs::File, String> {
    let path = get_runtime_log_file_path();
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open runtime log file: {}", e))
}

fn clear_runtime_log_file() -> Result<(), String> {
    let path = get_runtime_log_file_path();
    fs::write(&path, "").map_err(|e| format!("Failed to clear runtime log file: {}", e))
}

fn get_proxy_state_file_path() -> String {
    app_paths::proxy_state_path().to_string_lossy().to_string()
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
    fs::write(&path, content).map_err(|e| format!("Failed to save proxy state snapshot: {}", e))?;
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
            "/v",
            "ProxyEnable",
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
            "/v",
            name,
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
            "/v",
            "ProxyEnable",
            "/t",
            "REG_DWORD",
            "/d",
            &value.to_string(),
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
                "/v",
                name,
                "/t",
                "REG_SZ",
                "/d",
                value,
                "/f",
            ]);
        }
        _ => {
            command.args([
                "delete",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                "/v",
                name,
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
    core_process::is_singbox_running()
}

fn wait_for_mixed_inbound(host: &str, port: u16, timeout: Duration) -> bool {
    let target = format!("{}:{}", host, port);
    let started = std::time::Instant::now();

    while started.elapsed() < timeout {
        if TcpStream::connect(&target).is_ok() {
            return true;
        }

        if !is_singbox_running().unwrap_or(false) {
            return false;
        }

        thread::sleep(Duration::from_millis(200));
    }

    false
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
    }
    .to_string();

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
            inbounds
                .iter()
                .find(|ib| ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed")
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
            inbounds
                .iter()
                .any(|inbound| inbound.get("type").and_then(|v| v.as_str()) == Some("tun"))
        })
        .unwrap_or(false))
}
