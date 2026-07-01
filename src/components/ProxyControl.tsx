import { AlertCircle, Loader2, Power } from "lucide-react";
import { ProxyNode, StartupHealthReport } from "../types";
import { Profile, RuntimeDebugSnapshot, RuntimePhase } from "../hooks/useSingbox";

interface ProxyControlProps {
  isRunning: boolean;
  runtimePhase: RuntimePhase;
  proxyEnabled: boolean;
  loading: boolean;
  switchStatus: string | null;
  selectedOutboundTag: string | null;
  nodes: ProxyNode[];
  profiles: Profile[];
  runtimeDebug: RuntimeDebugSnapshot | null;
  startupHealth: StartupHealthReport | null;
  hasConfig: boolean;
  tunEnabled: boolean;
  onToggle: () => void;
  error: string | null;
  onDismissError: () => void;
}

function ProxyControl({
  isRunning,
  runtimePhase,
  proxyEnabled,
  loading,
  switchStatus,
  selectedOutboundTag,
  nodes,
  profiles,
  runtimeDebug,
  startupHealth,
  hasConfig,
  tunEnabled,
  onToggle,
  error,
  onDismissError,
}: ProxyControlProps) {
  const selectedNode = nodes.find((n) => n.id === selectedOutboundTag);
  const selectedProfile = profiles.find((p) => p.tag === selectedOutboundTag);
  const canStart = hasConfig || !!selectedOutboundTag;
  const isLive = runtimePhase === "running" && isRunning;
  const isTransitioning =
    runtimePhase === "starting" || runtimePhase === "switching" || runtimePhase === "stopping";
  const runtimeLeafNode = runtimeDebug?.active_leaf_outbound
    ? nodes.find((node) => node.id === runtimeDebug.active_leaf_outbound) ?? null
    : null;
  const runtimeLeafProfile = runtimeDebug?.active_leaf_outbound
    ? profiles.find((profile) => profile.tag === runtimeDebug.active_leaf_outbound) ?? null
    : null;
  const runtimeSelectedIsProfile = Boolean(runtimeLeafProfile && !runtimeLeafNode);

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
  const displayedLeafNode = isLive || isTransitioning
    ? runtimeSelectedIsProfile
      ? null
      : runtimeLeafNode ?? resolvedGroupNode
    : null;
  const displayedProfile = isLive || isTransitioning ? runtimeLeafProfile ?? selectedProfile : null;
  const pendingLabel = selectedNode?.name ?? selectedProfile?.tag ?? null;
  const pendingRouteSummary =
    selectedProfile && resolvedGroupNode && selectedProfile.tag !== resolvedGroupNode.name
      ? `${selectedProfile.tag} -> ${resolvedGroupNode.name}`
      : pendingLabel ?? "Not selected";
  const activeLabel = displayedLeafNode?.name ?? displayedProfile?.tag ?? "Not selected";
  const routeSummary =
    displayedProfile && displayedLeafNode && displayedProfile.tag !== displayedLeafNode.name
      ? `${displayedProfile.tag} -> ${displayedLeafNode.name}`
      : activeLabel;
  const pendingDiffersFromActive = Boolean(
    (isLive || isTransitioning) &&
      pendingLabel &&
      pendingLabel !== activeLabel &&
      pendingLabel !== displayedLeafNode?.name
  );
  const headlineMeta =
    runtimePhase === "switching"
      ? pendingDiffersFromActive && pendingLabel
        ? `Applying ${pendingLabel} and waiting for runtime readiness`
        : "Applying runtime changes and restarting sing-box"
      : runtimePhase === "starting"
        ? "Starting sing-box and validating local proxy availability"
        : runtimePhase === "stopping"
          ? "Stopping sing-box and restoring local network settings"
          : isLive
            ? "Local proxy is ready for traffic"
            : pendingRouteSummary !== "Not selected"
              ? `Selected target: ${pendingRouteSummary}`
              : hasConfig
                ? "Choose a node or group before starting"
                : "Import profile or choose node";
  const title =
    runtimePhase === "switching"
      ? "Sing-box Switching"
      : runtimePhase === "starting"
        ? "Sing-box Starting"
        : runtimePhase === "stopping"
          ? "Sing-box Stopping"
          : runtimePhase === "error"
            ? "Sing-box Attention"
            : isLive
              ? "Sing-box Running"
              : "Sing-box Stopped";
  const statusToneClass =
    runtimePhase === "switching"
      ? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
      : runtimePhase === "starting"
        ? "bg-sky-500/12 text-sky-700 dark:text-sky-300"
        : runtimePhase === "stopping"
          ? "bg-orange-500/12 text-orange-700 dark:text-orange-300"
          : runtimePhase === "error"
            ? "bg-red-500/12 text-red-700 dark:text-red-300"
            : isLive
              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "bg-slate-400/10 text-slate-600 dark:text-slate-300";
  const statusLabel =
    runtimePhase === "switching"
      ? "Applying"
      : runtimePhase === "starting"
        ? "Starting"
        : runtimePhase === "stopping"
          ? "Stopping"
          : runtimePhase === "error"
            ? "Failed"
            : isLive
              ? "Traffic Live"
              : "Stopped";
  const runtimeFacts = [
    { label: isLive || isTransitioning ? "Route" : "Selected", value: isLive || isTransitioning ? routeSummary : pendingRouteSummary },
    { label: "Switch", value: switchStatus ?? (loading ? "Updating" : isLive ? "Ready" : "Idle") },
    pendingDiffersFromActive && pendingLabel
      ? { label: "Pending", value: pendingLabel, accent: "info" as const }
      : null,
  ].filter(Boolean) as Array<{
    label: string;
    value: string;
    accent?: "default" | "info";
  }>;

  return (
    <div className="border-b border-border/80 bg-surface/85 px-[clamp(0.875rem,1.6vw,1.25rem)] py-[clamp(0.625rem,1.2vw,0.875rem)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-[clamp(0.625rem,1.2vw,0.875rem)]">
          <button
            onClick={onToggle}
            disabled={loading || (!canStart && !isRunning)}
            className={`flex h-[clamp(2.75rem,4vw,3.1rem)] w-[clamp(2.75rem,4vw,3.1rem)] items-center justify-center rounded-[18px] border transition-all ${
              isLive
                ? "border-emerald-400/30 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                : runtimePhase === "switching" || runtimePhase === "starting"
                  ? "border-sky-400/30 bg-sky-500 text-white shadow-lg shadow-sky-500/20"
                : "border-border bg-surface-elevated text-content-muted hover:bg-surface-subtle"
            } ${loading ? "cursor-not-allowed opacity-80" : ""}`}
          >
            {loading ? <Loader2 size={20} className="animate-spin" /> : <Power size={20} />}
          </button>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[clamp(1rem,1.8vw,1.15rem)] font-semibold text-content">
                {title}
              </p>
              <span className={`status-pill ${statusToneClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className="max-w-3xl truncate text-[clamp(0.76rem,1vw,0.82rem)] text-content-secondary">
              {headlineMeta}
            </p>
            <div className="flex max-w-3xl flex-wrap items-center gap-1.5 pt-0.5">
              {runtimeFacts.map((fact) => (
                <InlineStatusFact
                  key={fact.label}
                  label={fact.label}
                  value={fact.value}
                  accent={fact.accent}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className="status-pill bg-slate-500/8 text-content-secondary">
            Mode
            <strong className="text-content">{tunEnabled ? "TUN Enabled" : "Mixed Inbound"}</strong>
          </span>
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
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2.5">
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

      {startupHealth && (
        <div className="runtime-health-strip mt-2.5 flex flex-wrap gap-1.5">
          {startupHealth.items.map((item) => (
            <span
              key={item.key}
              className={`inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] ${
                item.status === "error"
                  ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-300"
                  : item.status === "warn"
                    ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    : "border-border/80 bg-surface-elevated/70 text-content-secondary"
              }`}
              title={item.message}
            >
              <span className="uppercase tracking-[0.14em] text-content-muted">{item.label}</span>
              <strong className="max-w-[18rem] truncate text-content">{item.message}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InlineStatusFact({
  label,
  value,
  accent = "default",
}: {
  label: string;
  value: string;
  accent?: "default" | "info";
}) {
  const accentClass =
    accent === "info"
      ? "bg-primary-500/10 text-primary-700 dark:text-primary-300"
      : "text-content-secondary";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface-elevated/75 px-2 py-1 text-[10px] ${accentClass}`}>
      <span className="uppercase tracking-[0.14em] text-content-muted">{label}</span>
      <strong className="max-w-[18rem] truncate text-content">{value}</strong>
    </span>
  );
}

export default ProxyControl;
