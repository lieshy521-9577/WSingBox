/// Proxy node definition
export interface ProxyNode {
  id: string;
  name: string;
  node_type: string;
  server: string;
  port: number;
  settings: Record<string, unknown>;
}

/// Config overview from imported sing-box config
export interface ConfigOverview {
  file_path: string;
  inbounds: InboundInfo[];
  outbounds: OutboundInfo[];
  dns_servers: DnsServerInfo[];
  route_rules_count: number;
  route_rules: RouteRuleInfo[];
  rule_sets: RuleSetInfo[];
}

export interface InboundInfo {
  inbound_type: string;
  tag: string;
  listen: string;
  details: string;
}

export interface OutboundInfo {
  outbound_type: string;
  tag: string;
  server: string;
  port: number;
  details: string;
  is_group: boolean;
  group_members: string[];
}

export interface DnsServerInfo {
  tag: string;
  dns_type: string;
  server: string;
}

export interface RuleSetInfo {
  tag: string;
  rule_type: string;
  format: string;
  url: string;
}

export interface RouteRuleInfo {
  summary: string;
  rule_type: string;
  action: string;
  outbound: string;
  raw: Record<string, unknown>;
}

export interface AppSettings {
  autostart_enabled: boolean;
  tun_enabled: boolean;
  mixed_listen: string;
  mixed_port: number;
  tun_interface_name: string;
  tun_mtu: number;
  tun_stack: string;
  tun_auto_route: boolean;
  tun_strict_route: boolean;
  tun_sniff: boolean;
  tun_sniff_override_destination: boolean;
  tun_address: string[];
  dns_final: string;
  dns_strategy: string;
  dns_servers: Record<string, unknown>[];
}

export interface ConfigProfile {
  id: string;
  name: string;
  source_path: string;
  source_kind: string;
  refreshable: boolean;
  created_at: number;
  updated_at: number;
}

export interface ImportValidationReport {
  source_kind: string;
  display_name: string;
  node_count: number;
  group_count: number;
  has_tun: boolean;
  warnings: string[];
}

export interface StartupHealthItem {
  key: string;
  label: string;
  status: string;
  message: string;
}

export interface StartupHealthReport {
  ready: boolean;
  items: StartupHealthItem[];
}

/// Application state
export interface AppState {
  nodes: ProxyNode[];
  selectedNodeId: string | null;
  isRunning: boolean;
  proxyEnabled: boolean;
  logs: LogEntry[];
  configOverview: ConfigOverview | null;
}

/// Log entry
export interface LogEntry {
  id: string;
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

/// Supported protocol types
export type ProtocolType =
  | "shadowsocks"
  | "vmess"
  | "trojan"
  | "vless"
  | "hysteria2"
  | "tuic"
  | "wireguard";

/// Protocol display information
export const PROTOCOL_LABELS: Record<ProtocolType, string> = {
  shadowsocks: "Shadowsocks",
  vmess: "VMess",
  trojan: "Trojan",
  vless: "VLESS",
  hysteria2: "Hysteria 2",
  tuic: "TUIC",
  wireguard: "WireGuard",
};
