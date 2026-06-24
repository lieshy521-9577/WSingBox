import { Power, AlertCircle } from "lucide-react";
import { ProxyNode } from "../types";
import { Profile } from "../hooks/useSingbox";

interface ProxyControlProps {
  isRunning: boolean;
  proxyEnabled: boolean;
  loading: boolean;
  selectedOutboundTag: string | null;
  nodes: ProxyNode[];
  profiles: Profile[];
  hasConfig: boolean;
  tunEnabled: boolean;
  onToggle: () => void;
  error: string | null;
  onDismissError: () => void;
}

function ProxyControl({
  isRunning,
  proxyEnabled,
  loading,
  selectedOutboundTag,
  nodes,
  profiles,
  hasConfig,
  tunEnabled,
  onToggle,
  error,
  onDismissError,
}: ProxyControlProps) {
  const selectedNode = nodes.find((n) => n.id === selectedOutboundTag);
  const selectedProfile = profiles.find((p) => p.tag === selectedOutboundTag);
  const canStart = hasConfig || !!selectedOutboundTag;

  const resolveActiveNode = (tag: string | null, visited = new Set<string>()): ProxyNode | null => {
    if (!tag || visited.has(tag)) {
      return null;
    }

    const node = nodes.find((item) => item.id === tag);
    if (node) {
      return node;
    }

    const profile = profiles.find((item) => item.tag === tag);
    if (!profile) {
      return null;
    }

    visited.add(tag);

    const candidates = [
      profile.default_outbound,
      ...profile.outbounds,
    ].filter(Boolean);

    for (const candidate of candidates) {
      const resolved = resolveActiveNode(candidate, visited);
      if (resolved) {
        return resolved;
      }
    }

    return null;
  };

  const resolvedGroupNode = selectedNode ? null : resolveActiveNode(selectedOutboundTag);
  const statusLabel = isRunning ? "Traffic Live" : "Standby";
  const targetSummary = selectedNode
    ? `${selectedNode.name} (${selectedNode.server}:${selectedNode.port})`
    : selectedProfile
      ? resolvedGroupNode
        ? `${selectedProfile.tag} -> ${resolvedGroupNode.name}`
        : `${selectedProfile.tag} (${selectedProfile.profile_type})`
      : hasConfig
        ? "Imported profile workspace"
        : "No route target selected";

  return (
    <div className="border-b border-border/80 bg-surface/85 px-5 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onToggle}
            disabled={loading || (!canStart && !isRunning)}
            className={`flex h-14 w-14 items-center justify-center rounded-[20px] border transition-all ${
              isRunning
                ? "border-emerald-400/30 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                : "border-border bg-surface-elevated text-content-muted hover:bg-surface-subtle"
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Power size={22} />
          </button>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-xl font-semibold text-content">
                {isRunning ? "Sing-box Running" : "Sing-box Stopped"}
              </p>
              <span className={`status-pill ${isRunning ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-400/10 text-slate-600 dark:text-slate-300"}`}>
                {statusLabel}
              </span>
            </div>
            <p className="max-w-3xl text-sm text-content-secondary">
              {selectedNode
                ? `Active: ${selectedNode.name} (${selectedNode.server}:${selectedNode.port})`
                : selectedProfile
                  ? resolvedGroupNode
                    ? `Active Group: ${selectedProfile.tag} -> ${resolvedGroupNode.name} (${resolvedGroupNode.server}:${resolvedGroupNode.port})`
                    : `Active Group: ${selectedProfile.tag} (${selectedProfile.profile_type})`
                : hasConfig
                  ? "Using imported config (auto-select by profile)"
                  : "No node selected"}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <ControlPill label="Target" value={targetSummary} />
              <ControlPill label="Switch" value={loading ? "Updating" : "Ready"} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="status-pill bg-slate-500/8 text-content-secondary">
            Mode
            <strong className="text-content">{tunEnabled ? "TUN" : "Mixed Inbound"}</strong>
          </span>
          {tunEnabled && (
            <span className="status-pill bg-green-600/15 text-green-700 dark:text-green-300">
              TUN Mode
            </span>
          )}
          {proxyEnabled && (
            <span className="status-pill bg-primary-600/15 text-primary-700 dark:text-primary-300">
              System Proxy: ON
            </span>
          )}
          {selectedProfile && resolvedGroupNode && (
            <span className="status-pill bg-sky-500/12 text-sky-700 dark:text-sky-300">
              Current Node: {resolvedGroupNode.name}
            </span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle size={14} className="text-red-500 dark:text-red-400 shrink-0" />
          <span className="flex-1 text-xs text-red-600 dark:text-red-300">{error}</span>
          <button
            onClick={onDismissError}
            className="rounded-xl px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/10 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function ControlPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface-elevated/80 px-3 py-1.5 text-[11px] text-content-secondary">
      <span className="uppercase tracking-[0.14em] text-content-muted">{label}</span>
      <strong className="max-w-[18rem] truncate text-content">{value}</strong>
    </span>
  );
}

export default ProxyControl;
