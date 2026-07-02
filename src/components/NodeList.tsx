import { useState, useCallback, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Plus,
  Trash2,
  Server,
  CheckCircle2,
  Activity,
  Layers3,
  ChevronDown,
  ChevronRight,
  Pencil,
  Zap,
  Globe,
  X,
} from "lucide-react";
import { ProxyNode, PROTOCOL_LABELS, ProtocolType } from "../types";
import { Profile, RuntimeDebugSnapshot, RuntimePhase } from "../hooks/useSingbox";

interface LatencyResult {
  node_id: string;
  latency_ms: number;
  status: string;
}

interface NodeListProps {
  nodes: ProxyNode[];
  profiles: Profile[];
  selectedOutboundTag: string | null;
  runtimeDebug: RuntimeDebugSnapshot | null;
  runtimePhase: RuntimePhase;
  isRunning: boolean;
  hasConfig: boolean;
  onSelect: (tag: string) => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (tag: string) => void;
  onAdd: () => void;
  onEdit: (node: ProxyNode) => void;
}

/* ── Flag emoji mapping ── */
const FLAG_MAP: Record<string, string> = {
  US: "\u{1F1FA}\u{1F1F8}", HK: "\u{1F1ED}\u{1F1F0}", JP: "\u{1F1EF}\u{1F1F5}",
  SG: "\u{1F1F8}\u{1F1EC}", KR: "\u{1F1F0}\u{1F1F7}", TW: "\u{1F1F9}\u{1F1FC}",
  DE: "\u{1F1E9}\u{1F1EA}", NL: "\u{1F1F3}\u{1F1F1}", GB: "\u{1F1EC}\u{1F1E7}",
  FR: "\u{1F1EB}\u{1F1F7}", CA: "\u{1F1E8}\u{1F1E6}", AU: "\u{1F1E6}\u{1F1FA}",
  RU: "\u{1F1F7}\u{1F1FA}", IN: "\u{1F1EE}\u{1F1F3}", BR: "\u{1F1E7}\u{1F1F7}",
  UA: "\u{1F1FA}\u{1F1E6}", SE: "\u{1F1F8}\u{1F1EA}", CH: "\u{1F1E8}\u{1F1ED}",
};

function guessFlag(tag: string): string {
  const upper = tag.toUpperCase();
  for (const [code, flag] of Object.entries(FLAG_MAP)) {
    if (upper.includes(code)) return flag;
  }
  return "\u{1F310}"; // globe
}

function NodeList({
  nodes,
  profiles,
  selectedOutboundTag,
  runtimeDebug,
  runtimePhase,
  isRunning,
  hasConfig,
  onSelect,
  onRemove,
  onRemoveGroup,
  onAdd,
  onEdit,
}: NodeListProps) {
  const [latencies, setLatencies] = useState<Record<string, LatencyResult>>({});
  const [testing, setTesting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [latencyMode, setLatencyMode] = useState<"auto" | "connect" | "http">("auto");
  const [selectedDetailNode, setSelectedDetailNode] = useState<ProxyNode | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  const topSelectorTag = profiles.find((p) => p.profile_type === "selector")?.tag ?? profiles[0]?.tag ?? null;
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !(profile.tag === "proxy" && profile.profile_type === "selector")),
    [profiles]
  );
  const resolveLatencyMode = (nodeType: string) => {
    if (latencyMode !== "auto") return latencyMode;
    return ["shadowsocks", "vmess", "trojan", "vless", "hysteria2", "tuic", "wireguard"].includes(nodeType)
      ? "http" : "connect";
  };

  const testAllLatency = useCallback(async () => {
    setTesting(true);
    try {
      const testableNodes = nodes.filter((node) => node.server && node.port !== 0);
      const concurrency = Math.min(4, Math.max(1, testableNodes.length));
      let cursor = 0;

      const runSingleTest = async (node: ProxyNode) => {
        try {
          const result = await invoke<LatencyResult>("test_node_latency", {
            nodeId: node.id, nodeType: node.node_type, server: node.server,
            port: node.port, settings: node.settings, mode: resolveLatencyMode(node.node_type),
          });
          setLatencies((prev) => ({ ...prev, [node.id]: result }));
        } catch {
          setLatencies((prev) => ({ ...prev, [node.id]: { node_id: node.id, latency_ms: -1, status: "error" } }));
        }
      };

      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < testableNodes.length) { const node = testableNodes[cursor]; cursor += 1; await runSingleTest(node); }
      });
      await Promise.all(workers);
    } finally { setTesting(false); }
  }, [latencyMode, nodes]);

  const renderLatency = (nodeId: string) => {
    const result = latencies[nodeId];
    if (!result) return null;
    if (result.status === "ok") {
      const ms = result.latency_ms;
      let color = "text-green-500";
      if (ms > 300) color = "text-yellow-500";
      if (ms > 800) color = "text-red-500";
      return <span className={`text-xs font-mono tabular-nums ${color}`}>{ms}ms</span>;
    }
    if (result.status === "timeout") return <span className="text-xs text-red-500">Timeout</span>;
    return <span className="text-xs text-red-500">Failed</span>;
  };

  const toggleGroup = (tag: string) => setExpandedGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));

  const resolveMemberNodeTags = useCallback((memberTags: string[], visited = new Set<string>()) => {
    const resolved: string[] = [];
    for (const tag of memberTags) {
      if (nodeMap[tag]) { resolved.push(tag); continue; }
      if (visited.has(tag)) continue;
      const memberProfile = profiles.find((p) => p.tag === tag);
      if (memberProfile) { visited.add(tag); resolved.push(...resolveMemberNodeTags(memberProfile.outbounds, visited)); }
    }
    return resolved;
  }, [nodeMap, profiles]);

  const renderGroupLatency = (memberTags: string[]) => {
    const candidates = resolveMemberNodeTags(memberTags)
      .map((tag) => latencies[tag])
      .filter((result): result is LatencyResult => !!result && result.status === "ok");
    if (candidates.length === 0) return null;
    const fastest = candidates.reduce((best, c) => c.latency_ms < best.latency_ms ? c : best);
    let color = "text-green-500";
    if (fastest.latency_ms > 300) color = "text-yellow-500";
    if (fastest.latency_ms > 800) color = "text-red-500";
    return (
      <span className={`rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-mono ${color}`}>
        best {fastest.latency_ms}ms
      </span>
    );
  };

  const isRuntimeTransitioning = runtimePhase === "starting" || runtimePhase === "switching" || runtimePhase === "stopping";
  const runtimeGroupTag = runtimeDebug?.top_selector_default || null;
  const runtimeLeafNodeId = runtimeDebug?.active_leaf_outbound || null;

  const runtimeResolvedNodeId = useMemo(() => {
    if (!runtimeLeafNodeId) return null;
    if (nodeMap[runtimeLeafNodeId]) return runtimeLeafNodeId;
    return null;
  }, [nodeMap, runtimeLeafNodeId]);

  useEffect(() => {
    if (testing || nodes.length === 0 || Object.keys(latencies).length > 0) return;
    void testAllLatency();
  }, [latencies, nodes.length, testAllLatency, testing]);

  const handleSelectNodeRow = (node: ProxyNode) => {
    setSelectedDetailNode(node);
    setShowDetail(true);
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Header bar */}
      <div className="panel-card rounded-[22px] px-4 py-3">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">Nodes & Groups</p>
            <h2 className="text-[1.05rem] font-semibold tracking-tight text-content">Outbound selection</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <ModeToggle value={latencyMode} onChange={setLatencyMode} compact options={[
              { value: "auto", label: "Auto", icon: <Zap size={13} /> },
              { value: "connect", label: "Connect", icon: <Server size={13} /> },
              { value: "http", label: "HTTP", icon: <Globe size={13} /> },
            ]} />
            <button onClick={testAllLatency} disabled={testing || nodes.length === 0}
              className={`btn-secondary flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm transition-colors ${testing ? "cursor-not-allowed opacity-70" : ""}`}>
              <Activity size={14} className={testing ? "animate-pulse" : ""} />
              {testing ? "Testing..." : `Test All`}
            </button>
            <button onClick={onAdd} className="btn-primary flex items-center gap-1.5 rounded-2xl px-3.5 py-1.5 text-sm">
              <Plus size={14} />Add Node
            </button>
          </div>
        </div>
      </div>

      {/* Nodes layout: list | detail panel */}
      <div className="grid flex-1 gap-[18px] overflow-hidden xl:grid-cols-[minmax(0,1fr)_minmax(340px,480px)]">
        {/* Left: node list */}
        <div className="flex flex-col gap-4 overflow-auto">
          {/* Groups */}
          {visibleProfiles.length > 0 && (
            <div className="panel-card rounded-[20px]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-content">Outbound Groups</h3>
                <span className="status-chip">{visibleProfiles.length}</span>
              </div>
              {visibleProfiles.map((profile) => {
                const isLiveGroup = isRunning && !isRuntimeTransitioning && runtimeGroupTag === profile.tag;
                const isSelectedGroup = selectedOutboundTag === profile.tag;
                const showSelectedGroup = isSelectedGroup && !isLiveGroup;

                return (
                  <div key={profile.tag} className="group border-b border-border/60 last:border-b-0">
                    <div
                      onClick={() => onSelect(profile.tag)}
                      className={`flex cursor-pointer items-center gap-2 px-3.5 py-2.5 transition-all ${
                        isLiveGroup ? "bg-emerald-500/8" : showSelectedGroup ? "bg-primary-600/10" : "hover:bg-muted/30"
                      }`}
                    >
                      <button type="button" onClick={(e) => { e.stopPropagation(); toggleGroup(profile.tag); }}
                        className="rounded-xl p-1.5 text-content-secondary hover:bg-surface-elevated hover:text-content">
                        {expandedGroups[profile.tag] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <Layers3 size={15} className={`${isSelectedGroup ? "text-primary-500" : "text-yellow-500"} shrink-0`} />
                      <span className="text-sm font-medium text-content">{profile.tag}</span>
                      <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                        {profile.profile_type}
                      </span>
                      <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                        {isLiveGroup && <span className="status-chip border-emerald-500/25 bg-emerald-500/12 text-emerald-500">Live</span>}
                        {showSelectedGroup && <span className="status-chip status-chip-primary">Selected</span>}
                        <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">{profile.outbounds.length} members</span>
                        {renderGroupLatency(profile.outbounds)}
                        {topSelectorTag === profile.tag && <span className="rounded-full bg-primary-600/15 px-2 py-0.5 text-[10px] text-primary-500">default</span>}
                        {hasConfig && topSelectorTag !== profile.tag && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onRemoveGroup(profile.tag); }}
                            className="ml-1 rounded-xl p-1.5 text-content-muted opacity-0 transition-all hover:bg-red-500/20 hover:text-red-500 group-hover:opacity-100">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {expandedGroups[profile.tag] && (
                      <div className="border-t border-border/60 bg-muted/20 px-3 py-3">
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {profile.outbounds.map((memberTag) => {
                            const memberNode = nodeMap[memberTag];
                            const memberProfile = profiles.find((item) => item.tag === memberTag);
                            const isLiveNode = Boolean(isRunning && !isRuntimeTransitioning && memberNode && runtimeResolvedNodeId === memberNode.id);
                            const isSelected = selectedOutboundTag === memberTag;
                            const showSelected = isSelected && !isLiveNode;

                            return (
                              <button key={`${profile.tag}-${memberTag}`} type="button"
                                onClick={() => { onSelect(memberTag); if (memberNode) handleSelectNodeRow(memberNode); }}
                                className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-all ${
                                  isLiveNode ? "border-emerald-500/30 bg-emerald-500/8" :
                                  showSelected ? "border-primary-500/30 bg-primary-600/10" :
                                  "border-border/60 bg-card/40 hover:border-border hover:bg-card"
                                }`}>
                                {isLiveNode ? <CheckCircle2 size={15} className="shrink-0 text-emerald-500" /> :
                                 isSelected ? <CheckCircle2 size={15} className="shrink-0 text-primary-500" /> :
                                 memberProfile ? <Layers3 size={13} className="shrink-0 text-yellow-500" /> :
                                 <Server size={13} className="shrink-0 text-content-muted" />}
                                <span className="max-w-[12rem] truncate text-xs font-medium text-content">{memberTag}</span>
                                {memberProfile && <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">{memberProfile.profile_type}</span>}
                                {memberNode && <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">{PROTOCOL_LABELS[memberNode.node_type as ProtocolType] || memberNode.node_type}</span>}
                                {isLiveNode && <span className="text-[10px] text-emerald-500">Live</span>}
                                {showSelected && <span className="text-[10px] text-primary-500">Selected</span>}
                                {memberNode && renderLatency(memberNode.id)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Nodes */}
          {nodes.length === 0 ? (
            <div className="panel-card flex flex-col items-center justify-center rounded-[20px] py-12 text-content-muted">
              <Server size={40} className="mb-3 opacity-30" />
              <p className="text-sm">No nodes configured</p>
              <p className="mt-1 text-xs opacity-60">Add a node or import a profile to get started</p>
            </div>
          ) : (
            <div className="panel-card rounded-[20px]">
              <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
                <h3 className="text-sm font-semibold text-content">Proxy Nodes</h3>
                <span className="status-chip">{nodes.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 p-4 md:grid-cols-2 xl:grid-cols-3">
                {nodes.map((node) => {
                  const isSelected = node.id === selectedOutboundTag;
                  const isRuntimeNode = Boolean(isRunning && !isRuntimeTransitioning && runtimeResolvedNodeId === node.id);
                  const showSelected = isSelected && !isRuntimeNode;
                  const protocolLabel = PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

                  return (
                    <div key={node.id}
                      onClick={() => { onSelect(node.id); handleSelectNodeRow(node); }}
                      className={`group flex cursor-pointer items-center gap-3 rounded-[18px] border px-3 py-2.5 transition-all ${
                        isRuntimeNode ? "border-emerald-500/30 bg-emerald-500/8" :
                        showSelected ? "border-primary-500/30 bg-primary-600/10" :
                        "subtle-row"
                      }`}
                      title={`${node.server}${node.port > 0 ? `:${node.port}` : ""}`}>
                      {isRuntimeNode ? <CheckCircle2 size={18} className="shrink-0 text-emerald-500" /> :
                       isSelected ? <CheckCircle2 size={18} className="shrink-0 text-primary-500" /> :
                       <div className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-border-muted" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-content">{node.name}</span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <span className="rounded-xl bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">{protocolLabel}</span>
                          {isRuntimeNode && <span className="text-[10px] text-emerald-500">Live</span>}
                          {showSelected && <span className="text-[10px] text-primary-500">Selected</span>}
                          {renderLatency(node.id)}
                        </div>
                      </div>
                      <div className={`flex shrink-0 items-center gap-1 transition-opacity ${isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                        <button onClick={(e) => { e.stopPropagation(); onEdit(node); }}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content" title="Edit">
                          <Pencil size={14} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); onRemove(node.id); }}
                          className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-red-500/20 hover:text-red-500" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Right: node detail panel */}
        <div className="hidden xl:block">
          {showDetail && selectedDetailNode ? (
            <NodeDetailPanel
              node={selectedDetailNode}
              latency={latencies[selectedDetailNode.id]}
              onClose={() => setShowDetail(false)}
            />
          ) : (
            <div className="sticky top-[18px] rounded-[16px] border border-dashed border-border/70 bg-muted/20 p-8 text-center">
              <Server size={32} className="mx-auto mb-3 text-content-muted/30" />
              <p className="text-sm text-content-muted">Select a node to view details</p>
              <p className="mt-1 text-xs text-content-secondary/60">Click any node to inspect its configuration</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Node Detail Panel ── */
function NodeDetailPanel({
  node,
  latency,
  onClose,
}: {
  node: ProxyNode;
  latency: LatencyResult | undefined;
  onClose: () => void;
}) {
  const flag = guessFlag(node.name || node.id);
  const protocolLabel = PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

  const settings = typeof node.settings === "object" && node.settings !== null
    ? (node.settings as Record<string, unknown>)
    : {};

  const transport = settings.transport as string | undefined;
  const host = settings.host || settings.sni || settings.server_name || undefined;

  const latencyMs = latency?.status === "ok" ? latency.latency_ms : null;
  let latencyBarPct = 0;
  let latencyColor = "from-success to-warning";
  if (latencyMs != null) {
    latencyBarPct = Math.min(100, Math.max(5, Math.round((1 - latencyMs / 1000) * 100)));
    if (latencyMs > 800) latencyColor = "from-error to-error";
    else if (latencyMs > 300) latencyColor = "from-warning to-warning";
  }

  return (
    <div className="sticky top-[18px] rounded-[16px] border border-border bg-surface/60">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 pt-5 pb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-xl">{flag}</span>
          <div>
            <h3 className="text-base font-bold text-content">{node.name}</h3>
            <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
              {protocolLabel}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="rounded-xl p-1.5 text-content-muted hover:bg-surface-elevated hover:text-content">
          <X size={16} />
        </button>
      </div>

      {/* Latency */}
      <div className="border-b border-border/60 px-5 py-4">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">Latency</p>
        {latencyMs != null ? (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-extrabold text-success">{latencyMs}ms</span>
              <span className="text-xs text-content-muted">measured</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className={`h-full rounded-full bg-gradient-to-r ${latencyColor}`}
                style={{ width: `${latencyBarPct}%` }} />
            </div>
          </>
        ) : latency?.status === "error" ? (
          <p className="text-sm font-semibold text-error">Failed</p>
        ) : (
          <p className="text-sm text-content-muted">Not tested</p>
        )}
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4">
        <DetailKv label="Protocol" value={protocolLabel} />
        <DetailKv label="Server" value={node.server || "\u2014"} />
        <DetailKv label="Port" value={node.port > 0 ? String(node.port) : "\u2014"} />
        <DetailKv label="Transport" value={transport || "\u2014"} />
        {host && <DetailKv label="Host / SNI" value={String(host)} />}
        <DetailKv label="ID" value={node.id} />
        <DetailKv label="Status" value={latency?.status === "ok" ? "Healthy" : latency ? "Unhealthy" : "Unknown"} />
      </div>
    </div>
  );
}

function DetailKv({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-0.5 text-[11px] text-content-muted">{label}</p>
      <p className="truncate text-[13px] font-semibold text-content">{value}</p>
    </div>
  );
}

function ModeToggle({
  value, onChange, options, compact = false,
}: {
  value: "auto" | "connect" | "http";
  onChange: (value: "auto" | "connect" | "http") => void;
  options: Array<{ value: "auto" | "connect" | "http"; label: string; icon: React.ReactNode }>;
  compact?: boolean;
}) {
  return (
    <div className={`mode-toggle ${compact ? "px-0.5 py-0.5" : ""}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button key={option.value} type="button" onClick={() => onChange(option.value)}
            className={`mode-toggle-button ${compact ? "px-3 py-1.5 text-[0.72rem]" : ""} ${active ? "active" : ""}`}
            aria-pressed={active}>
            <span>{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default NodeList;
