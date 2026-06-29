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
  Sparkles,
  Network,
  Zap,
  Globe,
} from "lucide-react";
import { ProxyNode, PROTOCOL_LABELS, ProtocolType } from "../types";
import { Profile } from "../hooks/useSingbox";

interface LatencyResult {
  node_id: string;
  latency_ms: number;
  status: string;
}

interface NodeListProps {
  nodes: ProxyNode[];
  profiles: Profile[];
  selectedOutboundTag: string | null;
  hasConfig: boolean;
  onSelect: (tag: string) => void;
  onRemove: (id: string) => void;
  onRemoveGroup: (tag: string) => void;
  onAdd: () => void;
  onEdit: (node: ProxyNode) => void;
}

function NodeList({
  nodes,
  profiles,
  selectedOutboundTag,
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

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  const topSelectorTag = profiles.find((p) => p.profile_type === "selector")?.tag ?? profiles[0]?.tag ?? null;
  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => !(profile.tag === "proxy" && profile.profile_type === "selector")),
    [profiles]
  );
  const activeGroup = profiles.find((profile) => profile.tag === selectedOutboundTag) ?? null;
  const activeNode = nodes.find((node) => node.id === selectedOutboundTag) ?? null;
  const resolveLatencyMode = (nodeType: string) => {
    if (latencyMode !== "auto") {
      return latencyMode;
    }

    return ["shadowsocks", "vmess", "trojan", "vless", "hysteria2", "tuic", "wireguard"].includes(nodeType)
      ? "http"
      : "connect";
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
            nodeId: node.id,
            nodeType: node.node_type,
            server: node.server,
            port: node.port,
            settings: node.settings,
            mode: resolveLatencyMode(node.node_type),
          });
          setLatencies((prev) => ({ ...prev, [node.id]: result }));
        } catch {
          setLatencies((prev) => ({
            ...prev,
            [node.id]: { node_id: node.id, latency_ms: -1, status: "error" },
          }));
        }
      };

      const workers = Array.from({ length: concurrency }, async () => {
        while (cursor < testableNodes.length) {
          const node = testableNodes[cursor];
          cursor += 1;
          await runSingleTest(node);
        }
      });

      await Promise.all(workers);
    } finally {
      setTesting(false);
    }
  }, [latencyMode, nodes]);

  const renderLatency = (nodeId: string) => {
    const result = latencies[nodeId];
    if (!result) return null;

    if (result.status === "ok") {
      const ms = result.latency_ms;
      let color = "text-green-500 dark:text-green-400";
      if (ms > 300) color = "text-yellow-500 dark:text-yellow-400";
      if (ms > 800) color = "text-red-500 dark:text-red-400";
      return <span className={`text-xs font-mono ${color}`}>{ms}ms</span>;
    }
    if (result.status === "timeout") {
      return <span className="text-xs font-mono text-red-500 dark:text-red-400">Timeout</span>;
    }
    return <span className="text-xs font-mono text-red-500 dark:text-red-400">Failed</span>;
  };

  const toggleGroup = (tag: string) => {
    setExpandedGroups((prev) => ({ ...prev, [tag]: !prev[tag] }));
  };

  const resolveMemberNodeTags = useCallback((memberTags: string[], visited = new Set<string>()) => {
    const resolved: string[] = [];

    for (const tag of memberTags) {
      if (nodeMap[tag]) {
        resolved.push(tag);
        continue;
      }

      if (visited.has(tag)) {
        continue;
      }

      const memberProfile = profiles.find((profile) => profile.tag === tag);
      if (memberProfile) {
        visited.add(tag);
        resolved.push(...resolveMemberNodeTags(memberProfile.outbounds, visited));
      }
    }

    return resolved;
  }, [nodeMap, profiles]);

  const renderGroupLatency = (memberTags: string[]) => {
    const candidates = resolveMemberNodeTags(memberTags)
      .map((tag) => latencies[tag])
      .filter((result): result is LatencyResult => !!result && result.status === "ok");

    if (candidates.length === 0) return null;

    const fastest = candidates.reduce((best, current) =>
      current.latency_ms < best.latency_ms ? current : best
    );

    let color = "text-green-500 dark:text-green-400";
    if (fastest.latency_ms > 300) color = "text-yellow-500 dark:text-yellow-400";
    if (fastest.latency_ms > 800) color = "text-red-500 dark:text-red-400";

    return (
      <span className={`text-[10px] font-mono ${color}`}>
        best {fastest.latency_ms}ms
      </span>
    );
  };

  const resolveActiveNodeFromProfile = useCallback((profileTag: string, visited = new Set<string>()): string | null => {
    if (visited.has(profileTag)) {
      return null;
    }

    const profile = profiles.find((item) => item.tag === profileTag);
    if (!profile) {
      return null;
    }

    visited.add(profileTag);

    if (profile.profile_type === "urltest") {
      const candidates = resolveMemberNodeTags(profile.outbounds)
        .map((tag) => latencies[tag])
        .filter((result): result is LatencyResult => !!result && result.status === "ok");

      if (candidates.length === 0) {
        return null;
      }

      return candidates.reduce((best, current) =>
        current.latency_ms < best.latency_ms ? current : best
      ).node_id;
    }

    const nextTargets = [profile.default_outbound, ...profile.outbounds].filter(Boolean);
    for (const target of nextTargets) {
      if (nodeMap[target]) {
        return target;
      }

      const nested = resolveActiveNodeFromProfile(target, visited);
      if (nested) {
        return nested;
      }
    }

    return null;
  }, [latencies, nodeMap, profiles, resolveMemberNodeTags]);

  const activeResolvedNodeId = useMemo(() => {
    if (activeNode) {
      return activeNode.id;
    }

    if (activeGroup) {
      return resolveActiveNodeFromProfile(activeGroup.tag);
    }

    return null;
  }, [activeGroup, activeNode, resolveActiveNodeFromProfile]);

  useEffect(() => {
    if (testing || nodes.length === 0 || Object.keys(latencies).length > 0) {
      return;
    }

    void testAllLatency();
  }, [latencies, nodes.length, testAllLatency, testing]);

  return (
    <div className="space-y-5">
      <div className="panel-card rounded-[24px] p-5">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div>
              <p className="section-label mb-2">Nodes & Groups</p>
              <h2 className="text-[1.35rem] font-semibold tracking-tight text-content">Outbound selection workspace</h2>
              <p className="mt-2 max-w-2xl text-[13px] leading-5 text-content-secondary">
                Review selector groups, choose direct nodes, and compare latency before switching the active route target.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <SummaryPill
                icon={<Sparkles size={13} />}
                label="Current target"
                value={activeGroup?.tag ?? activeNode?.name ?? "Not selected"}
              />
              <SummaryPill
                icon={<Layers3 size={13} />}
                label="Groups"
                value={`${visibleProfiles.length} configured`}
              />
              <SummaryPill
                icon={<Network size={13} />}
                label="Nodes"
                value={`${nodes.length} available`}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:self-end">
            <ModeToggle
              value={latencyMode}
              onChange={setLatencyMode}
              options={[
                { value: "auto", label: "Auto", icon: <Zap size={13} /> },
                { value: "connect", label: "Connect", icon: <Server size={13} /> },
                { value: "http", label: "HTTP", icon: <Globe size={13} /> },
              ]}
            />
            <button
              onClick={testAllLatency}
              disabled={testing || nodes.length === 0}
              className={`btn-secondary flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm transition-colors ${
                testing ? "cursor-not-allowed opacity-70" : ""
              }`}
            >
              <Activity size={14} className={testing ? "animate-pulse" : ""} />
              {testing ? "Testing..." : `Test ${latencyMode === "auto" ? "Auto" : latencyMode === "connect" ? "Connect" : "HTTP"}`}
            </button>
            <button
              onClick={onAdd}
              className="btn-primary flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm transition-colors"
            >
              <Plus size={14} />
              Add Node
            </button>
          </div>
        </div>

      </div>

      {visibleProfiles.length > 0 && (
        <div className="panel-card rounded-[24px] p-4">
          <div className="mb-3 flex items-center justify-between px-2">
            <div>
              <h3 className="text-sm font-semibold text-content">Outbound Groups</h3>
              <p className="text-[11px] text-content-muted">Expand a group to inspect members and select a nested route target.</p>
            </div>
            <span className="status-chip">{visibleProfiles.length}</span>
          </div>
          <div className="space-y-2">
            {visibleProfiles.map((profile) => (
              <div key={profile.tag} className="panel-card overflow-hidden rounded-[24px]">
                <div
                  onClick={() => onSelect(profile.tag)}
                  className={`flex cursor-pointer items-center gap-2 px-4 py-3 transition-all ${
                    selectedOutboundTag === profile.tag ? "bg-primary-600/10" : "hover:bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleGroup(profile.tag);
                    }}
                    className="rounded-xl p-1.5 text-content-secondary hover:bg-surface-elevated hover:text-content"
                  >
                    {expandedGroups[profile.tag] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div className="shrink-0">
                    {selectedOutboundTag === profile.tag ? (
                      <CheckCircle2 size={18} className="text-primary-500" />
                    ) : (
                      <Layers3 size={16} className="text-yellow-500 dark:text-yellow-400" />
                    )}
                  </div>
                  <span className="text-sm font-medium text-content">{profile.tag}</span>
                  <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">
                    {profile.profile_type}
                  </span>
                  {topSelectorTag === profile.tag && (
                    <span className="rounded bg-primary-600/15 px-1.5 py-0.5 text-[10px] text-primary-600 dark:text-primary-400">
                      primary
                    </span>
                  )}
                  {profile.default_outbound && (
                    <span className="ml-auto text-[10px] text-content-secondary">
                      default: {profile.default_outbound}
                    </span>
                  )}
                  {profile.interval && (
                    <span className="text-[10px] text-content-secondary">
                      interval: {profile.interval}
                    </span>
                  )}
                  {selectedOutboundTag === profile.tag && activeResolvedNodeId && (
                    <span className="rounded bg-primary-600/15 px-1.5 py-0.5 text-[10px] text-primary-600 dark:text-primary-400">
                      routed: {nodeMap[activeResolvedNodeId]?.name ?? activeResolvedNodeId}
                    </span>
                  )}
                  {renderGroupLatency(profile.outbounds)}
                  {hasConfig && topSelectorTag !== profile.tag && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveGroup(profile.tag);
                      }}
                      className="ml-1 rounded-xl p-1.5 text-content-muted transition-colors hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400"
                      title="Delete group"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {expandedGroups[profile.tag] && (
                  <div className="border-t border-border/70 bg-surface-base/40 px-3 py-3">
                    <div className="space-y-1.5">
                      {profile.outbounds.map((memberTag) => {
                        const memberNode = nodeMap[memberTag];
                        const memberProfile = profiles.find((item) => item.tag === memberTag);
                        const isSelected = selectedOutboundTag === memberTag;

                        return (
                          <button
                            key={`${profile.tag}-${memberTag}`}
                            type="button"
                            onClick={() => onSelect(memberTag)}
                            className={`flex w-full items-center gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all ${
                              isSelected
                                ? "border-primary-500/30 bg-primary-600/10"
                                : "border-transparent bg-card/40 hover:border-border hover:bg-card"
                            }`}
                          >
                            <div className="shrink-0">
                              {isSelected ? (
                                <CheckCircle2 size={16} className="text-primary-500" />
                              ) : memberProfile ? (
                                <Layers3 size={14} className="text-yellow-500 dark:text-yellow-400" />
                              ) : (
                                <Server size={14} className="text-content-muted" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-medium text-content">{memberTag}</span>
                                {memberProfile && (
                                  <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">
                                    {memberProfile.profile_type}
                                  </span>
                                )}
                                {memberNode && (
                                  <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                                    {PROTOCOL_LABELS[memberNode.node_type as ProtocolType] || memberNode.node_type}
                                  </span>
                                )}
                              </div>
                              {memberNode && (
                                <p className="mt-0.5 truncate text-[11px] text-content-secondary">
                                  {memberNode.server}{memberNode.port > 0 ? `:${memberNode.port}` : ""}
                                </p>
                              )}
                            </div>
                            {memberNode && renderLatency(memberNode.id)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {nodes.length === 0 ? (
        <div className="panel-card flex flex-col items-center justify-center rounded-[24px] py-16 text-content-muted">
          <Server size={48} className="mb-4 opacity-30" />
          <p className="text-sm">No nodes configured</p>
          <p className="mt-1 text-xs opacity-60">
            Click "Add Node" or import a sing-box config to get started
          </p>
        </div>
      ) : (
        <div className="panel-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center justify-between px-2">
            <div>
              <h3 className="text-sm font-semibold text-content">Proxy Nodes</h3>
              <p className="text-[11px] text-content-muted">Compact node list for quick target switching.</p>
            </div>
            <span className="status-chip">{nodes.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2 2xl:grid-cols-3">
            {nodes.map((node) => {
              const isSelected = node.id === selectedOutboundTag;
              const isResolvedActive = !isSelected && activeResolvedNodeId === node.id;
              const protocolLabel =
                PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

              return (
                <div
                  key={node.id}
                  onClick={() => onSelect(node.id)}
                  className={`flex cursor-pointer items-center gap-3 rounded-[20px] border px-3 py-2.5 transition-all ${
                    isSelected
                      ? "border-primary-500/30 bg-primary-600/10"
                      : isResolvedActive
                        ? "border-emerald-500/30 bg-emerald-500/8"
                        : "subtle-row"
                  }`}
                >
                  <div className="shrink-0">
                    {isSelected ? (
                      <CheckCircle2 size={18} className="text-primary-500" />
                    ) : isResolvedActive ? (
                      <CheckCircle2 size={18} className="text-emerald-500" />
                    ) : (
                      <div className="h-[18px] w-[18px] rounded-full border-2 border-surface-muted" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-content">{node.name}</span>
                      {isSelected && <span className="status-chip status-chip-primary">Active</span>}
                      {isResolvedActive && <span className="status-chip">Routed</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-xl bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">
                        {protocolLabel}
                      </span>
                      {renderLatency(node.id)}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(node);
                      }}
                      className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
                      title="Edit node"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(node.id);
                      }}
                      className="rounded-xl p-1.5 text-content-muted transition-colors hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400"
                    >
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
  );
}

function ModeToggle({
  value,
  onChange,
  options,
}: {
  value: "auto" | "connect" | "http";
  onChange: (value: "auto" | "connect" | "http") => void;
  options: Array<{
    value: "auto" | "connect" | "http";
    label: string;
    icon: React.ReactNode;
  }>;
}) {
  return (
    <div className="mode-toggle">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`mode-toggle-button ${active ? "active" : ""}`}
            aria-pressed={active}
          >
            <span>{option.icon}</span>
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
function SummaryPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface-block flex items-center gap-2 rounded-full px-3 py-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-elevated text-content-secondary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
        <p className="truncate text-xs font-medium text-content">{value}</p>
      </div>
    </div>
  );
}

export default NodeList;
