use serde::{Deserialize, Serialize};
use std::fs;
use std::net::TcpListener;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;
#[cfg(windows)]
use winreg::enums::HKEY_CURRENT_USER;
#[cfg(windows)]
use winreg::RegKey;

/// Represents a proxy node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyNode {
    pub id: String,
    pub name: String, // tag from sing-box config
    pub node_type: String,
    pub server: String,
    pub port: u16,
    pub settings: serde_json::Value,
}

/// Represents a profile (selector/urltest group)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub tag: String,
    pub profile_type: String, // "selector" or "urltest"
    pub outbounds: Vec<String>,
    pub default_outbound: String,
    pub interval: String,
    pub tolerance: u64,
}

/// Result of importing a config: overview + extracted nodes + profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub overview: ConfigOverview,
    pub nodes: Vec<ProxyNode>,
    pub profiles: Vec<Profile>,
    pub active_node: String, // auto-selected node tag based on profile
    pub active_outbound: String,
}

/// Overview of an imported sing-box configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigOverview {
    pub file_path: String,
    pub inbounds: Vec<InboundInfo>,
    pub outbounds: Vec<OutboundInfo>,
    pub dns_servers: Vec<DnsServerInfo>,
    pub route_rules_count: usize,
    pub route_rules: Vec<RouteRuleInfo>,
    pub rule_sets: Vec<RuleSetInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboundInfo {
    pub inbound_type: String,
    pub tag: String,
    pub listen: String,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutboundInfo {
    pub outbound_type: String,
    pub tag: String,
    pub server: String,
    pub port: u16,
    pub details: String,
    pub is_group: bool,
    pub group_members: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DnsServerInfo {
    pub tag: String,
    pub dns_type: String,
    pub server: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleSetInfo {
    pub tag: String,
    pub rule_type: String,
    pub format: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRuleInfo {
    pub summary: String,
    pub rule_type: String,
    pub action: String,
    pub outbound: String,
    pub raw: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuntimeDebugSnapshot {
    pub route_final: String,
    pub top_selector_tag: String,
    pub top_selector_default: String,
    pub active_leaf_outbound: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoreRuntimeInfo {
    pub binary_path: String,
    pub config_path: String,
    pub log_path: String,
    pub pid: Option<u32>,
    pub running: bool,
    pub tun_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOutboundSwitchRequest {
    pub target_tag: String,
    #[serde(default = "default_close_affected_connections")]
    pub close_affected_connections: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOutboundSwitchResult {
    pub requested_tag: String,
    pub active_tag: String,
    pub switched_live: bool,
    pub closed_connections: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
struct OutboundSelectionPlan {
    selector_path: Vec<(String, String)>,
    active_tag: String,
}

static OUTBOUND_SWITCH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Persistent client settings applied to imported/generated configs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub autostart_enabled: bool,
    pub tun_enabled: bool,
    pub mixed_listen: String,
    pub mixed_port: u16,
    pub tun_interface_name: String,
    pub tun_mtu: u64,
    pub tun_stack: String,
    pub tun_auto_route: bool,
    pub tun_strict_route: bool,
    pub tun_sniff: bool,
    pub tun_sniff_override_destination: bool,
    pub tun_address: Vec<String>,
    pub dns_final: String,
    pub dns_strategy: String,
    pub dns_servers: Vec<serde_json::Value>,
    #[serde(default = "default_latency_test_url")]
    pub latency_test_url: String,
    #[serde(default = "default_latency_timeout_ms")]
    pub latency_timeout_ms: u64,
    #[serde(default = "default_latency_concurrency")]
    pub latency_concurrency: u8,
    #[serde(default = "default_latency_auto_test")]
    pub latency_auto_test: bool,
}

/// Saved imported config profile metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile {
    pub id: String,
    pub name: String,
    pub source_path: String,
    #[serde(default = "default_profile_source_kind")]
    pub source_kind: String,
    #[serde(default)]
    pub refreshable: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportValidationReport {
    pub source_kind: String,
    pub display_name: String,
    pub node_count: usize,
    pub group_count: usize,
    pub has_tun: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHealthItem {
    pub key: String,
    pub label: String,
    pub status: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupHealthReport {
    pub ready: bool,
    pub items: Vec<StartupHealthItem>,
}

/// Non-proxy outbound types that should NOT be extracted as nodes
const SPECIAL_OUTBOUND_TYPES: &[&str] = &["direct", "block", "dns", "selector", "urltest"];

fn default_dns_servers() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "tag": "google",
            "address": "tcp://8.8.8.8"
        }),
        serde_json::json!({
            "tag": "local",
            "address": "223.5.5.5",
            "detour": "direct"
        }),
    ]
}

fn default_latency_test_url() -> String {
    "https://www.gstatic.com/generate_204".to_string()
}

fn default_latency_timeout_ms() -> u64 {
    5_000
}

fn default_latency_concurrency() -> u8 {
    16
}

fn default_latency_auto_test() -> bool {
    true
}

fn default_close_affected_connections() -> bool {
    true
}

fn default_app_settings() -> AppSettings {
    AppSettings {
        autostart_enabled: false,
        tun_enabled: false,
        mixed_listen: "127.0.0.1".to_string(),
        mixed_port: 7890,
        tun_interface_name: "singbox".to_string(),
        tun_mtu: 9000,
        tun_stack: "mixed".to_string(),
        tun_auto_route: true,
        tun_strict_route: true,
        tun_sniff: true,
        tun_sniff_override_destination: true,
        tun_address: vec!["172.19.0.1/30".to_string()],
        dns_final: "google".to_string(),
        dns_strategy: "auto".to_string(),
        dns_servers: default_dns_servers(),
        latency_test_url: default_latency_test_url(),
        latency_timeout_ms: default_latency_timeout_ms(),
        latency_concurrency: default_latency_concurrency(),
        latency_auto_test: default_latency_auto_test(),
    }
}

/// Import a sing-box config file: parse overview, extract nodes, determine active profile
#[tauri::command]
pub async fn import_config_file(file_path: String) -> Result<ImportResult, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read config file: {}", e))?;
    import_config_content(&file_path, &content)
}

#[tauri::command]
pub async fn import_config_url(url: String) -> Result<ImportResult, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Profile URL is empty".to_string());
    }

    let response = reqwest::Client::builder()
        .user_agent("SingBox Client/0.1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Profile URL returned HTTP {}", response.status()));
    }

    let content = response
        .text()
        .await
        .map_err(|e| format!("Failed to read profile response: {}", e))?;
    import_config_content(url, &content)
}

#[tauri::command]
pub async fn validate_import_file(file_path: String) -> Result<ImportValidationReport, String> {
    let content =
        fs::read_to_string(&file_path).map_err(|e| format!("Failed to read config file: {}", e))?;
    validate_import_content(&file_path, &content)
}

#[tauri::command]
pub async fn validate_import_url(url: String) -> Result<ImportValidationReport, String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Profile URL is empty".to_string());
    }

    let response = reqwest::Client::builder()
        .user_agent("SingBox Client/0.1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch profile URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Profile URL returned HTTP {}", response.status()));
    }

    let content = response
        .text()
        .await
        .map_err(|e| format!("Failed to read profile response: {}", e))?;
    validate_import_content(url, &content)
}

fn import_config_content(source_path: &str, content: &str) -> Result<ImportResult, String> {
    let config = parse_profile_config_content(content)?;

    // Sanitize config for sing-box 1.12.0 compatibility
    let config = sanitize_config_for_v1_12(config);
    let settings = load_app_settings().unwrap_or_else(|_| infer_settings_from_config(&config));
    let config = apply_app_settings_to_config(config, &settings);

    let profile = save_imported_config_profile(source_path, &config)?;
    activate_config_profile_internal(&profile.id)
}

fn validate_import_content(
    source_path: &str,
    content: &str,
) -> Result<ImportValidationReport, String> {
    let config = parse_profile_config_content(content)?;
    let nodes = extract_nodes_from_config(&config);
    let profiles = extract_profiles(&config);
    let has_tun = config
        .get("inbounds")
        .and_then(|value| value.as_array())
        .map(|inbounds| {
            inbounds
                .iter()
                .any(|inbound| inbound.get("type").and_then(|value| value.as_str()) == Some("tun"))
        })
        .unwrap_or(false);
    let mut warnings = Vec::new();

    if nodes.is_empty() {
        warnings.push("No direct proxy nodes were extracted from this profile".to_string());
    }

    if profiles.is_empty() {
        warnings.push("No selector/urltest groups were found in this profile".to_string());
    }

    if config.get("outbounds").and_then(|value| value.as_array()).is_none() {
        warnings.push("The profile has no outbounds array".to_string());
    }

    if has_tun {
        warnings.push("TUN inbound detected. Starting this profile will require UAC elevation on Windows".to_string());
    }

    Ok(ImportValidationReport {
        source_kind: profile_source_kind(source_path).to_string(),
        display_name: derive_config_profile_name(source_path),
        node_count: nodes.len(),
        group_count: profiles.len(),
        has_tun,
        warnings,
    })
}

fn parse_profile_config_content(content: &str) -> Result<serde_json::Value, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("Profile content is empty".to_string());
    }

    if let Ok(config) = serde_json::from_str::<serde_json::Value>(trimmed) {
        return Ok(config);
    }

    use base64::Engine as _;
    let compact = trimmed.lines().map(str::trim).collect::<Vec<_>>().join("");
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(compact.as_bytes())
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(compact.as_bytes()))
        .or_else(|_| base64::engine::general_purpose::STANDARD_NO_PAD.decode(compact.as_bytes()))
        .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(compact.as_bytes()))
        .map_err(|_| {
            "Profile must be a sing-box JSON config, or base64-encoded sing-box JSON".to_string()
        })?;
    let decoded_text = String::from_utf8(decoded)
        .map_err(|_| "Base64 profile is not valid UTF-8 text".to_string())?;

    serde_json::from_str::<serde_json::Value>(decoded_text.trim())
        .map_err(|e| format!("Failed to parse profile JSON: {}", e))
}

/// Get the current loaded config overview
#[tauri::command]
pub async fn get_config_overview() -> Result<Option<ConfigOverview>, String> {
    if let Some((display_path, config)) = load_active_profile_overview_source()? {
        return Ok(Some(parse_config_overview(&display_path, &config)));
    }

    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;

    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(Some(parse_config_overview(
        &config_path.to_string_lossy(),
        &config,
    )))
}

/// Get the current client settings or infer them from config/defaults
#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettings, String> {
    if let Ok(mut settings) = load_app_settings() {
        settings.autostart_enabled = is_autostart_enabled().unwrap_or(settings.autostart_enabled);
        return Ok(settings);
    }

    let config_path = crate::app_paths::runtime_config_path();
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        let mut settings = infer_settings_from_config(&config);
        settings.autostart_enabled = is_autostart_enabled().unwrap_or(false);
        return Ok(settings);
    }

    let mut settings = default_app_settings();
    settings.autostart_enabled = is_autostart_enabled().unwrap_or(false);
    Ok(settings)
}

#[tauri::command]
pub async fn get_singbox_core_version() -> Result<String, String> {
    let binary = crate::core_process::find_singbox_binary()?;
    let mut command = crate::core_process::hidden_command(&binary);
    let output = crate::core_process::apply_deprecated_envs(&mut command)
        .arg("version")
        .output()
        .map_err(|e| format!("Failed to query sing-box version: {}", e))?;
    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if text.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Ok(if stderr.is_empty() {
            "Unknown".to_string()
        } else {
            stderr
        });
    }
    Ok(text.lines().next().unwrap_or("Unknown").to_string())
}

/// Save client settings and re-apply them to the current config if one exists
#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    save_app_settings_file(&settings)?;
    sync_autostart(settings.autostart_enabled)?;

    let config_path = crate::app_paths::runtime_config_path();
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
        let updated = apply_app_settings_to_config(config, &settings);
        let updated_content = serde_json::to_string_pretty(&updated)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;
        fs::write(&config_path, updated_content)
            .map_err(|e| format!("Failed to save config: {}", e))?;
        persist_active_profile_config(&updated)?;
    }

    Ok(settings)
}

#[tauri::command]
pub async fn get_rule_sets_json() -> Result<Vec<serde_json::Value>, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config
        .get("route")
        .and_then(|route| route.get("rule_set"))
        .and_then(|rule_sets| rule_sets.as_array())
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_route_rules_json() -> Result<Vec<serde_json::Value>, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config
        .get("route")
        .and_then(|route| route.get("rules"))
        .and_then(|rules| rules.as_array())
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn save_route_rules_json(rules: Vec<serde_json::Value>) -> Result<String, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Err("No active config profile is loaded".to_string());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    if config
        .get("route")
        .and_then(|route| route.as_object())
        .is_none()
    {
        config["route"] = serde_json::json!({});
    }

    if let Some(route) = config
        .get_mut("route")
        .and_then(|route| route.as_object_mut())
    {
        route.insert("rules".to_string(), serde_json::Value::Array(rules));
    }

    let updated_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, updated_content)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    persist_active_profile_config(&config)?;

    Ok("Route rules saved".to_string())
}

#[tauri::command]
pub async fn save_rule_sets_json(rule_sets: Vec<serde_json::Value>) -> Result<String, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Err("No active config profile is loaded".to_string());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    if config
        .get("route")
        .and_then(|route| route.as_object())
        .is_none()
    {
        config["route"] = serde_json::json!({});
    }

    if let Some(route) = config
        .get_mut("route")
        .and_then(|route| route.as_object_mut())
    {
        route.insert("rule_set".to_string(), serde_json::Value::Array(rule_sets));
    }

    let updated_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, updated_content)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    persist_active_profile_config(&config)?;

    Ok("Rule sets saved".to_string())
}

/// List saved imported config profiles
#[tauri::command]
pub async fn get_config_profiles() -> Result<Vec<ConfigProfile>, String> {
    load_config_profiles()
}

/// Get the active imported config profile id
#[tauri::command]
pub async fn get_active_config_profile() -> Result<String, String> {
    Ok(load_active_config_profile_id().unwrap_or_default())
}

/// Switch the active imported config profile
#[tauri::command]
pub async fn switch_config_profile(profile_id: String) -> Result<ImportResult, String> {
    let running = crate::core_process::is_singbox_running().unwrap_or(false);
    activate_config_profile_internal_with_options(&profile_id, !running)
}

#[tauri::command]
pub async fn sync_active_profile_to_runtime() -> Result<ImportResult, String> {
    let active_profile_id = load_active_config_profile_id()?;
    if active_profile_id.trim().is_empty() {
        return Err("No active config profile is loaded".to_string());
    }

    activate_config_profile_internal_with_options(&active_profile_id, true)
}

#[tauri::command]
pub async fn refresh_config_profile(profile_id: String) -> Result<ImportResult, String> {
    let mut profiles = load_config_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    if !profile.refreshable || profile_source_kind(&profile.source_path) != "url" {
        return Err("Only URL-based profiles can be refreshed".to_string());
    }

    let response = reqwest::Client::builder()
        .user_agent("SingBox Client/0.1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?
        .get(profile.source_path.trim())
        .send()
        .await
        .map_err(|e| format!("Failed to refresh profile URL: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Profile URL returned HTTP {}", response.status()));
    }

    let content = response
        .text()
        .await
        .map_err(|e| format!("Failed to read refreshed profile response: {}", e))?;
    let config = parse_profile_config_content(&content)?;
    let config = sanitize_config_for_v1_12(config);
    let settings = load_app_settings().unwrap_or_else(|_| infer_settings_from_config(&config));
    let config = apply_app_settings_to_config(config, &settings);

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    let serialized = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize refreshed profile: {}", e))?;
    fs::write(&profile_path, serialized)
        .map_err(|e| format!("Failed to save refreshed profile: {}", e))?;

    profile.name = derive_config_profile_name(&profile.source_path);
    profile.source_kind = profile_source_kind(&profile.source_path).to_string();
    profile.refreshable = true;
    profile.updated_at = current_unix_timestamp();
    save_config_profiles(&profiles)?;

    let running = crate::core_process::is_singbox_running().unwrap_or(false);
    activate_config_profile_internal_with_options(&profile_id, !running)
}

/// Delete a saved imported config profile
#[tauri::command]
pub async fn delete_config_profile(profile_id: String) -> Result<String, String> {
    let mut profiles = load_config_profiles()?;
    let index = profiles
        .iter()
        .position(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;
    let removed = profiles.remove(index);

    let profile_path = get_config_profiles_dir().join(format!("{}.json", removed.id));
    if profile_path.exists() {
        fs::remove_file(&profile_path)
            .map_err(|e| format!("Failed to remove profile file: {}", e))?;
    }

    save_config_profiles(&profiles)?;

    let active_profile_id = load_active_config_profile_id().unwrap_or_default();
    if active_profile_id == removed.id {
        if let Some(next_profile) = profiles.first() {
            activate_config_profile_internal(&next_profile.id)?;
        } else {
            clear_runtime_config_files()?;
            save_active_config_profile_id("")?;
        }
    }

    Ok(removed.id)
}

#[tauri::command]
pub async fn rename_config_profile(profile_id: String, new_name: String) -> Result<ConfigProfile, String> {
    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err("Profile name cannot be empty".to_string());
    }

    let mut profiles = load_config_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    profile.name = trimmed.to_string();
    profile.updated_at = current_unix_timestamp();
    let updated = profile.clone();
    save_config_profiles(&profiles)?;

    Ok(updated)
}

#[tauri::command]
pub async fn get_config_profile_json(profile_id: String) -> Result<serde_json::Value, String> {
    let profiles = load_config_profiles()?;
    let profile = profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    let content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read saved profile config: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse saved profile config: {}", e))
}

#[tauri::command]
pub async fn save_config_profile_json(
    profile_id: String,
    config: serde_json::Value,
) -> Result<String, String> {
    let mut profiles = load_config_profiles()?;
    let profile = profiles
        .iter_mut()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    let config = sanitize_config_for_v1_12(config);
    let settings = load_app_settings().unwrap_or_else(|_| infer_settings_from_config(&config));
    let config = apply_app_settings_to_config(config, &settings);

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize saved profile config: {}", e))?;
    fs::write(&profile_path, content)
        .map_err(|e| format!("Failed to save profile config: {}", e))?;

    profile.updated_at = current_unix_timestamp();
    save_config_profiles(&profiles)?;

    let active_profile_id = load_active_config_profile_id().unwrap_or_default();
    if active_profile_id == profile_id {
        let running = crate::core_process::is_singbox_running().unwrap_or(false);
        activate_config_profile_internal_with_options(&profile_id, !running)?;
    }

    Ok("Profile saved".to_string())
}

/// Get saved profiles
#[tauri::command]
pub async fn get_profiles() -> Result<Vec<Profile>, String> {
    let path = crate::app_paths::profiles_file_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read profiles: {}", e))?;
    serde_json::from_str(&content).map_err(|e| format!("Failed to parse profiles: {}", e))
}

/// Get the currently selected outbound tag from the imported config
#[tauri::command]
pub async fn get_active_outbound() -> Result<String, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Ok(String::new());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let nodes = extract_nodes_from_config(&config);
    Ok(determine_active_outbound(&profiles, &nodes))
}

#[tauri::command]
pub async fn get_runtime_debug_snapshot() -> Result<RuntimeDebugSnapshot, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Ok(RuntimeDebugSnapshot {
            route_final: String::new(),
            top_selector_tag: String::new(),
            top_selector_default: String::new(),
            active_leaf_outbound: String::new(),
        });
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let nodes = extract_nodes_from_config(&config);
    let top_selector = profiles
        .iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first());

    let active_leaf_outbound = detect_runtime_active_leaf_outbound(&config)
        .unwrap_or_else(|| determine_active_node(&profiles, &nodes));

    Ok(RuntimeDebugSnapshot {
        route_final: config
            .get("route")
            .and_then(|route| route.get("final"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string(),
        top_selector_tag: top_selector
            .map(|item| item.tag.clone())
            .unwrap_or_default(),
        top_selector_default: top_selector
            .map(|item| item.default_outbound.clone())
            .unwrap_or_default(),
        active_leaf_outbound,
    })
}

#[tauri::command]
pub async fn get_core_runtime_info() -> Result<CoreRuntimeInfo, String> {
    let binary_path = crate::core_process::find_singbox_binary().unwrap_or_default();
    let state = crate::core_process::load_core_state().ok().flatten();
    let running = crate::core_process::is_singbox_running().unwrap_or(false);

    Ok(CoreRuntimeInfo {
        binary_path: state
            .as_ref()
            .map(|item| item.binary_path.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or(binary_path),
        config_path: state
            .as_ref()
            .map(|item| item.config_path.clone())
            .unwrap_or_else(|| crate::app_paths::runtime_config_path().to_string_lossy().to_string()),
        log_path: state
            .as_ref()
            .map(|item| item.log_path.clone())
            .unwrap_or_else(|| crate::app_paths::runtime_log_path().to_string_lossy().to_string()),
        pid: state.as_ref().and_then(|item| item.pid),
        running,
        tun_enabled: state.as_ref().map(|item| item.tun_enabled).unwrap_or(false),
    })
}

/// Set the active outbound selection in the imported config by updating selector defaults
#[tauri::command]
pub async fn set_active_outbound(target_tag: String) -> Result<String, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Err("No imported config is loaded".to_string());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;
    apply_outbound_selection(&mut config, &target_tag)?;
    persist_outbound_selection(&config)?;
    let updated_profiles = extract_profiles(&config);
    let updated_nodes = extract_nodes_from_config(&config);
    Ok(determine_active_outbound(&updated_profiles, &updated_nodes))
}

#[tauri::command]
pub async fn switch_runtime_outbound(
    request: RuntimeOutboundSwitchRequest,
) -> Result<RuntimeOutboundSwitchResult, String> {
    let _switch_guard = OUTBOUND_SWITCH_LOCK.lock().await;
    let requested_tag = request.target_tag.trim().to_string();
    if requested_tag.is_empty() {
        return Err("No outbound target was provided".to_string());
    }

    let (mut config, profile_id) = load_outbound_selection_config()?;
    let plan = apply_outbound_selection(&mut config, &requested_tag)?;
    let running = crate::core_process::is_singbox_running().unwrap_or(false);
    if !running {
        persist_outbound_selection(&config)?;
        return Ok(RuntimeOutboundSwitchResult {
            requested_tag,
            active_tag: plan.active_tag,
            switched_live: false,
            closed_connections: 0,
            warnings: Vec::new(),
        });
    }

    let state = crate::core_process::load_core_state()?
        .ok_or("The sing-box runtime state is unavailable".to_string())?;
    if state.clash_api_url.trim().is_empty() {
        return Err("Runtime switching is unavailable; reconnect once to initialize the local API"
            .to_string());
    }
    if !state.profile_id.is_empty() && state.profile_id != profile_id {
        return Err("The running core belongs to a different profile".to_string());
    }

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(1))
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to create runtime API client: {}", e))?;
    let selector_tags: std::collections::HashSet<String> = plan
        .selector_path
        .iter()
        .map(|(selector, _)| selector.clone())
        .collect();
    let mut warnings = Vec::new();
    let affected_connections = if request.close_affected_connections && !selector_tags.is_empty() {
        match get_affected_connection_ids(
            &client,
            &state.clash_api_url,
            &state.clash_api_secret,
            &selector_tags,
        )
        .await
        {
            Ok(ids) => ids,
            Err(error) => {
                warnings.push(format!("Could not inspect existing connections: {}", error));
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    switch_selector_path_via_api(
        &client,
        &state.clash_api_url,
        &state.clash_api_secret,
        &plan.selector_path,
    )
    .await?;

    match persist_outbound_selection(&config) {
        Ok(config_fingerprint) => {
            if let Err(error) = crate::core_process::update_core_config_fingerprint(
                &profile_id,
                &config_fingerprint,
            ) {
                warnings.push(format!("Selection was saved but runtime metadata was not updated: {}", error));
            }
        }
        Err(error) => warnings.push(format!(
            "Runtime switched successfully, but the selection could not be saved: {}",
            error
        )),
    }

    let mut connection_tasks = tokio::task::JoinSet::new();
    for connection_id in affected_connections {
        let client = client.clone();
        let base_url = state.clash_api_url.clone();
        let secret = state.clash_api_secret.clone();
        connection_tasks.spawn(async move {
            let result =
                delete_runtime_connection(&client, &base_url, &secret, &connection_id).await;
            (connection_id, result)
        });
    }
    let mut closed_connections = 0;
    while let Some(joined) = connection_tasks.join_next().await {
        match joined {
            Ok((_, Ok(()))) => closed_connections += 1,
            Ok((connection_id, Err(error))) => warnings.push(format!(
                "Connection '{}' could not be closed: {}",
                connection_id, error
            )),
            Err(error) => warnings.push(format!("A connection cleanup task failed: {}", error)),
        }
    }

    Ok(RuntimeOutboundSwitchResult {
        requested_tag,
        active_tag: plan.active_tag,
        switched_live: true,
        closed_connections,
        warnings,
    })
}

/// Remove an outbound group from the imported config and refresh saved profiles/nodes
#[tauri::command]
pub async fn remove_group(group_tag: String) -> Result<String, String> {
    let config_path = crate::app_paths::runtime_config_path();
    if !config_path.exists() {
        return Err("No imported config is loaded".to_string());
    }

    let content =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let profile = profiles
        .iter()
        .find(|p| p.tag == group_tag)
        .ok_or_else(|| format!("Group '{}' not found", group_tag))?;

    if profile.profile_type != "selector" && profile.profile_type != "urltest" {
        return Err(format!("Outbound '{}' is not a removable group", group_tag));
    }

    let top_selector = profiles
        .iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first());
    if top_selector.map(|p| p.tag.as_str()) == Some(group_tag.as_str()) {
        return Err("Cannot delete the top-level active group".to_string());
    }

    let outbounds = config
        .get_mut("outbounds")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config has no outbounds array".to_string())?;

    let original_len = outbounds.len();
    outbounds.retain(|outbound| {
        outbound.get("tag").and_then(|v| v.as_str()) != Some(group_tag.as_str())
    });
    if outbounds.len() == original_len {
        return Err(format!("Group '{}' not found in outbounds", group_tag));
    }

    let fallback_tag = outbounds
        .iter()
        .find_map(|outbound| {
            let outbound_type = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let tag = outbound.get("tag").and_then(|v| v.as_str()).unwrap_or("");
            if tag.is_empty()
                || tag == group_tag
                || outbound_type == "direct"
                || outbound_type == "block"
                || outbound_type == "dns"
            {
                None
            } else {
                Some(tag.to_string())
            }
        })
        .unwrap_or_else(|| "direct".to_string());

    for outbound in outbounds.iter_mut() {
        if matches!(
            outbound.get("type").and_then(|v| v.as_str()),
            Some("selector" | "urltest")
        ) {
            if let Some(members) = outbound.get_mut("outbounds").and_then(|v| v.as_array_mut()) {
                members.retain(|member| member.as_str() != Some(group_tag.as_str()));
            }
            let default_is_deleted =
                outbound.get("default").and_then(|v| v.as_str()) == Some(group_tag.as_str());
            if default_is_deleted {
                let replacement = outbound
                    .get("outbounds")
                    .and_then(|v| v.as_array())
                    .and_then(|members| {
                        members
                            .iter()
                            .find_map(|member| member.as_str().map(String::from))
                    })
                    .unwrap_or_else(|| fallback_tag.clone());
                if let Some(obj) = outbound.as_object_mut() {
                    obj.insert(
                        "default".to_string(),
                        serde_json::Value::String(replacement),
                    );
                }
            }
        }
    }

    if let Some(route) = config.get_mut("route").and_then(|v| v.as_object_mut()) {
        if route.get("final").and_then(|v| v.as_str()) == Some(group_tag.as_str()) {
            route.insert(
                "final".to_string(),
                serde_json::Value::String(fallback_tag.clone()),
            );
        }
    }

    if let Some(dns) = config.get_mut("dns").and_then(|v| v.as_object_mut()) {
        if dns.get("final").and_then(|v| v.as_str()) == Some(group_tag.as_str()) {
            dns.insert(
                "final".to_string(),
                serde_json::Value::String(fallback_tag.clone()),
            );
        }
    }

    let updated_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, updated_content)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    persist_active_profile_config(&config)?;

    let updated_nodes = extract_nodes_from_config(&config);
    let updated_profiles = extract_profiles(&config);
    save_nodes(&updated_nodes)?;
    save_profiles(&updated_profiles)?;

    Ok(group_tag)
}

/// Extract proxy nodes from sing-box outbounds array
fn extract_nodes_from_config(config: &serde_json::Value) -> Vec<ProxyNode> {
    config
        .get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|outbound| {
                    let otype = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    !SPECIAL_OUTBOUND_TYPES.contains(&otype)
                })
                .map(|outbound| {
                    let node_type = outbound
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tag = outbound
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unnamed")
                        .to_string();
                    let server = outbound
                        .get("server")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let port = outbound
                        .get("server_port")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u16;

                    // Collect all protocol-specific settings (everything except type/tag/server/server_port)
                    let mut settings = serde_json::Map::new();
                    if let serde_json::Value::Object(obj) = outbound {
                        for (key, value) in obj {
                            if !["type", "tag", "server", "server_port"].contains(&key.as_str()) {
                                settings.insert(key.clone(), value.clone());
                            }
                        }
                    }

                    ProxyNode {
                        id: tag.clone(), // Use tag as ID for easy reference by profiles
                        name: tag,
                        node_type,
                        server,
                        port,
                        settings: serde_json::Value::Object(settings),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Extract selector/urltest profiles from outbounds
fn extract_profiles(config: &serde_json::Value) -> Vec<Profile> {
    config
        .get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|outbound| {
                    let otype = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    otype == "selector" || otype == "urltest"
                })
                .map(|outbound| {
                    let profile_type = outbound
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tag = outbound
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let outbounds = outbound
                        .get("outbounds")
                        .and_then(|v| v.as_array())
                        .map(|members| {
                            members
                                .iter()
                                .filter_map(|m| m.as_str().map(String::from))
                                .collect()
                        })
                        .unwrap_or_default();
                    let default_outbound = outbound
                        .get("default")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let interval = outbound
                        .get("interval")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tolerance = outbound
                        .get("tolerance")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    Profile {
                        tag,
                        profile_type,
                        outbounds,
                        default_outbound,
                        interval,
                        tolerance,
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Determine which node should be active based on profile hierarchy
/// Logic: find the top-level selector -> get its default -> if default is another group, recurse
fn determine_active_node(profiles: &[Profile], nodes: &[ProxyNode]) -> String {
    // Find the top-level selector (usually tagged "proxy")
    let top_selector = profiles
        .iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first());

    if let Some(selector) = top_selector {
        let default = if !selector.default_outbound.is_empty() {
            &selector.default_outbound
        } else {
            selector.outbounds.first().map(|s| s.as_str()).unwrap_or("")
        };

        // Check if default points to another profile (e.g., "auto" urltest)
        if let Some(sub_profile) = profiles.iter().find(|p| p.tag == default) {
            // For urltest, the first outbound is typically the "best"
            // At runtime sing-box will auto-select, but we show the first as default
            return sub_profile
                .outbounds
                .first()
                .filter(|tag| nodes.iter().any(|n| n.id == **tag))
                .cloned()
                .unwrap_or_default();
        }

        // Default points directly to a node
        if nodes.iter().any(|n| n.id == default) {
            return default.to_string();
        }
    }

    // Fallback: first node
    nodes.first().map(|n| n.id.clone()).unwrap_or_default()
}

fn determine_active_outbound(profiles: &[Profile], nodes: &[ProxyNode]) -> String {
    let top_selector = profiles
        .iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first());

    if let Some(selector) = top_selector {
        let default = if !selector.default_outbound.is_empty() {
            &selector.default_outbound
        } else {
            selector.outbounds.first().map(|s| s.as_str()).unwrap_or("")
        };

        if !default.is_empty() {
            return default.to_string();
        }
    }

    nodes.first().map(|n| n.id.clone()).unwrap_or_default()
}

fn detect_runtime_active_leaf_outbound(config: &serde_json::Value) -> Option<String> {
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
            .and_then(|members| members.iter().find_map(|member| member.as_str().map(str::to_string)))
    })?;

    resolve_runtime_concrete_outbound_tag(outbounds, &candidate)
}

fn resolve_runtime_concrete_outbound_tag(
    outbounds: &[serde_json::Value],
    candidate: &str,
) -> Option<String> {
    let mut current = candidate.to_string();
    let mut visited = std::collections::HashSet::new();

    loop {
        if !visited.insert(current.clone()) {
            return Some(current);
        }

        let outbound = outbounds.iter().find(|item| {
            item.get("tag").and_then(|value| value.as_str()) == Some(current.as_str())
        })?;

        let outbound_type = outbound
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        if outbound_type == "urltest" {
            return Some(current);
        }
        if outbound_type != "selector" {
            return Some(current);
        }

        if let Some(default) = outbound
            .get("default")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
        {
            current = default.to_string();
            continue;
        }

        if let Some(first_member) = outbound
            .get("outbounds")
            .and_then(|value| value.as_array())
            .and_then(|members| members.iter().find_map(|member| member.as_str()))
        {
            current = first_member.to_string();
            continue;
        }

        return Some(current);
    }
}

fn resolve_profile_leaf_target(
    target_tag: &str,
    profiles: &[Profile],
    nodes: &[ProxyNode],
) -> Option<String> {
    let profile = profiles.iter().find(|profile| profile.tag == target_tag)?;

    if profile.profile_type == "urltest" {
        return Some(target_tag.to_string());
    }

    let default = if !profile.default_outbound.is_empty() {
        profile.default_outbound.as_str()
    } else {
        profile
            .outbounds
            .first()
            .map(|item| item.as_str())
            .unwrap_or("")
    };

    if default.is_empty() {
        return None;
    }

    if nodes.iter().any(|node| node.id == default) {
        return Some(default.to_string());
    }

    resolve_profile_leaf_target(default, profiles, nodes)
}

fn load_outbound_selection_config() -> Result<(serde_json::Value, String), String> {
    let active_profile_id = load_active_config_profile_id().unwrap_or_default();
    let (path, profile_id) = if active_profile_id.is_empty() {
        (
            crate::app_paths::runtime_config_path(),
            "__manual__".to_string(),
        )
    } else {
        (
            get_config_profiles_dir().join(format!("{}.json", active_profile_id)),
            active_profile_id,
        )
    };
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config for outbound selection: {}", e))?;
    let config = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config for outbound selection: {}", e))?;
    Ok((config, profile_id))
}

fn apply_outbound_selection(
    config: &mut serde_json::Value,
    target_tag: &str,
) -> Result<OutboundSelectionPlan, String> {
    let profiles = extract_profiles(config);
    let nodes = extract_nodes_from_config(config);
    if !profiles.iter().any(|profile| profile.tag == target_tag)
        && !nodes.iter().any(|node| node.id == target_tag)
    {
        return Err(format!(
            "Outbound '{}' not found in current config",
            target_tag
        ));
    }

    let top_selector = profiles
        .iter()
        .find(|profile| profile.profile_type == "selector")
        .or_else(|| profiles.first())
        .ok_or("No outbound groups found in current config".to_string())?;
    let effective_target = if profiles.iter().any(|profile| profile.tag == target_tag) {
        resolve_profile_leaf_target(target_tag, &profiles, &nodes)
            .unwrap_or_else(|| target_tag.to_string())
    } else {
        target_tag.to_string()
    };

    let selector_path = if effective_target == top_selector.tag {
        Vec::new()
    } else {
        build_selector_path(&top_selector.tag, &effective_target, &profiles).ok_or_else(|| {
            format!(
                "Outbound '{}' is not reachable from selector '{}'",
                target_tag, top_selector.tag
            )
        })?
    };
    apply_selector_path(config, &selector_path)?;
    let active_tag = detect_runtime_active_leaf_outbound(config)
        .unwrap_or_else(|| effective_target.clone());
    Ok(OutboundSelectionPlan {
        selector_path,
        active_tag,
    })
}

fn persist_outbound_selection(config: &serde_json::Value) -> Result<String, String> {
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(crate::app_paths::runtime_config_path(), &content)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    persist_active_profile_config(config)?;
    save_profiles(&extract_profiles(config))?;
    Ok(super::latency::config_fingerprint(&content))
}

fn runtime_api_auth(
    request: reqwest::RequestBuilder,
    secret: &str,
) -> reqwest::RequestBuilder {
    if secret.is_empty() {
        request
    } else {
        request.bearer_auth(secret)
    }
}

async fn get_runtime_selector_now(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    selector: &str,
) -> Result<String, String> {
    let encoded = percent_encoding::utf8_percent_encode(
        selector,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let response = runtime_api_auth(
        client.get(format!(
            "{}/proxies/{}",
            base_url.trim_end_matches('/'),
            encoded
        )),
        secret,
    )
    .send()
    .await
    .map_err(|e| format!("Selector '{}' could not be read: {}", selector, e))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Selector '{}' returned HTTP {}: {}",
            selector,
            status,
            body.trim()
        ));
    }
    let value: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Selector '{}' returned invalid JSON: {}", selector, e))?;
    value
        .get("now")
        .and_then(|item| item.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("Selector '{}' did not report an active outbound", selector))
}

async fn put_runtime_selector(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    selector: &str,
    target: &str,
) -> Result<(), String> {
    let encoded = percent_encoding::utf8_percent_encode(
        selector,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let response = runtime_api_auth(
        client
            .put(format!(
                "{}/proxies/{}",
                base_url.trim_end_matches('/'),
                encoded
            ))
            .json(&serde_json::json!({ "name": target })),
        secret,
    )
    .send()
    .await
    .map_err(|e| format!("Failed to switch selector '{}': {}", selector, e))?;
    let status = response.status();
    if status.is_success() {
        Ok(())
    } else {
        let body = response.text().await.unwrap_or_default();
        Err(format!(
            "Selector '{}' returned HTTP {}: {}",
            selector,
            status,
            body.trim()
        ))
    }
}

async fn rollback_runtime_selectors(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    applied: &[String],
    previous: &std::collections::HashMap<String, String>,
) {
    for selector in applied.iter().rev() {
        if let Some(target) = previous.get(selector) {
            let _ = put_runtime_selector(client, base_url, secret, selector, target).await;
        }
    }
}

async fn switch_selector_path_via_api(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    path: &[(String, String)],
) -> Result<(), String> {
    let mut previous = std::collections::HashMap::new();
    for (selector, _) in path {
        previous.insert(
            selector.clone(),
            get_runtime_selector_now(client, base_url, secret, selector).await?,
        );
    }

    let mut applied = Vec::new();
    for (selector, target) in path.iter().rev() {
        if let Err(error) = put_runtime_selector(client, base_url, secret, selector, target).await {
            rollback_runtime_selectors(client, base_url, secret, &applied, &previous).await;
            return Err(error);
        }
        applied.push(selector.clone());
        match get_runtime_selector_now(client, base_url, secret, selector).await {
            Ok(active) if active == *target => {}
            Ok(active) => {
                rollback_runtime_selectors(client, base_url, secret, &applied, &previous).await;
                return Err(format!(
                    "Selector '{}' remained on '{}' instead of '{}'",
                    selector, active, target
                ));
            }
            Err(error) => {
                rollback_runtime_selectors(client, base_url, secret, &applied, &previous).await;
                return Err(error);
            }
        }
    }
    Ok(())
}

fn affected_connection_ids(
    payload: &serde_json::Value,
    selector_tags: &std::collections::HashSet<String>,
) -> Vec<String> {
    payload
        .get("connections")
        .and_then(|value| value.as_array())
        .into_iter()
        .flatten()
        .filter(|connection| {
            connection
                .get("chains")
                .and_then(|value| value.as_array())
                .map(|chains| {
                    chains.iter().any(|chain| {
                        chain
                            .as_str()
                            .map(|tag| selector_tags.contains(tag))
                            .unwrap_or(false)
                    })
                })
                .unwrap_or(false)
        })
        .filter_map(|connection| {
            connection
                .get("id")
                .and_then(|value| value.as_str())
                .map(str::to_string)
        })
        .collect()
}

async fn get_affected_connection_ids(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    selector_tags: &std::collections::HashSet<String>,
) -> Result<Vec<String>, String> {
    let response = runtime_api_auth(
        client.get(format!(
            "{}/connections",
            base_url.trim_end_matches('/')
        )),
        secret,
    )
    .send()
    .await
    .map_err(|e| format!("Failed to read runtime connections: {}", e))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status, body.trim()));
    }
    let payload = serde_json::from_str(&body)
        .map_err(|e| format!("Runtime connections returned invalid JSON: {}", e))?;
    Ok(affected_connection_ids(&payload, selector_tags))
}

async fn delete_runtime_connection(
    client: &reqwest::Client,
    base_url: &str,
    secret: &str,
    connection_id: &str,
) -> Result<(), String> {
    let encoded = percent_encoding::utf8_percent_encode(
        connection_id,
        percent_encoding::NON_ALPHANUMERIC,
    );
    let response = runtime_api_auth(
        client.delete(format!(
            "{}/connections/{}",
            base_url.trim_end_matches('/'),
            encoded
        )),
        secret,
    )
    .send()
    .await
    .map_err(|e| format!("Failed to close connection: {}", e))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("HTTP {}", response.status()))
    }
}

fn build_selector_path(
    root_tag: &str,
    target_tag: &str,
    profiles: &[Profile],
) -> Option<Vec<(String, String)>> {
    let profile = profiles.iter().find(|p| p.tag == root_tag)?;

    for outbound in &profile.outbounds {
        if outbound == target_tag {
            return Some(vec![(root_tag.to_string(), target_tag.to_string())]);
        }
    }

    for outbound in &profile.outbounds {
        if let Some(child_profile) = profiles.iter().find(|p| p.tag == *outbound) {
            if child_profile.profile_type == "selector" {
                if let Some(mut child_path) =
                    build_selector_path(&child_profile.tag, target_tag, profiles)
                {
                    let mut path = vec![(root_tag.to_string(), child_profile.tag.clone())];
                    path.append(&mut child_path);
                    return Some(path);
                }
            } else if child_profile.profile_type == "urltest"
                && (child_profile.tag == target_tag
                    || child_profile
                        .outbounds
                        .iter()
                        .any(|member| member == target_tag))
            {
                return Some(vec![(root_tag.to_string(), child_profile.tag.clone())]);
            }
        }
    }

    None
}

fn apply_selector_path(
    config: &mut serde_json::Value,
    path: &[(String, String)],
) -> Result<(), String> {
    for (selector_tag, next_tag) in path {
        set_selector_default(config, selector_tag, next_tag)?;
    }

    Ok(())
}

fn set_selector_default(
    config: &mut serde_json::Value,
    selector_tag: &str,
    next_tag: &str,
) -> Result<(), String> {
    let outbounds = config
        .get_mut("outbounds")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config has no outbounds array".to_string())?;

    let outbound = outbounds
        .iter_mut()
        .find(|outbound| outbound.get("tag").and_then(|v| v.as_str()) == Some(selector_tag))
        .ok_or_else(|| format!("Selector '{}' not found in config", selector_tag))?;

    if outbound.get("type").and_then(|v| v.as_str()) != Some("selector") {
        return Ok(());
    }

    let members = outbound
        .get("outbounds")
        .and_then(|v| v.as_array())
        .ok_or_else(|| format!("Selector '{}' has no outbounds", selector_tag))?;
    let contains_target = members
        .iter()
        .any(|member| member.as_str() == Some(next_tag));
    if !contains_target {
        return Err(format!(
            "Selector '{}' does not contain '{}'",
            selector_tag, next_tag
        ));
    }

    if let Some(obj) = outbound.as_object_mut() {
        obj.insert(
            "default".to_string(),
            serde_json::Value::String(next_tag.to_string()),
        );
    }

    Ok(())
}

/// Get all configured nodes
#[tauri::command]
pub async fn get_nodes() -> Result<Vec<ProxyNode>, String> {
    let nodes_path = get_nodes_file_path();
    if !std::path::Path::new(&nodes_path).exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&nodes_path).map_err(|e| format!("Failed to read nodes: {}", e))?;

    let nodes: Vec<ProxyNode> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse nodes: {}", e))?;

    Ok(nodes)
}

/// Add a new proxy node
#[tauri::command]
pub async fn add_node(
    name: String,
    node_type: String,
    server: String,
    port: u16,
    settings: serde_json::Value,
) -> Result<ProxyNode, String> {
    let mut nodes = get_nodes().await.unwrap_or_default();

    let node = ProxyNode {
        id: Uuid::new_v4().to_string(),
        name,
        node_type,
        server,
        port,
        settings,
    };

    nodes.push(node.clone());
    save_nodes(&nodes)?;

    Ok(node)
}

/// Update an existing proxy node
#[tauri::command]
pub async fn update_node(
    id: String,
    name: String,
    node_type: String,
    server: String,
    port: u16,
    settings: serde_json::Value,
) -> Result<ProxyNode, String> {
    let mut nodes = get_nodes().await.unwrap_or_default();
    let node = nodes
        .iter_mut()
        .find(|node| node.id == id)
        .ok_or("Node not found".to_string())?;

    node.name = name;
    node.node_type = node_type;
    node.server = server;
    node.port = port;
    node.settings = settings;

    let updated = node.clone();
    save_nodes(&nodes)?;
    Ok(updated)
}

/// Remove a node by ID
#[tauri::command]
pub async fn remove_node(id: String) -> Result<String, String> {
    let mut nodes = get_nodes().await.unwrap_or_default();
    let original_len = nodes.len();
    nodes.retain(|n| n.id != id);

    if nodes.len() == original_len {
        return Err("Node not found".to_string());
    }

    save_nodes(&nodes)?;
    Ok("Node removed".to_string())
}

/// Generate sing-box configuration JSON from nodes (used when not using imported config)
#[tauri::command]
pub async fn generate_config(selected_node_id: String) -> Result<String, String> {
    // If we have an imported config, just use it directly
    let config_path = crate::app_paths::runtime_config_path();
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        return Ok(content);
    }

    // Otherwise generate a basic config from the selected node
    let nodes = get_nodes().await.unwrap_or_default();
    let selected = nodes
        .iter()
        .find(|n| n.id == selected_node_id)
        .ok_or("Selected node not found")?;

    let settings = load_app_settings().unwrap_or_else(|_| default_app_settings());
    let config = apply_app_settings_to_config(build_singbox_config(selected), &settings);
    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, &config_str).map_err(|e| format!("Failed to write config: {}", e))?;

    Ok(config_str)
}

/// Import nodes from subscription URL
#[tauri::command]
pub async fn import_subscription(url: String) -> Result<Vec<ProxyNode>, String> {
    Err(format!(
        "Subscription import from '{}' - requires HTTP client implementation (e.g., reqwest crate)",
        url
    ))
}

/// Check if an imported config exists (can start sing-box directly)
#[tauri::command]
pub async fn has_imported_config() -> Result<bool, String> {
    Ok(!load_active_config_profile_id()?.is_empty())
}

/// Clear all configuration: nodes, profiles, and imported config
#[tauri::command]
pub async fn clear_config() -> Result<String, String> {
    clear_runtime_config_files()?;

    let profiles_path = get_config_profiles_file_path();
    if profiles_path.exists() {
        fs::remove_file(&profiles_path)
            .map_err(|e| format!("Failed to remove config profiles: {}", e))?;
    }

    let active_profile_path = get_active_config_profile_file_path();
    if active_profile_path.exists() {
        fs::remove_file(&active_profile_path)
            .map_err(|e| format!("Failed to remove active profile marker: {}", e))?;
    }

    let profiles_dir = get_config_profiles_dir();
    if profiles_dir.exists() {
        fs::remove_dir_all(&profiles_dir)
            .map_err(|e| format!("Failed to remove saved profile directory: {}", e))?;
    }

    Ok("All imported profiles cleared".to_string())
}

#[tauri::command]
pub async fn get_startup_health_report() -> Result<StartupHealthReport, String> {
    let mut items = Vec::new();

    match crate::core_process::find_singbox_binary() {
        Ok(path) => items.push(StartupHealthItem {
            key: "core".to_string(),
            label: "Core binary".to_string(),
            status: "ok".to_string(),
            message: path,
        }),
        Err(err) => items.push(StartupHealthItem {
            key: "core".to_string(),
            label: "Core binary".to_string(),
            status: "error".to_string(),
            message: err,
        }),
    }

    let config_path = crate::app_paths::runtime_config_path();
    let has_runtime_config = config_path.exists();
    items.push(StartupHealthItem {
        key: "config".to_string(),
        label: "Runtime config".to_string(),
        status: if has_runtime_config { "ok" } else { "error" }.to_string(),
        message: if has_runtime_config {
            config_path.to_string_lossy().to_string()
        } else {
            "No imported or generated config is ready".to_string()
        },
    });

    if has_runtime_config {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read runtime config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse runtime config: {}", e))?;
        let (host, port) = get_mixed_inbound_endpoint_from_config(&config)?;
        let tun_enabled = config_has_tun_inbound_value(&config);
        let port_free = port_is_available(&host, port);
        let nodes = extract_nodes_from_config(&config);
        let groups = extract_profiles(&config);

        items.push(StartupHealthItem {
            key: "mixed_port".to_string(),
            label: "Mixed inbound".to_string(),
            status: if port_free { "ok" } else { "error" }.to_string(),
            message: if port_free {
                format!("{}:{} is available", host, port)
            } else {
                format!("{}:{} is already occupied", host, port)
            },
        });

        items.push(StartupHealthItem {
            key: "tun".to_string(),
            label: "TUN requirement".to_string(),
            status: if tun_enabled { "warn" } else { "ok" }.to_string(),
            message: if tun_enabled {
                "Active profile contains TUN inbound and will require UAC elevation".to_string()
            } else {
                "No TUN inbound in active runtime config".to_string()
            },
        });

        items.push(StartupHealthItem {
            key: "routing".to_string(),
            label: "Routing targets".to_string(),
            status: if nodes.is_empty() && groups.is_empty() {
                "error"
            } else {
                "ok"
            }
            .to_string(),
            message: if nodes.is_empty() && groups.is_empty() {
                "No selectable nodes or groups were extracted from the active profile".to_string()
            } else {
                format!("{} nodes, {} groups ready", nodes.len(), groups.len())
            },
        });
    }

    let ready = items.iter().all(|item| item.status != "error");
    Ok(StartupHealthReport { ready, items })
}

fn build_singbox_config(node: &ProxyNode) -> serde_json::Value {
    serde_json::json!({
        "log": { "level": "info", "timestamp": true },
        "inbounds": [{
            "type": "mixed",
            "tag": "mixed-in",
            "listen": "127.0.0.1",
            "listen_port": 7890
        }],
        "outbounds": [
            build_outbound(node),
            { "type": "direct", "tag": "direct" },
            { "type": "block", "tag": "block" }
        ],
        "dns": {
            "final": "google",
            "servers": default_dns_servers()
        },
        "route": {
            "default_domain_resolver": "local",
            "rules": [{ "geosite": ["cn"], "geoip": ["cn", "private"], "outbound": "direct" }],
            "final": "proxy"
        }
    })
}

fn build_outbound(node: &ProxyNode) -> serde_json::Value {
    let mut outbound = serde_json::json!({
        "type": node.node_type,
        "tag": "proxy",
        "server": node.server,
        "server_port": node.port,
    });

    if let serde_json::Value::Object(ref settings) = node.settings {
        if let serde_json::Value::Object(ref mut obj) = outbound {
            for (key, value) in settings {
                obj.insert(key.clone(), value.clone());
            }
        }
    }

    outbound
}

/// Parse a sing-box config into a structured overview
fn parse_config_overview(file_path: &str, config: &serde_json::Value) -> ConfigOverview {
    let inbounds = config
        .get("inbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|inbound| {
                    let inbound_type = inbound
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tag = inbound
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let listen = inbound
                        .get("listen")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let port = inbound
                        .get("listen_port")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0);

                    let details = match inbound_type.as_str() {
                        "tun" => {
                            let iface = inbound
                                .get("interface_name")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let stack = inbound.get("stack").and_then(|v| v.as_str()).unwrap_or("");
                            let mtu = inbound.get("mtu").and_then(|v| v.as_u64()).unwrap_or(0);
                            format!("TUN interface: {}, stack: {}, MTU: {}", iface, stack, mtu)
                        }
                        "mixed" => format!("{}:{}", listen, port),
                        _ => format!("{}:{}", listen, port),
                    };

                    InboundInfo {
                        inbound_type,
                        tag,
                        listen,
                        details,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let outbounds = config
        .get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|outbound| {
                    let outbound_type = outbound
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let tag = outbound
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let server = outbound
                        .get("server")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let port = outbound
                        .get("server_port")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0) as u16;

                    let is_group = matches!(outbound_type.as_str(), "selector" | "urltest");
                    let group_members = if is_group {
                        outbound
                            .get("outbounds")
                            .and_then(|v| v.as_array())
                            .map(|members| {
                                members
                                    .iter()
                                    .filter_map(|m| m.as_str().map(String::from))
                                    .collect()
                            })
                            .unwrap_or_default()
                    } else {
                        vec![]
                    };

                    let details = match outbound_type.as_str() {
                        "vless" => {
                            let flow = outbound.get("flow").and_then(|v| v.as_str()).unwrap_or("");
                            let tls_sni = outbound
                                .get("tls")
                                .and_then(|t| t.get("server_name"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let reality = outbound
                                .get("tls")
                                .and_then(|t| t.get("reality"))
                                .and_then(|r| r.get("enabled"))
                                .and_then(|v| v.as_bool())
                                .unwrap_or(false);
                            let transport = outbound
                                .get("transport")
                                .and_then(|t| t.get("type"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let mut desc = "VLESS".to_string();
                            if reality {
                                desc.push_str(" + Reality");
                            }
                            if !flow.is_empty() {
                                desc.push_str(&format!(" ({})", flow));
                            }
                            if !transport.is_empty() {
                                desc.push_str(&format!(" + {}", transport.to_uppercase()));
                            }
                            if !tls_sni.is_empty() {
                                desc.push_str(&format!(" [SNI: {}]", tls_sni));
                            }
                            desc
                        }
                        "shadowsocks" => {
                            let method = outbound
                                .get("method")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            format!("Shadowsocks ({})", method)
                        }
                        "trojan" => "Trojan".to_string(),
                        "vmess" => {
                            let security = outbound
                                .get("security")
                                .and_then(|v| v.as_str())
                                .unwrap_or("auto");
                            format!("VMess ({})", security)
                        }
                        "selector" => {
                            let default = outbound
                                .get("default")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            format!("Selector [default: {}]", default)
                        }
                        "urltest" => {
                            let interval = outbound
                                .get("interval")
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            let tolerance = outbound
                                .get("tolerance")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0);
                            format!(
                                "Auto Test [interval: {}, tolerance: {}ms]",
                                interval, tolerance
                            )
                        }
                        "direct" => "Direct".to_string(),
                        "block" => "Block".to_string(),
                        _ => outbound_type.clone(),
                    };

                    OutboundInfo {
                        outbound_type,
                        tag,
                        server,
                        port,
                        details,
                        is_group,
                        group_members,
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let dns_servers = config
        .get("dns")
        .and_then(|d| d.get("servers"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|srv| DnsServerInfo {
                    tag: srv
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    dns_type: srv
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    server: srv
                        .get("server")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    let route_rules_count = config
        .get("route")
        .and_then(|r| r.get("rules"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);

    let route_rules = config
        .get("route")
        .and_then(|r| r.get("rules"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|rule| {
                    let rule_type = rule
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let action = rule
                        .get("action")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let outbound = rule
                        .get("outbound")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let summary = summarize_route_rule(rule);
                    RouteRuleInfo {
                        summary,
                        rule_type,
                        action,
                        outbound,
                        raw: rule.clone(),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    let rule_sets = config
        .get("route")
        .and_then(|r| r.get("rule_set"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .map(|rs| RuleSetInfo {
                    tag: rs
                        .get("tag")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    rule_type: rs
                        .get("type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    format: rs
                        .get("format")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                    url: rs
                        .get("url")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();

    ConfigOverview {
        file_path: file_path.to_string(),
        inbounds,
        outbounds,
        dns_servers,
        route_rules_count,
        route_rules,
        rule_sets,
    }
}

fn summarize_route_rule(rule: &serde_json::Value) -> String {
    let mut parts: Vec<String> = Vec::new();

    let order = [
        ("domain_suffix", "domain_suffix"),
        ("domain", "domain"),
        ("domain_keyword", "domain_keyword"),
        ("ip_cidr", "ip_cidr"),
        ("source_ip_cidr", "source_ip_cidr"),
        ("port", "port"),
        ("network", "network"),
        ("protocol", "protocol"),
        ("action", "action"),
        ("server", "server"),
        ("outbound", "outbound"),
    ];

    for (field, label) in order {
        if let Some(value) = rule.get(field) {
            if let Some(array) = value.as_array() {
                let items: Vec<String> = array
                    .iter()
                    .filter_map(|item| {
                        item.as_str()
                            .map(String::from)
                            .or_else(|| item.as_u64().map(|n| n.to_string()))
                    })
                    .collect();
                if !items.is_empty() {
                    let joined = items.into_iter().take(3).collect::<Vec<_>>().join(", ");
                    parts.push(format!("{}: {}", label, joined));
                }
            } else if let Some(text) = value.as_str() {
                if !text.is_empty() {
                    parts.push(format!("{}: {}", label, text));
                }
            } else if let Some(num) = value.as_u64() {
                parts.push(format!("{}: {}", label, num));
            }
        }
    }

    if parts.is_empty() {
        return serde_json::to_string(rule).unwrap_or_else(|_| "Route rule".to_string());
    }

    parts.join(" • ")
}

fn get_config_profiles_dir() -> std::path::PathBuf {
    crate::app_paths::profiles_store_dir()
}

fn get_settings_file_path() -> std::path::PathBuf {
    crate::app_paths::settings_file_path()
}

fn get_config_profiles_file_path() -> std::path::PathBuf {
    crate::app_paths::config_profiles_file_path()
}

fn get_active_config_profile_file_path() -> std::path::PathBuf {
    crate::app_paths::active_profile_file_path()
}

fn get_nodes_file_path() -> String {
    crate::app_paths::nodes_file_path()
        .to_string_lossy()
        .to_string()
}

fn save_nodes(nodes: &[ProxyNode]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(nodes)
        .map_err(|e| format!("Failed to serialize nodes: {}", e))?;
    let path = get_nodes_file_path();
    fs::write(&path, content).map_err(|e| format!("Failed to save nodes: {}", e))?;
    Ok(())
}

fn save_profiles(profiles: &[Profile]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    let path = crate::app_paths::profiles_file_path();
    fs::write(&path, content).map_err(|e| format!("Failed to save profiles: {}", e))?;
    Ok(())
}

fn load_config_profiles() -> Result<Vec<ConfigProfile>, String> {
    let path = get_config_profiles_file_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read config profiles: {}", e))?;
    let mut profiles: Vec<ConfigProfile> =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse config profiles: {}", e))?;

    for profile in &mut profiles {
        if profile.source_kind.trim().is_empty() {
            profile.source_kind = profile_source_kind(&profile.source_path).to_string();
        }
        profile.refreshable = profile.source_kind == "url";
    }

    Ok(profiles)
}

fn save_config_profiles(profiles: &[ConfigProfile]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("Failed to serialize config profiles: {}", e))?;
    let path = get_config_profiles_file_path();
    fs::write(&path, content).map_err(|e| format!("Failed to save config profiles: {}", e))?;
    Ok(())
}

fn load_active_config_profile_id() -> Result<String, String> {
    let path = get_active_config_profile_file_path();
    if !path.exists() {
        return Ok(String::new());
    }

    fs::read_to_string(&path)
        .map(|content| content.trim().to_string())
        .map_err(|e| format!("Failed to read active profile id: {}", e))
}

fn save_active_config_profile_id(profile_id: &str) -> Result<(), String> {
    let path = get_active_config_profile_file_path();
    fs::write(&path, profile_id).map_err(|e| format!("Failed to save active profile id: {}", e))?;
    Ok(())
}

fn persist_active_profile_config(config: &serde_json::Value) -> Result<(), String> {
    let active_profile_id = load_active_config_profile_id()?;
    if active_profile_id.is_empty() {
        return Ok(());
    }

    let profile_path = get_config_profiles_dir().join(format!("{}.json", active_profile_id));
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize active profile config: {}", e))?;
    fs::write(&profile_path, content)
        .map_err(|e| format!("Failed to persist active profile config: {}", e))?;

    let mut profiles = load_config_profiles()?;
    if let Some(profile) = profiles
        .iter_mut()
        .find(|profile| profile.id == active_profile_id)
    {
        profile.updated_at = current_unix_timestamp();
        save_config_profiles(&profiles)?;
    }

    Ok(())
}

fn save_imported_config_profile(
    source_path: &str,
    config: &serde_json::Value,
) -> Result<ConfigProfile, String> {
    let mut profiles = load_config_profiles()?;
    let id = Uuid::new_v4().to_string();
    let now = current_unix_timestamp();
    let name = derive_config_profile_name(source_path);

    let profile = ConfigProfile {
        id: id.clone(),
        name,
        source_path: source_path.to_string(),
        source_kind: profile_source_kind(source_path).to_string(),
        refreshable: profile_source_kind(source_path) == "url",
        created_at: now,
        updated_at: now,
    };

    let profile_path = get_config_profiles_dir().join(format!("{}.json", id));
    let content = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to serialize imported config: {}", e))?;
    fs::write(&profile_path, content)
        .map_err(|e| format!("Failed to save imported profile: {}", e))?;

    profiles.insert(0, profile.clone());
    save_config_profiles(&profiles)?;
    save_active_config_profile_id(&profile.id)?;

    Ok(profile)
}

fn derive_config_profile_name(source_path: &str) -> String {
    if let Some(url) = parse_subscription_url(source_path) {
        if let Some(fragment) = url.fragment() {
            let decoded = percent_encoding::percent_decode_str(fragment)
                .decode_utf8()
                .map(|value| value.trim().to_string())
                .unwrap_or_else(|_| fragment.trim().to_string());
            if !decoded.is_empty() {
                return decoded;
            }
        }

        if let Some(last_segment) = url
            .path_segments()
            .and_then(|mut segments| segments.rfind(|segment| !segment.is_empty()))
        {
            let stem = Path::new(last_segment)
                .file_stem()
                .and_then(|value| value.to_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            if let Some(stem) = stem {
                return stem.to_string();
            }
        }

        if let Some(host) = url.host_str() {
            return host.to_string();
        }
    }

    Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Imported Profile")
        .to_string()
}

fn default_profile_source_kind() -> String {
    "file".to_string()
}

fn profile_source_kind(source_path: &str) -> &'static str {
    if parse_subscription_url(source_path).is_some() {
        "url"
    } else {
        "file"
    }
}

fn parse_subscription_url(source_path: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(source_path).ok()?;
    match url.scheme() {
        "http" | "https" => Some(url),
        _ => None,
    }
}

fn activate_config_profile_internal(profile_id: &str) -> Result<ImportResult, String> {
    activate_config_profile_internal_with_options(profile_id, true)
}

fn load_active_profile_overview_source() -> Result<Option<(String, serde_json::Value)>, String> {
    let active_profile_id = load_active_config_profile_id().unwrap_or_default();
    if active_profile_id.trim().is_empty() {
        return Ok(None);
    }

    let profiles = load_config_profiles()?;
    let Some(profile) = profiles.into_iter().find(|profile| profile.id == active_profile_id) else {
        return Ok(None);
    };

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    if !profile_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read active profile config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse active profile config: {}", e))?;

    Ok(Some((profile.source_path, config)))
}

fn activate_config_profile_internal_with_options(
    profile_id: &str,
    write_runtime_config: bool,
) -> Result<ImportResult, String> {
    let profiles = load_config_profiles()?;
    let profile = profiles
        .iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    let content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read saved profile config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse saved profile config: {}", e))?;

    if write_runtime_config {
        let runtime_config_path = crate::app_paths::runtime_config_path();
        let runtime_content = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize runtime config: {}", e))?;
        fs::write(&runtime_config_path, runtime_content)
            .map_err(|e| format!("Failed to activate profile config: {}", e))?;
    }

    let nodes = extract_nodes_from_config(&config);
    let profiles_data = extract_profiles(&config);
    let active_node = determine_active_node(&profiles_data, &nodes);
    let active_outbound = determine_active_outbound(&profiles_data, &nodes);
    save_nodes(&nodes)?;
    save_profiles(&profiles_data)?;
    save_active_config_profile_id(&profile.id)?;

    Ok(ImportResult {
        overview: parse_config_overview(&profile.source_path, &config),
        nodes,
        profiles: profiles_data,
        active_node,
        active_outbound,
    })
}

fn clear_runtime_config_files() -> Result<(), String> {
    for path in [
        crate::app_paths::runtime_config_path(),
        crate::app_paths::nodes_file_path(),
        crate::app_paths::profiles_file_path(),
    ] {
        if path.exists() {
            let label = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("runtime file");
            fs::remove_file(&path).map_err(|e| format!("Failed to remove {}: {}", label, e))?;
        }
    }
    Ok(())
}

fn port_is_available(host: &str, port: u16) -> bool {
    TcpListener::bind((host, port)).is_ok()
}

fn get_mixed_inbound_endpoint_from_config(config: &serde_json::Value) -> Result<(String, u16), String> {
    let mixed = config
        .get("inbounds")
        .and_then(|value| value.as_array())
        .and_then(|inbounds| {
            inbounds
                .iter()
                .find(|inbound| inbound.get("type").and_then(|value| value.as_str()) == Some("mixed"))
        })
        .ok_or("No mixed inbound found in active runtime config".to_string())?;

    let host = mixed
        .get("listen")
        .and_then(|value| value.as_str())
        .unwrap_or("127.0.0.1")
        .to_string();
    let port = mixed
        .get("listen_port")
        .and_then(|value| value.as_u64())
        .unwrap_or(7890) as u16;

    Ok((host, port))
}

fn config_has_tun_inbound_value(config: &serde_json::Value) -> bool {
    config
        .get("inbounds")
        .and_then(|value| value.as_array())
        .map(|inbounds| {
            inbounds
                .iter()
                .any(|inbound| inbound.get("type").and_then(|value| value.as_str()) == Some("tun"))
        })
        .unwrap_or(false)
}

fn current_unix_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn load_app_settings() -> Result<AppSettings, String> {
    let path = get_settings_file_path();
    if !path.exists() {
        return Err("Settings file not found".to_string());
    }

    let content =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read settings: {}", e))?;
    let mut settings: AppSettings =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse settings: {}", e))?;
    normalize_app_settings(&mut settings);
    Ok(settings)
}

pub(crate) fn load_app_settings_or_default() -> AppSettings {
    load_app_settings().unwrap_or_else(|_| default_app_settings())
}

fn save_app_settings_file(settings: &AppSettings) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let path = get_settings_file_path();
    fs::write(&path, content).map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

fn infer_settings_from_config(config: &serde_json::Value) -> AppSettings {
    let mut settings = default_app_settings();

    if let Some(inbounds) = config.get("inbounds").and_then(|v| v.as_array()) {
        if let Some(mixed) = inbounds
            .iter()
            .find(|ib| ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed")
        {
            settings.mixed_listen = mixed
                .get("listen")
                .and_then(|v| v.as_str())
                .unwrap_or("127.0.0.1")
                .to_string();
            settings.mixed_port = mixed
                .get("listen_port")
                .and_then(|v| v.as_u64())
                .unwrap_or(7890) as u16;
        }

        if let Some(tun) = inbounds
            .iter()
            .find(|ib| ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "tun")
        {
            settings.tun_enabled = true;
            settings.tun_interface_name = tun
                .get("interface_name")
                .and_then(|v| v.as_str())
                .unwrap_or("singbox")
                .to_string();
            settings.tun_mtu = tun.get("mtu").and_then(|v| v.as_u64()).unwrap_or(9000);
            settings.tun_stack = tun
                .get("stack")
                .and_then(|v| v.as_str())
                .unwrap_or("mixed")
                .to_string();
            settings.tun_auto_route = tun
                .get("auto_route")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            settings.tun_strict_route = tun
                .get("strict_route")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            settings.tun_sniff = tun.get("sniff").and_then(|v| v.as_bool()).unwrap_or(true);
            settings.tun_sniff_override_destination = tun
                .get("sniff_override_destination")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            settings.tun_address = tun
                .get("address")
                .and_then(|v| v.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_else(|| vec!["172.19.0.1/30".to_string()]);
        }
    }

    if let Some(dns) = config.get("dns") {
        settings.dns_final = dns
            .get("final")
            .and_then(|v| v.as_str())
            .unwrap_or("google")
            .to_string();
        settings.dns_strategy = dns
            .get("strategy")
            .and_then(|v| v.as_str())
            .unwrap_or("auto")
            .to_string();
        settings.dns_servers = dns
            .get("servers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(default_dns_servers);
    }

    normalize_app_settings(&mut settings);
    settings
}

fn normalize_app_settings(settings: &mut AppSettings) {
    if is_auto_dns_strategy(&settings.dns_strategy) {
        settings.dns_strategy = "auto".to_string();
    }
    normalize_dns_server_detours(&mut settings.dns_servers);
    if settings.latency_test_url.trim().is_empty() {
        settings.latency_test_url = default_latency_test_url();
    }
    settings.latency_timeout_ms = settings.latency_timeout_ms.clamp(1_000, 30_000);
    settings.latency_concurrency = settings.latency_concurrency.clamp(1, 32);
}

fn is_auto_dns_strategy(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    normalized.is_empty()
        || normalized == "auto"
        || normalized == "ipv4_only"
        || normalized == "ipv4only"
        || normalized == "ip4_only"
        || normalized == "ip4only"
}

fn normalize_dns_server_detours(servers: &mut [serde_json::Value]) {
    for server in servers {
        if let Some(obj) = server.as_object_mut() {
            let tag = obj
                .get("tag")
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if tag == "local" {
                obj.insert(
                    "detour".to_string(),
                    serde_json::Value::String("direct".to_string()),
                );
            } else {
                obj.remove("detour");
            }
        }
    }
}

fn apply_app_settings_to_config(
    mut config: serde_json::Value,
    settings: &AppSettings,
) -> serde_json::Value {
    if !config.is_object() {
        config = serde_json::json!({});
    }

    if config.get("inbounds").and_then(|v| v.as_array()).is_none() {
        config["inbounds"] = serde_json::json!([]);
    }

    if let Some(inbounds) = config.get_mut("inbounds").and_then(|v| v.as_array_mut()) {
        if let Some(mixed) = inbounds
            .iter_mut()
            .find(|ib| ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed")
        {
            if let Some(obj) = mixed.as_object_mut() {
                obj.insert(
                    "tag".to_string(),
                    serde_json::Value::String("mixed-in".to_string()),
                );
                obj.insert(
                    "listen".to_string(),
                    serde_json::Value::String(settings.mixed_listen.clone()),
                );
                obj.insert(
                    "listen_port".to_string(),
                    serde_json::Value::Number(settings.mixed_port.into()),
                );
            }
        } else {
            inbounds.push(serde_json::json!({
                "type": "mixed",
                "tag": "mixed-in",
                "listen": settings.mixed_listen.clone(),
                "listen_port": settings.mixed_port
            }));
        }

        inbounds.retain(|ib| {
            let inbound_type = ib.get("type").and_then(|v| v.as_str()).unwrap_or("");
            settings.tun_enabled || inbound_type != "tun"
        });

        if settings.tun_enabled {
            if let Some(tun) = inbounds
                .iter_mut()
                .find(|ib| ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "tun")
            {
                *tun = serde_json::json!({
                    "type": "tun",
                    "tag": "tun-in",
                    "interface_name": settings.tun_interface_name.clone(),
                    "mtu": settings.tun_mtu,
                    "stack": settings.tun_stack.clone(),
                    "auto_route": settings.tun_auto_route,
                    "strict_route": settings.tun_strict_route,
                    "sniff": settings.tun_sniff,
                    "sniff_override_destination": settings.tun_sniff_override_destination,
                    "address": settings.tun_address.clone()
                });
            } else {
                inbounds.insert(
                    0,
                    serde_json::json!({
                        "type": "tun",
                        "tag": "tun-in",
                        "interface_name": settings.tun_interface_name.clone(),
                        "mtu": settings.tun_mtu,
                        "stack": settings.tun_stack.clone(),
                        "auto_route": settings.tun_auto_route,
                        "strict_route": settings.tun_strict_route,
                        "sniff": settings.tun_sniff,
                        "sniff_override_destination": settings.tun_sniff_override_destination,
                        "address": settings.tun_address.clone()
                    }),
                );
            }
        }
    }

    if config.get("dns").and_then(|v| v.as_object()).is_none() {
        config["dns"] = serde_json::json!({});
    }

    if let Some(dns) = config.get_mut("dns").and_then(|v| v.as_object_mut()) {
        dns.insert(
            "final".to_string(),
            serde_json::Value::String(settings.dns_final.clone()),
        );
        if is_auto_dns_strategy(&settings.dns_strategy) {
            dns.remove("strategy");
        } else {
            dns.insert(
                "strategy".to_string(),
                serde_json::Value::String(settings.dns_strategy.clone()),
            );
        }
        dns.insert(
            "servers".to_string(),
            serde_json::Value::Array(settings.dns_servers.clone()),
        );
    }

    if let Some(dns) = config.get_mut("dns") {
        sanitize_dns_rules(dns);
        sanitize_dns_servers(dns);
        sanitize_dns_strategy(dns);
    }

    ensure_default_domain_resolver(&mut config);

    config
}

fn sync_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (run_key, _) = hkcu
            .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| format!("Failed to open startup registry key: {}", e))?;

        let app_path = std::env::current_exe()
            .map_err(|e| format!("Failed to locate app executable: {}", e))?;
        let command = format!("\"{}\"", app_path.display());

        if enabled {
            run_key
                .set_value("SingBox Client", &command)
                .map_err(|e| format!("Failed to enable autostart: {}", e))?;
        } else {
            let _ = run_key.delete_value("SingBox Client");
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(())
    }
}

fn is_autostart_enabled() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let run_key = hkcu
            .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run")
            .map_err(|e| format!("Failed to read startup registry key: {}", e))?;

        let value: Result<String, _> = run_key.get_value("SingBox Client");
        Ok(value.is_ok())
    }

    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Sanitize config for sing-box 1.12.0 compatibility:
/// - Remove DNS servers with type "block" (unsupported)
/// - Move per-server "strategy" to DNS top-level
/// - Migrate legacy "ssl" blocks to "tls"
/// - Normalize legacy TUN address fields into sing-box 1.12 arrays
/// - Remove "sniff_override_destination" from route rule sniff actions
/// - Ensure a "mixed" inbound exists on port 7890 for system proxy fallback
fn sanitize_config_for_v1_12(mut config: serde_json::Value) -> serde_json::Value {
    // Fix DNS section
    if let Some(dns) = config.get_mut("dns") {
        sanitize_dns_rules(dns);
        sanitize_dns_servers(dns);
        sanitize_dns_strategy(dns);

        // Remove "block" type DNS servers and per-server "strategy"
        if let Some(servers) = dns.get_mut("servers").and_then(|s| s.as_array_mut()) {
            // Collect strategy from servers before removing
            let mut found_strategy = None;
            for server in servers.iter_mut() {
                if let Some(obj) = server.as_object_mut() {
                    if let Some(strategy) = obj.remove("strategy") {
                        if found_strategy.is_none() {
                            found_strategy = Some(strategy);
                        }
                    }
                }
            }
            // Remove block type servers
            servers.retain(|s| s.get("type").and_then(|t| t.as_str()).unwrap_or("") != "block");
            // Add strategy to DNS top-level if not already present
            if let Some(strategy) = found_strategy {
                if let Some(dns_obj) = dns.as_object_mut() {
                    dns_obj.entry("strategy").or_insert(strategy);
                }
            }
        }

        sanitize_dns_strategy(dns);
    }

    ensure_default_domain_resolver(&mut config);

    // Fix route rules: remove sniff_override_destination from sniff actions
    if let Some(route) = config.get_mut("route") {
        if let Some(rules) = route.get_mut("rules").and_then(|r| r.as_array_mut()) {
            for rule in rules.iter_mut() {
                if let Some(obj) = rule.as_object_mut() {
                    let is_sniff = obj
                        .get("action")
                        .and_then(|a| a.as_str())
                        .map(|a| a == "sniff")
                        .unwrap_or(false);
                    if is_sniff {
                        obj.remove("sniff_override_destination");
                    }
                }
            }
        }

    }

    if let Some(outbounds) = config.get_mut("outbounds").and_then(|o| o.as_array_mut()) {
        for outbound in outbounds.iter_mut() {
            migrate_ssl_to_tls(outbound);
        }
    }

    if let Some(inbounds) = config.get_mut("inbounds").and_then(|i| i.as_array_mut()) {
        for inbound in inbounds.iter_mut() {
            migrate_ssl_to_tls(inbound);

            if let Some(obj) = inbound.as_object_mut() {
                let is_tun = obj
                    .get("type")
                    .and_then(|value| value.as_str())
                    .map(|value| value == "tun")
                    .unwrap_or(false);

                if is_tun {
                    merge_legacy_string_fields(obj, "address", &["inet4_address", "inet6_address"]);
                    merge_legacy_string_fields(
                        obj,
                        "route_address",
                        &["inet4_route_address", "inet6_route_address"],
                    );
                    merge_legacy_string_fields(
                        obj,
                        "route_exclude_address",
                        &["inet4_route_exclude_address", "inet6_route_exclude_address"],
                    );
                }
            }
        }
    }

    // Ensure a "mixed" inbound (HTTP+SOCKS5) exists on port 7890 for system proxy
    if config.get("inbounds").and_then(|v| v.as_array()).is_none() {
        config["inbounds"] = serde_json::json!([]);
    }

    if let Some(inbounds) = config.get_mut("inbounds").and_then(|i| i.as_array_mut()) {
        let has_mixed = inbounds
            .iter()
            .any(|ib| ib.get("type").and_then(|t| t.as_str()).unwrap_or("") == "mixed");
        if !has_mixed {
            inbounds.push(serde_json::json!({
                "type": "mixed",
                "tag": "mixed-in",
                "listen": "127.0.0.1",
                "listen_port": 7890
            }));
        }
    }

    config
}

fn sanitize_dns_rules(dns: &mut serde_json::Value) {
    let Some(rules) = dns.get_mut("rules").and_then(|value| value.as_array_mut()) else {
        return;
    };

    rules.retain(|rule| {
        let routes_any_outbound = rule_routes_any_outbound(rule);
        let routes_local_server =
            rule.get("server").and_then(|value| value.as_str()) == Some("local");
        !(routes_any_outbound && routes_local_server)
    });
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

fn sanitize_dns_servers(dns: &mut serde_json::Value) {
    let Some(servers) = dns
        .get_mut("servers")
        .and_then(|value| value.as_array_mut())
    else {
        return;
    };

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
        }

        if is_ali_doh {
            obj.insert(
                "address".to_string(),
                serde_json::Value::String("223.5.5.5".to_string()),
            );
        }

        if is_local {
            obj.insert(
                "detour".to_string(),
                serde_json::Value::String("direct".to_string()),
            );
        }
    }
}

fn sanitize_dns_strategy(dns: &mut serde_json::Value) {
    let Some(obj) = dns.as_object_mut() else {
        return;
    };

    let is_auto = obj
        .get("strategy")
        .and_then(|value| value.as_str())
        .map(|value| {
            let strategy = value.trim();
            is_auto_dns_strategy(strategy)
        })
        .unwrap_or(false);

    if is_auto {
        obj.remove("strategy");
    }
}

fn ensure_default_domain_resolver(config: &mut serde_json::Value) {
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
        return;
    }

    if config
        .get("route")
        .and_then(|value| value.as_object())
        .is_none()
    {
        config["route"] = serde_json::json!({});
    }

    if let Some(route) = config
        .get_mut("route")
        .and_then(|value| value.as_object_mut())
    {
        route.insert(
            "default_domain_resolver".to_string(),
            serde_json::Value::String("local".to_string()),
        );
    }
}

fn migrate_ssl_to_tls(value: &mut serde_json::Value) {
    if let Some(obj) = value.as_object_mut() {
        if !obj.contains_key("tls") {
            if let Some(ssl) = obj.remove("ssl") {
                obj.insert("tls".to_string(), ssl);
            }
        }
    }
}

fn merge_legacy_string_fields(
    obj: &mut serde_json::Map<String, serde_json::Value>,
    target_key: &str,
    legacy_keys: &[&str],
) {
    let mut merged = match obj.remove(target_key) {
        Some(serde_json::Value::Array(items)) => items,
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => {
            vec![serde_json::Value::String(value)]
        }
        _ => Vec::new(),
    };

    for legacy_key in legacy_keys {
        if let Some(value) = obj.remove(*legacy_key) {
            match value {
                serde_json::Value::String(text) if !text.trim().is_empty() => {
                    push_unique_string(&mut merged, text);
                }
                serde_json::Value::Array(items) => {
                    for item in items {
                        if let Some(text) = item.as_str() {
                            if !text.trim().is_empty() {
                                push_unique_string(&mut merged, text.to_string());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    if !merged.is_empty() {
        obj.insert(target_key.to_string(), serde_json::Value::Array(merged));
    }
}

fn push_unique_string(items: &mut Vec<serde_json::Value>, value: String) {
    let exists = items
        .iter()
        .any(|item| item.as_str() == Some(value.as_str()));
    if !exists {
        items.push(serde_json::Value::String(value));
    }
}

#[cfg(test)]
mod settings_tests {
    use super::*;

    #[test]
    fn old_settings_receive_latency_defaults() {
        let old = serde_json::json!({
            "autostart_enabled": false,
            "tun_enabled": false,
            "mixed_listen": "127.0.0.1",
            "mixed_port": 7890,
            "tun_interface_name": "singbox",
            "tun_mtu": 9000,
            "tun_stack": "mixed",
            "tun_auto_route": true,
            "tun_strict_route": true,
            "tun_sniff": true,
            "tun_sniff_override_destination": true,
            "tun_address": ["172.19.0.1/30"],
            "dns_final": "google",
            "dns_strategy": "auto",
            "dns_servers": [],
            "latency_cache_ttl_secs": 600
        });
        let parsed: AppSettings = serde_json::from_value(old).unwrap();
        assert_eq!(parsed.latency_test_url, default_latency_test_url());
        assert_eq!(parsed.latency_timeout_ms, 5_000);
        assert_eq!(parsed.latency_concurrency, 16);
        assert!(parsed.latency_auto_test);
        assert!(
            serde_json::to_value(parsed)
                .unwrap()
                .get("latency_cache_ttl_secs")
                .is_none()
        );
    }

    #[test]
    fn outbound_selection_updates_nested_selectors_and_resolves_leaf() {
        let mut config = serde_json::json!({
            "outbounds": [
                { "type": "selector", "tag": "proxy", "outbounds": ["region"], "default": "region" },
                { "type": "selector", "tag": "region", "outbounds": ["node-a", "node-b"], "default": "node-a" },
                { "type": "vless", "tag": "node-a", "server": "a.example", "server_port": 443 },
                { "type": "vless", "tag": "node-b", "server": "b.example", "server_port": 443 }
            ]
        });

        let plan = apply_outbound_selection(&mut config, "node-b").unwrap();

        assert_eq!(
            plan.selector_path,
            vec![
                ("proxy".to_string(), "region".to_string()),
                ("region".to_string(), "node-b".to_string())
            ]
        );
        assert_eq!(plan.active_tag, "node-b");
        assert_eq!(config["outbounds"][1]["default"], "node-b");
    }

    #[test]
    fn affected_connections_only_include_switched_selector_chains() {
        let payload = serde_json::json!({
            "connections": [
                { "id": "one", "chains": ["node-a", "region", "proxy"] },
                { "id": "two", "chains": ["direct"] },
                { "id": "three", "chains": ["other", "proxy"] }
            ]
        });
        let selectors = std::collections::HashSet::from([
            "proxy".to_string(),
            "region".to_string(),
        ]);

        assert_eq!(
            affected_connection_ids(&payload, &selectors),
            vec!["one".to_string(), "three".to_string()]
        );
    }

    #[tokio::test]
    async fn runtime_selector_switch_is_authenticated_and_verified() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let selected = std::sync::Arc::new(tokio::sync::Mutex::new("node-a".to_string()));
        let unauthorized = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let server_selected = std::sync::Arc::clone(&selected);
        let server_unauthorized = std::sync::Arc::clone(&unauthorized);
        let server = tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut buffer = [0_u8; 2048];
                loop {
                    let read = socket.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&buffer[..read]);
                    let Some(header_end) = request.windows(4).position(|item| item == b"\r\n\r\n") else {
                        continue;
                    };
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            let (name, value) = line.split_once(':')?;
                            name.eq_ignore_ascii_case("content-length")
                                .then(|| value.trim().to_string())
                        })
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(0);
                    if request.len() >= header_end + 4 + content_length {
                        break;
                    }
                }

                let text = String::from_utf8_lossy(&request);
                if !text.to_ascii_lowercase().contains("authorization: bearer secret") {
                    server_unauthorized.store(true, std::sync::atomic::Ordering::SeqCst);
                }
                let request_line = text.lines().next().unwrap_or_default();
                if request_line.starts_with("PUT ") {
                    if let Some(body_start) = request.windows(4).position(|item| item == b"\r\n\r\n") {
                        let body = &request[body_start + 4..];
                        let payload: serde_json::Value = serde_json::from_slice(body).unwrap();
                        *server_selected.lock().await = payload["name"].as_str().unwrap().to_string();
                    }
                    socket
                        .write_all(b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                        .await
                        .unwrap();
                } else {
                    let body = serde_json::json!({ "now": server_selected.lock().await.clone() }).to_string();
                    let response = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(), body
                    );
                    socket.write_all(response.as_bytes()).await.unwrap();
                }
            }
        });

        let client = reqwest::Client::new();
        switch_selector_path_via_api(
            &client,
            &format!("http://{}", address),
            "secret",
            &[("proxy".to_string(), "node-b".to_string())],
        )
        .await
        .unwrap();

        assert_eq!(*selected.lock().await, "node-b");
        assert!(!unauthorized.load(std::sync::atomic::Ordering::SeqCst));
        server.abort();
    }
}
