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
      <span className={`rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] font-mono ${color}`}>
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
    <div className="space-y-4">
      <div className="panel-card rounded-[24px] p-3.5">
        <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-1.5">
            <div>
              <p className="section-label mb-2">Nodes & Groups</p>
              <h2 className="text-[1.05rem] font-semibold tracking-tight text-content">Outbound selection</h2>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="status-chip">
                  Groups
                  <strong className="text-content">{visibleProfiles.length}</strong>
                </span>
                <span className="status-chip">
                  Nodes
                  <strong className="text-content">{nodes.length}</strong>
                </span>
                {activeGroup && (
                  <span className="status-chip status-chip-primary">
                    Group: {activeGroup.tag}
                  </span>
                )}
                {activeResolvedNodeId && nodeMap[activeResolvedNodeId] && (
                  <span className="status-chip border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                    Routed Node: {nodeMap[activeResolvedNodeId].name}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 xl:justify-end">
            <ModeToggle
              value={latencyMode}
              onChange={setLatencyMode}
              compact
              options={[
                { value: "auto", label: "Auto", icon: <Zap size={13} /> },
                { value: "connect", label: "Connect", icon: <Server size={13} /> },
                { value: "http", label: "HTTP", icon: <Globe size={13} /> },
              ]}
            />
            <button
              onClick={testAllLatency}
              disabled={testing || nodes.length === 0}
              className={`btn-secondary flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-sm transition-colors ${
                testing ? "cursor-not-allowed opacity-70" : ""
              }`}
            >
              <Activity size={14} className={testing ? "animate-pulse" : ""} />
              {testing ? "Testing..." : `Test ${latencyMode === "auto" ? "Auto" : latencyMode === "connect" ? "Connect" : "HTTP"}`}
            </button>
            <button
              onClick={onAdd}
              className="btn-primary flex items-center gap-1.5 rounded-2xl px-3.5 py-1.5 text-sm transition-colors"
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
            <h3 className="text-sm font-semibold text-content">Outbound Groups</h3>
            <span className="status-chip">{visibleProfiles.length}</span>
          </div>
          <div className="overflow-hidden rounded-[20px] border border-border/70 bg-surface-base/30">
            {visibleProfiles.map((profile) => (
              <div key={profile.tag} className="group border-b border-border/60 last:border-b-0">
                <div
                  onClick={() => onSelect(profile.tag)}
                  className={`flex cursor-pointer items-center gap-2 px-3.5 py-2.5 transition-all ${
                    selectedOutboundTag === profile.tag ? "bg-primary-600/10" : "hover:bg-surface-elevated/60"
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
                  <Layers3 size={15} className={`${selectedOutboundTag === profile.tag ? "text-primary-500" : "text-yellow-500 dark:text-yellow-400"} shrink-0`} />
                  <span className="text-sm font-medium text-content">{profile.tag}</span>
                  <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] text-yellow-600 dark:text-yellow-400">
                    {profile.profile_type}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                    {selectedOutboundTag === profile.tag && <span className="status-chip status-chip-primary">Active</span>}
                    <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">
                      {profile.outbounds.length} members
                    </span>
                    {profile.interval && (
                      <span className="rounded-full bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">
                        {profile.interval}
                      </span>
                    )}
                    {renderGroupLatency(profile.outbounds)}
                    {topSelectorTag === profile.tag && (
                      <span className="rounded-full bg-primary-600/15 px-2 py-0.5 text-[10px] text-primary-600 dark:text-primary-400">
                        default
                      </span>
                    )}
                    {hasConfig && topSelectorTag !== profile.tag && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveGroup(profile.tag);
                        }}
                        className="ml-1 rounded-xl p-1.5 text-content-muted opacity-0 transition-all hover:bg-red-500/20 hover:text-red-500 group-hover:opacity-100 group-focus-within:opacity-100 dark:hover:text-red-400"
                        title="Delete group"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {expandedGroups[profile.tag] && (
                  <div className="border-t border-border/60 bg-surface-base/40 px-3 py-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {profile.outbounds.map((memberTag) => {
                        const memberNode = nodeMap[memberTag];
                        const memberProfile = profiles.find((item) => item.tag === memberTag);
                        const isSelected = selectedOutboundTag === memberTag;

                        return (
                          <button
                            key={`${profile.tag}-${memberTag}`}
                            type="button"
                            onClick={() => onSelect(memberTag)}
                            className={`inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-all ${
                              isSelected
                                ? "border-primary-500/30 bg-primary-600/10"
                                : "border-border/60 bg-card/40 hover:border-border hover:bg-card"
                            }`}
                          >
                            {isSelected ? (
                              <CheckCircle2 size={15} className="shrink-0 text-primary-500" />
                            ) : memberProfile ? (
                              <Layers3 size={13} className="shrink-0 text-yellow-500 dark:text-yellow-400" />
                            ) : (
                              <Server size={13} className="shrink-0 text-content-muted" />
                            )}
                            <span className="max-w-[12rem] truncate text-xs font-medium text-content">{memberTag}</span>
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
        <div className="panel-card flex flex-col items-center justify-center rounded-[24px] py-12 text-content-muted">
          <Server size={40} className="mb-3 opacity-30" />
          <p className="text-sm">No nodes configured</p>
          <p className="mt-1 text-xs opacity-60">
            Add a node or import a profile to get started
          </p>
        </div>
      ) : (
        <div className="panel-card rounded-[24px] p-4">
          <div className="mb-4 flex items-center justify-between px-2">
            <h3 className="text-sm font-semibold text-content">Proxy Nodes</h3>
            <span className="status-chip">{nodes.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-6 2xl:grid-cols-7">
            {nodes.map((node) => {
              const isSelected = node.id === selectedOutboundTag;
              const isResolvedActive = !isSelected && activeResolvedNodeId === node.id;
              const protocolLabel =
                PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;

              return (
                <div
                  key={node.id}
                  onClick={() => onSelect(node.id)}
                  className={`group flex cursor-pointer items-center gap-3 rounded-[18px] border px-3 py-2.5 transition-all ${
                    isSelected
                      ? "border-primary-500/30 bg-primary-600/10"
                      : isResolvedActive
                        ? "border-emerald-500/30 bg-emerald-500/8"
                        : "subtle-row"
                  }`}
                  title={`${node.server}${node.port > 0 ? `:${node.port}` : ""}`}
                >
                  {isSelected ? (
                    <CheckCircle2 size={18} className="shrink-0 text-primary-500" />
                  ) : isResolvedActive ? (
                    <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
                  ) : (
                    <div className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-surface-muted" />
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-content">{node.name}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-xl bg-surface-elevated px-2 py-0.5 text-[10px] text-content-secondary">
                        {protocolLabel}
                      </span>
                      {isSelected && <span className="text-[10px] text-primary-500">Active</span>}
                      {isResolvedActive && <span className="text-[10px] text-emerald-500">Routed</span>}
                      {renderLatency(node.id)}
                    </div>
                  </div>

                  <div
                    className={`flex shrink-0 items-center gap-1 transition-opacity ${
                      isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                    }`}
                  >
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
  compact = false,
}: {
  value: "auto" | "connect" | "http";
  onChange: (value: "auto" | "connect" | "http") => void;
  options: Array<{
    value: "auto" | "connect" | "http";
    label: string;
    icon: React.ReactNode;
  }>;
  compact?: boolean;
}) {
  return (
    <div className={`mode-toggle ${compact ? "px-0.5 py-0.5" : ""}`}>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`mode-toggle-button ${compact ? "px-3 py-1.5 text-[0.72rem]" : ""} ${active ? "active" : ""}`}
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

export default NodeList;
