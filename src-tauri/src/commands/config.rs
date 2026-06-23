use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Represents a proxy node configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyNode {
    pub id: String,
    pub name: String,       // tag from sing-box config
    pub node_type: String,
    pub server: String,
    pub port: u16,
    pub settings: serde_json::Value,
}

/// Represents a profile (selector/urltest group)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub tag: String,
    pub profile_type: String,  // "selector" or "urltest"
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
    pub active_node: String,  // auto-selected node tag based on profile
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

/// Persistent client settings applied to imported/generated configs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
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
}

/// Saved imported config profile metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigProfile {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub created_at: u64,
    pub updated_at: u64,
}

/// Non-proxy outbound types that should NOT be extracted as nodes
const SPECIAL_OUTBOUND_TYPES: &[&str] = &["direct", "block", "dns", "selector", "urltest"];

fn default_dns_servers() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "tag": "google",
            "address": "tls://8.8.8.8"
        }),
        serde_json::json!({
            "tag": "local",
            "address": "https://223.5.5.5/dns-query"
        }),
    ]
}

fn default_app_settings() -> AppSettings {
    AppSettings {
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
        dns_strategy: "ipv4_only".to_string(),
        dns_servers: default_dns_servers(),
    }
}

/// Import a sing-box config file: parse overview, extract nodes, determine active profile
#[tauri::command]
pub async fn import_config_file(file_path: String) -> Result<ImportResult, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Sanitize config for sing-box 1.12.0 compatibility
    let config = sanitize_config_for_v1_12(config);
    let settings = load_app_settings().unwrap_or_else(|_| infer_settings_from_config(&config));
    let config = apply_app_settings_to_config(config, &settings);

    let profile = save_imported_config_profile(&file_path, &config)?;
    activate_config_profile_internal(&profile.id)
}

/// Get the current loaded config overview
#[tauri::command]
pub async fn get_config_overview() -> Result<Option<ConfigOverview>, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let display_path = load_active_config_profile_id()
        .ok()
        .and_then(|id| {
            load_config_profiles()
                .ok()
                .and_then(|profiles| profiles.into_iter().find(|profile| profile.id == id).map(|profile| profile.source_path))
        })
        .unwrap_or_else(|| config_path.to_string_lossy().to_string());
    Ok(Some(parse_config_overview(&display_path, &config)))
}

/// Get the current client settings or infer them from config/defaults
#[tauri::command]
pub async fn get_app_settings() -> Result<AppSettings, String> {
    if let Ok(settings) = load_app_settings() {
        return Ok(settings);
    }

    let config_path = get_config_dir().join("config.json");
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;
        return Ok(infer_settings_from_config(&config));
    }

    Ok(default_app_settings())
}

/// Save client settings and re-apply them to the current config if one exists
#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<AppSettings, String> {
    save_app_settings_file(&settings)?;

    let config_path = get_config_dir().join("config.json");
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        let config: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse config: {}", e))?;
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
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.get("route")
        .and_then(|route| route.get("rule_set"))
        .and_then(|rule_sets| rule_sets.as_array())
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn get_route_rules_json() -> Result<Vec<serde_json::Value>, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    Ok(config.get("route")
        .and_then(|route| route.get("rules"))
        .and_then(|rules| rules.as_array())
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
pub async fn save_route_rules_json(rules: Vec<serde_json::Value>) -> Result<String, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Err("No active config profile is loaded".to_string());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    if config.get("route").and_then(|route| route.as_object()).is_none() {
        config["route"] = serde_json::json!({});
    }

    if let Some(route) = config.get_mut("route").and_then(|route| route.as_object_mut()) {
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
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Err("No active config profile is loaded".to_string());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    if config.get("route").and_then(|route| route.as_object()).is_none() {
        config["route"] = serde_json::json!({});
    }

    if let Some(route) = config.get_mut("route").and_then(|route| route.as_object_mut()) {
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
    activate_config_profile_internal(&profile_id)
}

/// Delete a saved imported config profile
#[tauri::command]
pub async fn delete_config_profile(profile_id: String) -> Result<String, String> {
    let mut profiles = load_config_profiles()?;
    let index = profiles.iter().position(|profile| profile.id == profile_id)
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

/// Get saved profiles
#[tauri::command]
pub async fn get_profiles() -> Result<Vec<Profile>, String> {
    let path = get_config_dir().join("profiles.json");
    if !path.exists() {
        return Ok(vec![]);
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read profiles: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse profiles: {}", e))
}

/// Get the currently selected outbound tag from the imported config
#[tauri::command]
pub async fn get_active_outbound() -> Result<String, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Ok(String::new());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let nodes = extract_nodes_from_config(&config);
    Ok(determine_active_outbound(&profiles, &nodes))
}

/// Set the active outbound selection in the imported config by updating selector defaults
#[tauri::command]
pub async fn set_active_outbound(target_tag: String) -> Result<String, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Err("No imported config is loaded".to_string());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let nodes = extract_nodes_from_config(&config);
    if !profiles.iter().any(|p| p.tag == target_tag) && !nodes.iter().any(|n| n.id == target_tag) {
        return Err(format!("Outbound '{}' not found in current config", target_tag));
    }

    let top_selector = profiles.iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first())
        .ok_or("No outbound groups found in current config".to_string())?;

    if target_tag == top_selector.tag {
        return Ok(target_tag);
    }

    let path = build_selector_path(&top_selector.tag, &target_tag, &profiles)
        .ok_or_else(|| format!("Outbound '{}' is not reachable from selector '{}'", target_tag, top_selector.tag))?;

    apply_selector_path(&mut config, &path)?;

    let updated_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&config_path, updated_content)
        .map_err(|e| format!("Failed to save config: {}", e))?;
    persist_active_profile_config(&config)?;

    let updated_profiles = extract_profiles(&config);
    save_profiles(&updated_profiles)?;

    Ok(target_tag)
}

/// Remove an outbound group from the imported config and refresh saved profiles/nodes
#[tauri::command]
pub async fn remove_group(group_tag: String) -> Result<String, String> {
    let config_path = get_config_dir().join("config.json");
    if !config_path.exists() {
        return Err("No imported config is loaded".to_string());
    }

    let content = fs::read_to_string(&config_path)
        .map_err(|e| format!("Failed to read config: {}", e))?;
    let mut config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config: {}", e))?;

    let profiles = extract_profiles(&config);
    let profile = profiles.iter()
        .find(|p| p.tag == group_tag)
        .ok_or_else(|| format!("Group '{}' not found", group_tag))?;

    if profile.profile_type != "selector" && profile.profile_type != "urltest" {
        return Err(format!("Outbound '{}' is not a removable group", group_tag));
    }

    let top_selector = profiles.iter()
        .find(|p| p.profile_type == "selector")
        .or_else(|| profiles.first());
    if top_selector.map(|p| p.tag.as_str()) == Some(group_tag.as_str()) {
        return Err("Cannot delete the top-level active group".to_string());
    }

    let outbounds = config.get_mut("outbounds")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config has no outbounds array".to_string())?;

    let original_len = outbounds.len();
    outbounds.retain(|outbound| outbound.get("tag").and_then(|v| v.as_str()) != Some(group_tag.as_str()));
    if outbounds.len() == original_len {
        return Err(format!("Group '{}' not found in outbounds", group_tag));
    }

    let fallback_tag = outbounds.iter()
        .find_map(|outbound| {
            let outbound_type = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let tag = outbound.get("tag").and_then(|v| v.as_str()).unwrap_or("");
            if tag.is_empty() || tag == group_tag || outbound_type == "direct" || outbound_type == "block" || outbound_type == "dns" {
                None
            } else {
                Some(tag.to_string())
            }
        })
        .unwrap_or_else(|| "direct".to_string());

    for outbound in outbounds.iter_mut() {
        if matches!(outbound.get("type").and_then(|v| v.as_str()), Some("selector" | "urltest")) {
            if let Some(members) = outbound.get_mut("outbounds").and_then(|v| v.as_array_mut()) {
                members.retain(|member| member.as_str() != Some(group_tag.as_str()));
            }
            let default_is_deleted = outbound.get("default").and_then(|v| v.as_str()) == Some(group_tag.as_str());
            if default_is_deleted {
                let replacement = outbound.get("outbounds")
                    .and_then(|v| v.as_array())
                    .and_then(|members| members.iter().find_map(|member| member.as_str().map(String::from)))
                    .unwrap_or_else(|| fallback_tag.clone());
                if let Some(obj) = outbound.as_object_mut() {
                    obj.insert("default".to_string(), serde_json::Value::String(replacement));
                }
            }
        }
    }

    if let Some(route) = config.get_mut("route").and_then(|v| v.as_object_mut()) {
        if route.get("final").and_then(|v| v.as_str()) == Some(group_tag.as_str()) {
            route.insert("final".to_string(), serde_json::Value::String(fallback_tag.clone()));
        }
    }

    if let Some(dns) = config.get_mut("dns").and_then(|v| v.as_object_mut()) {
        if dns.get("final").and_then(|v| v.as_str()) == Some(group_tag.as_str()) {
            dns.insert("final".to_string(), serde_json::Value::String(fallback_tag.clone()));
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
    config.get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|outbound| {
                    let otype = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    !SPECIAL_OUTBOUND_TYPES.contains(&otype)
                })
                .map(|outbound| {
                    let node_type = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                    let tag = outbound.get("tag").and_then(|v| v.as_str()).unwrap_or("unnamed").to_string();
                    let server = outbound.get("server").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let port = outbound.get("server_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;

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
    config.get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter(|outbound| {
                    let otype = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    otype == "selector" || otype == "urltest"
                })
                .map(|outbound| {
                    let profile_type = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let tag = outbound.get("tag").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let outbounds = outbound.get("outbounds")
                        .and_then(|v| v.as_array())
                        .map(|members| members.iter().filter_map(|m| m.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    let default_outbound = outbound.get("default").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let interval = outbound.get("interval").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let tolerance = outbound.get("tolerance").and_then(|v| v.as_u64()).unwrap_or(0);

                    Profile { tag, profile_type, outbounds, default_outbound, interval, tolerance }
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Determine which node should be active based on profile hierarchy
/// Logic: find the top-level selector -> get its default -> if default is another group, recurse
fn determine_active_node(profiles: &[Profile], nodes: &[ProxyNode]) -> String {
    // Find the top-level selector (usually tagged "proxy")
    let top_selector = profiles.iter()
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
            return sub_profile.outbounds.first()
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
    let top_selector = profiles.iter()
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

fn build_selector_path(root_tag: &str, target_tag: &str, profiles: &[Profile]) -> Option<Vec<(String, String)>> {
    let profile = profiles.iter().find(|p| p.tag == root_tag)?;

    for outbound in &profile.outbounds {
        if outbound == target_tag {
            return Some(vec![(root_tag.to_string(), target_tag.to_string())]);
        }

        if let Some(child_profile) = profiles.iter().find(|p| p.tag == *outbound) {
            if child_profile.profile_type == "selector" {
                if let Some(mut child_path) = build_selector_path(&child_profile.tag, target_tag, profiles) {
                    let mut path = vec![(root_tag.to_string(), child_profile.tag.clone())];
                    path.append(&mut child_path);
                    return Some(path);
                }
            } else if child_profile.profile_type == "urltest" {
                if child_profile.tag == target_tag || child_profile.outbounds.iter().any(|member| member == target_tag) {
                    return Some(vec![(root_tag.to_string(), child_profile.tag.clone())]);
                }
            }
        }
    }

    None
}

fn apply_selector_path(config: &mut serde_json::Value, path: &[(String, String)]) -> Result<(), String> {
    let outbounds = config.get_mut("outbounds")
        .and_then(|v| v.as_array_mut())
        .ok_or("Config has no outbounds array".to_string())?;

    for (selector_tag, next_tag) in path {
        let outbound = outbounds.iter_mut()
            .find(|outbound| outbound.get("tag").and_then(|v| v.as_str()) == Some(selector_tag.as_str()))
            .ok_or_else(|| format!("Selector '{}' not found in config", selector_tag))?;

        if outbound.get("type").and_then(|v| v.as_str()) != Some("selector") {
            continue;
        }

        let members = outbound.get("outbounds")
            .and_then(|v| v.as_array())
            .ok_or_else(|| format!("Selector '{}' has no outbounds", selector_tag))?;
        let contains_target = members.iter().any(|member| member.as_str() == Some(next_tag.as_str()));
        if !contains_target {
            return Err(format!("Selector '{}' does not contain '{}'", selector_tag, next_tag));
        }

        if let Some(obj) = outbound.as_object_mut() {
            obj.insert("default".to_string(), serde_json::Value::String(next_tag.clone()));
        }
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

    let content = fs::read_to_string(&nodes_path)
        .map_err(|e| format!("Failed to read nodes: {}", e))?;

    let nodes: Vec<ProxyNode> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse nodes: {}", e))?;

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
    let config_path = get_config_dir().join("config.json");
    if config_path.exists() {
        let content = fs::read_to_string(&config_path)
            .map_err(|e| format!("Failed to read config: {}", e))?;
        return Ok(content);
    }

    // Otherwise generate a basic config from the selected node
    let nodes = get_nodes().await.unwrap_or_default();
    let selected = nodes.iter().find(|n| n.id == selected_node_id)
        .ok_or("Selected node not found")?;

    let settings = load_app_settings().unwrap_or_else(|_| default_app_settings());
    let config = apply_app_settings_to_config(build_singbox_config(selected), &settings);
    let config_str = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    fs::write(&config_path, &config_str)
        .map_err(|e| format!("Failed to write config: {}", e))?;

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
            "strategy": "ipv4_only",
            "servers": default_dns_servers()
        },
        "route": {
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
    let inbounds = config.get("inbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().map(|inbound| {
                let inbound_type = inbound.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let tag = inbound.get("tag").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let listen = inbound.get("listen").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let port = inbound.get("listen_port").and_then(|v| v.as_u64()).unwrap_or(0);

                let details = match inbound_type.as_str() {
                    "tun" => {
                        let iface = inbound.get("interface_name").and_then(|v| v.as_str()).unwrap_or("");
                        let stack = inbound.get("stack").and_then(|v| v.as_str()).unwrap_or("");
                        let mtu = inbound.get("mtu").and_then(|v| v.as_u64()).unwrap_or(0);
                        format!("TUN interface: {}, stack: {}, MTU: {}", iface, stack, mtu)
                    },
                    "mixed" => format!("{}:{}", listen, port),
                    _ => format!("{}:{}", listen, port),
                };

                InboundInfo { inbound_type, tag, listen, details }
            }).collect()
        })
        .unwrap_or_default();

    let outbounds = config.get("outbounds")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().map(|outbound| {
                let outbound_type = outbound.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
                let tag = outbound.get("tag").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let server = outbound.get("server").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let port = outbound.get("server_port").and_then(|v| v.as_u64()).unwrap_or(0) as u16;

                let is_group = matches!(outbound_type.as_str(), "selector" | "urltest");
                let group_members = if is_group {
                    outbound.get("outbounds")
                        .and_then(|v| v.as_array())
                        .map(|members| members.iter().filter_map(|m| m.as_str().map(String::from)).collect())
                        .unwrap_or_default()
                } else {
                    vec![]
                };

                let details = match outbound_type.as_str() {
                    "vless" => {
                        let flow = outbound.get("flow").and_then(|v| v.as_str()).unwrap_or("");
                        let tls_sni = outbound.get("tls")
                            .and_then(|t| t.get("server_name"))
                            .and_then(|v| v.as_str()).unwrap_or("");
                        let reality = outbound.get("tls")
                            .and_then(|t| t.get("reality"))
                            .and_then(|r| r.get("enabled"))
                            .and_then(|v| v.as_bool()).unwrap_or(false);
                        let transport = outbound.get("transport")
                            .and_then(|t| t.get("type"))
                            .and_then(|v| v.as_str()).unwrap_or("");
                        let mut desc = "VLESS".to_string();
                        if reality { desc.push_str(" + Reality"); }
                        if !flow.is_empty() { desc.push_str(&format!(" ({})", flow)); }
                        if !transport.is_empty() { desc.push_str(&format!(" + {}", transport.to_uppercase())); }
                        if !tls_sni.is_empty() { desc.push_str(&format!(" [SNI: {}]", tls_sni)); }
                        desc
                    },
                    "shadowsocks" => {
                        let method = outbound.get("method").and_then(|v| v.as_str()).unwrap_or("");
                        format!("Shadowsocks ({})", method)
                    },
                    "trojan" => "Trojan".to_string(),
                    "vmess" => {
                        let security = outbound.get("security").and_then(|v| v.as_str()).unwrap_or("auto");
                        format!("VMess ({})", security)
                    },
                    "selector" => {
                        let default = outbound.get("default").and_then(|v| v.as_str()).unwrap_or("");
                        format!("Selector [default: {}]", default)
                    },
                    "urltest" => {
                        let interval = outbound.get("interval").and_then(|v| v.as_str()).unwrap_or("");
                        let tolerance = outbound.get("tolerance").and_then(|v| v.as_u64()).unwrap_or(0);
                        format!("Auto Test [interval: {}, tolerance: {}ms]", interval, tolerance)
                    },
                    "direct" => "Direct".to_string(),
                    "block" => "Block".to_string(),
                    _ => outbound_type.clone(),
                };

                OutboundInfo { outbound_type, tag, server, port, details, is_group, group_members }
            }).collect()
        })
        .unwrap_or_default();

    let dns_servers = config.get("dns")
        .and_then(|d| d.get("servers"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().map(|srv| {
                DnsServerInfo {
                    tag: srv.get("tag").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    dns_type: srv.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    server: srv.get("server").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                }
            }).collect()
        })
        .unwrap_or_default();

    let route_rules_count = config.get("route")
        .and_then(|r| r.get("rules"))
        .and_then(|v| v.as_array())
        .map(|arr| arr.len())
        .unwrap_or(0);

    let route_rules = config.get("route")
        .and_then(|r| r.get("rules"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().map(|rule| {
                let rule_type = rule.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let action = rule.get("action").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let outbound = rule.get("outbound").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let summary = summarize_route_rule(rule);
                RouteRuleInfo {
                    summary,
                    rule_type,
                    action,
                    outbound,
                    raw: rule.clone(),
                }
            }).collect()
        })
        .unwrap_or_default();

    let rule_sets = config.get("route")
        .and_then(|r| r.get("rule_set"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().map(|rs| {
                RuleSetInfo {
                    tag: rs.get("tag").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    rule_type: rs.get("type").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    format: rs.get("format").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    url: rs.get("url").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                }
            }).collect()
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
                let items: Vec<String> = array.iter().filter_map(|item| {
                    item.as_str().map(String::from).or_else(|| {
                        item.as_u64().map(|n| n.to_string())
                    })
                }).collect();
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

fn get_config_dir() -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    fs::create_dir_all(&config_dir).ok();
    config_dir
}

fn get_config_profiles_dir() -> std::path::PathBuf {
    let dir = get_config_dir().join("profiles-store");
    fs::create_dir_all(&dir).ok();
    dir
}

fn get_settings_file_path() -> std::path::PathBuf {
    get_config_dir().join("settings.json")
}

fn get_config_profiles_file_path() -> std::path::PathBuf {
    get_config_dir().join("config-profiles.json")
}

fn get_active_config_profile_file_path() -> std::path::PathBuf {
    get_config_dir().join("active-profile.txt")
}

fn get_nodes_file_path() -> String {
    get_config_dir().join("nodes.json").to_string_lossy().to_string()
}

fn save_nodes(nodes: &[ProxyNode]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(nodes)
        .map_err(|e| format!("Failed to serialize nodes: {}", e))?;
    let path = get_nodes_file_path();
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save nodes: {}", e))?;
    Ok(())
}

fn save_profiles(profiles: &[Profile]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    let path = get_config_dir().join("profiles.json");
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save profiles: {}", e))?;
    Ok(())
}

fn load_config_profiles() -> Result<Vec<ConfigProfile>, String> {
    let path = get_config_profiles_file_path();
    if !path.exists() {
        return Ok(vec![]);
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read config profiles: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse config profiles: {}", e))
}

fn save_config_profiles(profiles: &[ConfigProfile]) -> Result<(), String> {
    let content = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("Failed to serialize config profiles: {}", e))?;
    let path = get_config_profiles_file_path();
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save config profiles: {}", e))?;
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
    fs::write(&path, profile_id)
        .map_err(|e| format!("Failed to save active profile id: {}", e))?;
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
    if let Some(profile) = profiles.iter_mut().find(|profile| profile.id == active_profile_id) {
        profile.updated_at = current_unix_timestamp();
        save_config_profiles(&profiles)?;
    }

    Ok(())
}

fn save_imported_config_profile(source_path: &str, config: &serde_json::Value) -> Result<ConfigProfile, String> {
    let mut profiles = load_config_profiles()?;
    let id = Uuid::new_v4().to_string();
    let now = current_unix_timestamp();
    let name = Path::new(source_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Imported Profile")
        .to_string();

    let profile = ConfigProfile {
        id: id.clone(),
        name,
        source_path: source_path.to_string(),
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

fn activate_config_profile_internal(profile_id: &str) -> Result<ImportResult, String> {
    let profiles = load_config_profiles()?;
    let profile = profiles.iter()
        .find(|profile| profile.id == profile_id)
        .ok_or_else(|| format!("Profile '{}' not found", profile_id))?;

    let profile_path = get_config_profiles_dir().join(format!("{}.json", profile.id));
    let content = fs::read_to_string(&profile_path)
        .map_err(|e| format!("Failed to read saved profile config: {}", e))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse saved profile config: {}", e))?;

    let runtime_config_path = get_config_dir().join("config.json");
    let runtime_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize runtime config: {}", e))?;
    fs::write(&runtime_config_path, runtime_content)
        .map_err(|e| format!("Failed to activate profile config: {}", e))?;

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
    let config_dir = get_config_dir();
    for file_name in ["config.json", "nodes.json", "profiles.json"] {
        let path = config_dir.join(file_name);
        if path.exists() {
            fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove {}: {}", file_name, e))?;
        }
    }
    Ok(())
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

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))
}

fn save_app_settings_file(settings: &AppSettings) -> Result<(), String> {
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let path = get_settings_file_path();
    fs::write(&path, content)
        .map_err(|e| format!("Failed to save settings: {}", e))?;
    Ok(())
}

fn infer_settings_from_config(config: &serde_json::Value) -> AppSettings {
    let mut settings = default_app_settings();

    if let Some(inbounds) = config.get("inbounds").and_then(|v| v.as_array()) {
        if let Some(mixed) = inbounds.iter().find(|ib| {
            ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed"
        }) {
            settings.mixed_listen = mixed.get("listen")
                .and_then(|v| v.as_str())
                .unwrap_or("127.0.0.1")
                .to_string();
            settings.mixed_port = mixed.get("listen_port")
                .and_then(|v| v.as_u64())
                .unwrap_or(7890) as u16;
        }

        if let Some(tun) = inbounds.iter().find(|ib| {
            ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "tun"
        }) {
            settings.tun_enabled = true;
            settings.tun_interface_name = tun.get("interface_name")
                .and_then(|v| v.as_str())
                .unwrap_or("singbox")
                .to_string();
            settings.tun_mtu = tun.get("mtu").and_then(|v| v.as_u64()).unwrap_or(9000);
            settings.tun_stack = tun.get("stack")
                .and_then(|v| v.as_str())
                .unwrap_or("mixed")
                .to_string();
            settings.tun_auto_route = tun.get("auto_route").and_then(|v| v.as_bool()).unwrap_or(true);
            settings.tun_strict_route = tun.get("strict_route").and_then(|v| v.as_bool()).unwrap_or(true);
            settings.tun_sniff = tun.get("sniff").and_then(|v| v.as_bool()).unwrap_or(true);
            settings.tun_sniff_override_destination = tun.get("sniff_override_destination")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            settings.tun_address = tun.get("address")
                .and_then(|v| v.as_array())
                .map(|items| items.iter().filter_map(|item| item.as_str().map(String::from)).collect())
                .unwrap_or_else(|| vec!["172.19.0.1/30".to_string()]);
        }
    }

    if let Some(dns) = config.get("dns") {
        settings.dns_final = dns.get("final")
            .and_then(|v| v.as_str())
            .unwrap_or("google")
            .to_string();
        settings.dns_strategy = dns.get("strategy")
            .and_then(|v| v.as_str())
            .unwrap_or("ipv4_only")
            .to_string();
        settings.dns_servers = dns.get("servers")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_else(default_dns_servers);
    }

    settings
}

fn apply_app_settings_to_config(mut config: serde_json::Value, settings: &AppSettings) -> serde_json::Value {
    if !config.is_object() {
        config = serde_json::json!({});
    }

    if config.get("inbounds").and_then(|v| v.as_array()).is_none() {
        config["inbounds"] = serde_json::json!([]);
    }

    if let Some(inbounds) = config.get_mut("inbounds").and_then(|v| v.as_array_mut()) {
        if let Some(mixed) = inbounds.iter_mut().find(|ib| {
            ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "mixed"
        }) {
            if let Some(obj) = mixed.as_object_mut() {
                obj.insert("tag".to_string(), serde_json::Value::String("mixed-in".to_string()));
                obj.insert("listen".to_string(), serde_json::Value::String(settings.mixed_listen.clone()));
                obj.insert("listen_port".to_string(), serde_json::Value::Number(settings.mixed_port.into()));
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
            if let Some(tun) = inbounds.iter_mut().find(|ib| {
                ib.get("type").and_then(|v| v.as_str()).unwrap_or("") == "tun"
            }) {
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
                inbounds.insert(0, serde_json::json!({
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
                }));
            }
        }
    }

    if config.get("dns").and_then(|v| v.as_object()).is_none() {
        config["dns"] = serde_json::json!({});
    }

    if let Some(dns) = config.get_mut("dns").and_then(|v| v.as_object_mut()) {
        dns.insert("final".to_string(), serde_json::Value::String(settings.dns_final.clone()));
        dns.insert("strategy".to_string(), serde_json::Value::String(settings.dns_strategy.clone()));
        dns.insert("servers".to_string(), serde_json::Value::Array(settings.dns_servers.clone()));
    }

    config
}

/// Sanitize config for sing-box 1.12.0 compatibility:
/// - Remove DNS servers with type "block" (unsupported)
/// - Move per-server "strategy" to DNS top-level
/// - Remove "sniff_override_destination" from route rule sniff actions
/// - Ensure a "mixed" inbound exists on port 7890 for system proxy fallback
fn sanitize_config_for_v1_12(mut config: serde_json::Value) -> serde_json::Value {
    // Fix DNS section
    if let Some(dns) = config.get_mut("dns") {
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
            servers.retain(|s| {
                s.get("type").and_then(|t| t.as_str()).unwrap_or("") != "block"
            });
            // Add strategy to DNS top-level if not already present
            if let Some(strategy) = found_strategy {
                if let Some(dns_obj) = dns.as_object_mut() {
                    dns_obj.entry("strategy").or_insert(strategy);
                }
            }
        }
    }

    // Fix route rules: remove sniff_override_destination from sniff actions
    if let Some(route) = config.get_mut("route") {
        if let Some(rules) = route.get_mut("rules").and_then(|r| r.as_array_mut()) {
            for rule in rules.iter_mut() {
                if let Some(obj) = rule.as_object_mut() {
                    let is_sniff = obj.get("action")
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

    // Ensure a "mixed" inbound (HTTP+SOCKS5) exists on port 7890 for system proxy
    if config.get("inbounds").and_then(|v| v.as_array()).is_none() {
        config["inbounds"] = serde_json::json!([]);
    }

    if let Some(inbounds) = config.get_mut("inbounds").and_then(|i| i.as_array_mut()) {
        let has_mixed = inbounds.iter().any(|ib| {
            ib.get("type").and_then(|t| t.as_str()).unwrap_or("") == "mixed"
        });
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
