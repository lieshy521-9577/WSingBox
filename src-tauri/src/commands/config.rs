use serde::{Deserialize, Serialize};
use std::fs;
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
}

/// Overview of an imported sing-box configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConfigOverview {
    pub file_path: String,
    pub inbounds: Vec<InboundInfo>,
    pub outbounds: Vec<OutboundInfo>,
    pub dns_servers: Vec<DnsServerInfo>,
    pub route_rules_count: usize,
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

/// Non-proxy outbound types that should NOT be extracted as nodes
const SPECIAL_OUTBOUND_TYPES: &[&str] = &["direct", "block", "dns", "selector", "urltest"];

/// Import a sing-box config file: parse overview, extract nodes, determine active profile
#[tauri::command]
pub async fn import_config_file(file_path: String) -> Result<ImportResult, String> {
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read config file: {}", e))?;

    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    // Sanitize config for sing-box 1.12.0 compatibility
    let config = sanitize_config_for_v1_12(config);

    // Save the sanitized config to our working directory (used by sing-box directly)
    let config_dir = get_config_dir();
    let dest_path = config_dir.join("config.json");
    let sanitized_content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;
    fs::write(&dest_path, &sanitized_content)
        .map_err(|e| format!("Failed to save config: {}", e))?;

    // Parse overview
    let overview = parse_config_overview(&file_path, &config);

    // Extract proxy nodes from outbounds
    let nodes = extract_nodes_from_config(&config);
    save_nodes(&nodes)?;

    // Extract profiles (selector/urltest)
    let profiles = extract_profiles(&config);

    // Determine active node based on profile hierarchy:
    // selector -> its default -> if default is urltest -> urltest's first outbound
    let active_node = determine_active_node(&profiles, &nodes);

    // Save profiles
    save_profiles(&profiles)?;

    Ok(ImportResult {
        overview,
        nodes,
        profiles,
        active_node,
    })
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

    let path_str = config_path.to_string_lossy().to_string();
    Ok(Some(parse_config_overview(&path_str, &config)))
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

    let config = build_singbox_config(selected);
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
    let config_path = get_config_dir().join("config.json");
    Ok(config_path.exists())
}

/// Clear all configuration: nodes, profiles, and imported config
#[tauri::command]
pub async fn clear_config() -> Result<String, String> {
    let config_dir = get_config_dir();

    // Remove config.json
    let config_path = config_dir.join("config.json");
    if config_path.exists() {
        fs::remove_file(&config_path)
            .map_err(|e| format!("Failed to remove config: {}", e))?;
    }

    // Remove nodes.json
    let nodes_path = config_dir.join("nodes.json");
    if nodes_path.exists() {
        fs::remove_file(&nodes_path)
            .map_err(|e| format!("Failed to remove nodes: {}", e))?;
    }

    // Remove profiles.json
    let profiles_path = config_dir.join("profiles.json");
    if profiles_path.exists() {
        fs::remove_file(&profiles_path)
            .map_err(|e| format!("Failed to remove profiles: {}", e))?;
    }

    Ok("Configuration cleared".to_string())
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
        rule_sets,
    }
}

fn get_config_dir() -> std::path::PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let config_dir = home.join(".singbox-client");
    fs::create_dir_all(&config_dir).ok();
    config_dir
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
