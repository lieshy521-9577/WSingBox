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
