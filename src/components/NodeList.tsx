import { useState, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Server, CheckCircle2, Activity, Layers3, ChevronDown, ChevronRight, Pencil } from "lucide-react";
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

  const getNodeProfiles = (nodeId: string): string[] => {
    return profiles
      .filter((p) => p.outbounds.includes(nodeId))
      .map((p) => `${p.tag} (${p.profile_type})`);
  };

  const nodeMap = useMemo(
    () => Object.fromEntries(nodes.map((node) => [node.id, node])),
    [nodes]
  );

  const topSelectorTag = profiles.find((p) => p.profile_type === "selector")?.tag ?? profiles[0]?.tag ?? null;

  const testAllLatency = useCallback(async () => {
    setTesting(true);
    try {
      for (const node of nodes) {
        if (!node.server || node.port === 0) continue;
        try {
          const result = await invoke<LatencyResult>("test_node_latency", {
            nodeId: node.id,
            nodeType: node.node_type,
            server: node.server,
            port: node.port,
            settings: node.settings,
          });
          setLatencies((prev) => ({ ...prev, [node.id]: result }));
        } catch {
          setLatencies((prev) => ({
            ...prev,
            [node.id]: { node_id: node.id, latency_ms: -1, status: "error" },
          }));
        }
      }
    } finally {
      setTesting(false);
    }
  }, [nodes]);

  const renderLatency = (nodeId: string) => {
    const result = latencies[nodeId];
    if (!result) return null;

    if (result.status === "ok") {
      const ms = result.latency_ms;
      let color = "text-green-500 dark:text-green-400";
      if (ms > 300) color = "text-yellow-500 dark:text-yellow-400";
      if (ms > 800) color = "text-red-500 dark:text-red-400";
      return <span className={`text-xs font-mono ${color}`}>{ms}ms</span>;
    } else if (result.status === "timeout") {
      return <span className="text-xs font-mono text-red-500 dark:text-red-400">Timeout</span>;
    } else {
      return <span className="text-xs font-mono text-red-500 dark:text-red-400">Failed</span>;
    }
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

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-content">Proxy Nodes</h2>
          {profiles.length > 0 && (
            <p className="text-xs text-content-secondary mt-0.5">
              Auto-selected by profile: {profiles.find(p => p.profile_type === "selector")?.tag || profiles[0]?.tag}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={testAllLatency}
            disabled={testing || nodes.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              testing
                ? "bg-surface-muted text-content-muted cursor-not-allowed"
                : "bg-surface-elevated hover:bg-surface-muted text-content"
            }`}
          >
            <Activity size={14} className={testing ? "animate-pulse" : ""} />
            {testing ? "Testing..." : "Test Latency"}
          </button>
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors"
          >
            <Plus size={14} />
            Add Node
          </button>
        </div>
      </div>

      {/* Profiles summary */}
      {profiles.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {profiles.map((profile) => (
            <div key={profile.tag} className="overflow-hidden rounded-lg border border-border bg-card/50">
              <div
                onClick={() => onSelect(profile.tag)}
                className={`flex cursor-pointer items-center gap-2 px-3 py-2 transition-all ${
                  selectedOutboundTag === profile.tag
                    ? "bg-primary-600/10"
                    : "hover:bg-card"
                }`}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleGroup(profile.tag);
                  }}
                  className="rounded p-1 text-content-secondary hover:bg-surface-elevated hover:text-content"
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
                <span className="text-xs text-content font-medium">{profile.tag}</span>
                <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                  {profile.profile_type}
                </span>
                {topSelectorTag === profile.tag && (
                  <span className="text-[10px] bg-primary-600/15 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded">
                    primary
                  </span>
                )}
                {profile.default_outbound && (
                  <span className="text-[10px] text-content-secondary ml-auto">
                    default: {profile.default_outbound}
                  </span>
                )}
                {profile.interval && (
                  <span className="text-[10px] text-content-secondary">
                    interval: {profile.interval}
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
                    className="ml-1 rounded p-1.5 text-content-muted transition-colors hover:bg-red-500/20 hover:text-red-500 dark:hover:text-red-400"
                    title="Delete group"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {expandedGroups[profile.tag] && (
                <div className="border-t border-border/70 bg-surface-base/40 px-3 py-2">
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
                          className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all ${
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
                                <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                                  {memberProfile.profile_type}
                                </span>
                              )}
                              {memberNode && (
                                <span className="text-[10px] bg-surface-elevated text-content-secondary px-1.5 py-0.5 rounded">
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
      )}

      {/* Node list */}
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-content-muted">
          <Server size={48} className="mb-4 opacity-30" />
          <p className="text-sm">No nodes configured</p>
          <p className="text-xs mt-1 opacity-60">
            Click "Add Node" or import a sing-box config to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => {
            const isSelected = node.id === selectedOutboundTag;
            const protocolLabel =
              PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;
            const nodeProfileNames = getNodeProfiles(node.id);

            return (
              <div
                key={node.id}
                onClick={() => onSelect(node.id)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? "bg-primary-600/10 border border-primary-500/30"
                    : "bg-card/50 border border-transparent hover:bg-card hover:border-border"
                }`}
              >
                {/* Selection indicator */}
                <div className="shrink-0">
                  {isSelected ? (
                    <CheckCircle2 size={18} className="text-primary-500" />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border-2 border-surface-muted" />
                  )}
                </div>

                {/* Node info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content truncate">
                      {node.name}
                    </span>
                    <span className="text-[10px] bg-surface-elevated text-content-secondary px-1.5 py-0.5 rounded shrink-0">
                      {protocolLabel}
                    </span>
                    {nodeProfileNames.length > 0 && (
                      <span className="text-[10px] bg-green-500/15 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded shrink-0">
                        in group
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-content-secondary mt-0.5 truncate">
                    {node.server}{node.port > 0 ? `:${node.port}` : ""}
                  </p>
                </div>

                {/* Latency + Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {renderLatency(node.id)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEdit(node);
                    }}
                    className="p-1.5 rounded hover:bg-surface-elevated text-content-muted hover:text-content transition-colors"
                    title="Edit node"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(node.id);
                    }}
                    className="p-1.5 rounded hover:bg-red-500/20 text-content-muted hover:text-red-500 dark:hover:text-red-400 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default NodeList;
