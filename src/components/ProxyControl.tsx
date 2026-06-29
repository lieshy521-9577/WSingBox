import { AlertCircle, Loader2, Power } from "lucide-react";
import { ProxyNode } from "../types";
import { Profile, RuntimeDebugSnapshot } from "../hooks/useSingbox";

interface ProxyControlProps {
  isRunning: boolean;
  proxyEnabled: boolean;
  loading: boolean;
  selectedOutboundTag: string | null;
  nodes: ProxyNode[];
  profiles: Profile[];
  runtimeDebug: RuntimeDebugSnapshot | null;
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
  runtimeDebug,
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
  const activeLabel = selectedNode?.name ?? resolvedGroupNode?.name ?? selectedProfile?.tag ?? "Not selected";

  return (
    <div className="border-b border-border/80 bg-surface/85 px-[clamp(0.875rem,1.6vw,1.25rem)] py-[clamp(0.75rem,1.4vw,1rem)]">
      <div className="flex flex-col gap-[clamp(0.75rem,1.4vw,1rem)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-[clamp(0.75rem,1.4vw,1rem)]">
          <button
            onClick={onToggle}
            disabled={loading || (!canStart && !isRunning)}
            className={`flex h-[clamp(3rem,4.5vw,3.5rem)] w-[clamp(3rem,4.5vw,3.5rem)] items-center justify-center rounded-[20px] border transition-all ${
              isRunning
                ? "border-emerald-400/30 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                : "border-border bg-surface-elevated text-content-muted hover:bg-surface-subtle"
            } ${loading ? "cursor-not-allowed opacity-80" : ""}`}
          >
            {loading ? <Loader2 size={22} className="animate-spin" /> : <Power size={22} />}
          </button>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <p className="text-[clamp(1.05rem,2vw,1.25rem)] font-semibold text-content">
                {isRunning ? "Sing-box Running" : "Sing-box Stopped"}
              </p>
              <span className={`status-pill ${isRunning ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-400/10 text-slate-600 dark:text-slate-300"}`}>
                {statusLabel}
              </span>
            </div>
            <p className="max-w-3xl text-[clamp(0.8rem,1.2vw,0.875rem)] text-content-secondary">
              {selectedNode
                ? `Active: ${selectedNode.name} (${selectedNode.server}:${selectedNode.port})`
                : selectedProfile
                  ? resolvedGroupNode
                    ? `Active: ${selectedProfile.tag} -> ${resolvedGroupNode.name} (${resolvedGroupNode.server}:${resolvedGroupNode.port})`
                    : `Active Group: ${selectedProfile.tag} (${selectedProfile.profile_type})`
                : hasConfig
                  ? "Using imported config (auto-select by profile)"
                  : "No node selected"}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <ControlPill label="Target" value={activeLabel} />
              <ControlPill label="Switch" value={loading ? "Updating" : "Ready"} />
              {!selectedNode && selectedProfile && (
                <ControlPill label="Group" value={selectedProfile.tag} />
              )}
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
          {runtimeDebug?.route_final && (
            <span className="status-pill bg-amber-500/12 text-amber-700 dark:text-amber-300">
              Route Final: {runtimeDebug.route_final}
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
