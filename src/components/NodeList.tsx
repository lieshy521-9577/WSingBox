import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Server, CheckCircle2, Zap, Activity } from "lucide-react";
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
  selectedNodeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: () => void;
}

function NodeList({ nodes, profiles, selectedNodeId, onSelect, onRemove, onAdd }: NodeListProps) {
  const [latencies, setLatencies] = useState<Record<string, LatencyResult>>({});
  const [testing, setTesting] = useState(false);

  // Determine which nodes belong to which profiles
  const getNodeProfiles = (nodeId: string): string[] => {
    return profiles
      .filter((p) => p.outbounds.includes(nodeId))
      .map((p) => `${p.tag} (${p.profile_type})`);
  };

  // Test all nodes latency
  const testAllLatency = useCallback(async () => {
    setTesting(true);
    try {
      // Test each node sequentially via individual calls (more reliable)
      for (const node of nodes) {
        if (!node.server || node.port === 0) continue;
        try {
          const result = await invoke<LatencyResult>("test_node_latency", {
            nodeId: node.id,
            server: node.server,
            port: node.port,
          });
          setLatencies((prev) => ({ ...prev, [node.id]: result }));
        } catch (err) {
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

  // Latency display helper
  const renderLatency = (nodeId: string) => {
    const result = latencies[nodeId];
    if (!result) return null;

    if (result.status === "ok") {
      const ms = result.latency_ms;
      let color = "text-green-400";
      if (ms > 300) color = "text-yellow-400";
      if (ms > 800) color = "text-red-400";
      return (
        <span className={`text-xs font-mono ${color}`}>
          {ms}ms
        </span>
      );
    } else if (result.status === "timeout") {
      return <span className="text-xs font-mono text-red-400">Timeout</span>;
    } else {
      return <span className="text-xs font-mono text-red-400">Failed</span>;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Proxy Nodes</h2>
          {profiles.length > 0 && (
            <p className="text-xs text-dark-200 mt-0.5">
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
                ? "bg-dark-700 text-dark-200 cursor-not-allowed"
                : "bg-dark-700 hover:bg-dark-600 text-white"
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
            <div
              key={profile.tag}
              className="flex items-center gap-2 px-3 py-2 bg-dark-800/50 border border-dark-700/50 rounded-lg"
            >
              <Zap size={14} className="text-yellow-400 shrink-0" />
              <span className="text-xs text-white font-medium">{profile.tag}</span>
              <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
                {profile.profile_type}
              </span>
              {profile.default_outbound && (
                <span className="text-[10px] text-dark-200 ml-auto">
                  default: {profile.default_outbound}
                </span>
              )}
              {profile.interval && (
                <span className="text-[10px] text-dark-200">
                  interval: {profile.interval}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Node list */}
      {nodes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-dark-200">
          <Server size={48} className="mb-4 opacity-30" />
          <p className="text-sm">No nodes configured</p>
          <p className="text-xs mt-1 opacity-60">
            Click "Add Node" or import a sing-box config to get started
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {nodes.map((node) => {
            const isSelected = node.id === selectedNodeId;
            const protocolLabel =
              PROTOCOL_LABELS[node.node_type as ProtocolType] || node.node_type;
            const nodeProfileNames = getNodeProfiles(node.id);

            return (
              <div
                key={node.id}
                onClick={() => onSelect(node.id)}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? "bg-primary-600/15 border border-primary-500/30"
                    : "bg-dark-800/50 border border-transparent hover:bg-dark-800 hover:border-dark-700"
                }`}
              >
                {/* Selection indicator */}
                <div className="shrink-0">
                  {isSelected ? (
                    <CheckCircle2 size={18} className="text-primary-400" />
                  ) : (
                    <div className="w-[18px] h-[18px] rounded-full border-2 border-dark-700" />
                  )}
                </div>

                {/* Node info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {node.name}
                    </span>
                    <span className="text-[10px] bg-dark-700 text-dark-200 px-1.5 py-0.5 rounded shrink-0">
                      {protocolLabel}
                    </span>
                    {nodeProfileNames.length > 0 && (
                      <span className="text-[10px] bg-green-500/15 text-green-400 px-1.5 py-0.5 rounded shrink-0">
                        in group
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-dark-200 mt-0.5 truncate">
                    {node.server}{node.port > 0 ? `:${node.port}` : ""}
                  </p>
                </div>

                {/* Latency + Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {renderLatency(node.id)}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(node.id);
                    }}
                    className="p-1.5 rounded hover:bg-red-500/20 text-dark-200 hover:text-red-400 transition-colors"
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
