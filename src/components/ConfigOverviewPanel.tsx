import { useMemo, useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  FileJson,
  Globe,
  Network,
  Pencil,
  Route,
  Shield,
  Users,
  Loader2,
  Zap,
} from "lucide-react";
import { ConfigOverview, RouteRuleInfo } from "../types";
import { RuntimeDebugSnapshot, RuntimePhase } from "../hooks/useSingbox";

type OverviewSection = "nodes" | "dns" | "rules" | "ruleSets";

interface ConfigOverviewPanelProps {
  overview: ConfigOverview;
  onEditRouteRule: (index: number, rule: RouteRuleInfo) => void;
  selectedOutboundTag: string | null;
  onSelectOutbound?: (tag: string) => void;
  runtimeDebug?: RuntimeDebugSnapshot | null;
  isRunning?: boolean;
  runtimePhase?: RuntimePhase;
  onToggleProxy?: () => void;
  loading?: boolean;
}

function ConfigOverviewPanel({
  overview,
  onEditRouteRule,
  selectedOutboundTag,
  onSelectOutbound,
  runtimeDebug,
  isRunning = false,
  runtimePhase = "stopped",
  onToggleProxy,
  loading = false,
}: ConfigOverviewPanelProps) {
  const [activeSection, setActiveSection] = useState<OverviewSection>("nodes");
  const [heroAnim, setHeroAnim] = useState<"idle" | "starting" | "stopping" | "running" | "stopped">(isRunning ? "running" : "stopped");
  const [statusText, setStatusText] = useState(isRunning ? "Connected" : "Disconnected");
  const prevPhaseRef = useRef<RuntimePhase>(runtimePhase);

  const proxyNodes = useMemo(
    () =>
      overview.outbounds.filter(
        (item) => !["direct", "block", "selector", "urltest"].includes(item.outbound_type)
      ),
    [overview.outbounds]
  );
  const groups = useMemo(() => overview.outbounds.filter((item) => item.is_group), [overview.outbounds]);
  const dnsServer = overview.dns_servers[0] ?? null;
  const primaryInbound = overview.inbounds[0] ?? null;
  const activeOutbound = overview.outbounds.find((item) => item.tag === selectedOutboundTag) ?? null;
  const actualRuntimeRoute = isRunning ? runtimeDebug?.active_leaf_outbound || runtimeDebug?.top_selector_default || null : null;
  const routeDisplay = actualRuntimeRoute || activeOutbound?.tag || "auto";
  const rulesWithOutbound = overview.route_rules.filter((rule) => rule.outbound).length;

  const isRuntimeTransitioning = runtimePhase === "starting" || runtimePhase === "switching" || runtimePhase === "stopping";
  const runtimeGroupTag = runtimeDebug?.top_selector_default || null;
  const runtimeLeafTag = runtimeDebug?.active_leaf_outbound || null;

  // ── Phase-driven animation state ──
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = runtimePhase;

    if (prev === runtimePhase) return;

    if (runtimePhase === "starting") {
      setHeroAnim("starting");
      setStatusText("Connecting...");
    } else if (runtimePhase === "running" && prev === "starting") {
      setHeroAnim("running");
      setStatusText("Connected");
    } else if (runtimePhase === "stopping") {
      setHeroAnim("stopping");
      setStatusText("Stopping...");
    } else if (runtimePhase === "stopped") {
      setHeroAnim("stopped");
      setStatusText("Disconnected");
    }
  }, [runtimePhase]);

  // ── Phase-based status line ──
  const subtitle = (() => {
    if (runtimePhase === "starting") return "Core is starting up…";
    if (runtimePhase === "stopping") return "Shutting down…";
    if (runtimePhase === "error") return "Core encountered an error";
    if (runtimePhase === "switching") return "Switching nodes…";
    return isRunning ? "sing-box core is running" : "Proxy is stopped";
  })();

  const sectionTabs: Array<{
    id: OverviewSection;
    label: string;
    icon: React.ReactNode;
    count: number;
  }> = [
    { id: "nodes", label: "Nodes", icon: <Network size={16} />, count: proxyNodes.length },
    { id: "dns", label: "DNS", icon: <Globe size={16} />, count: overview.dns_servers.length },
    { id: "rules", label: "Rules", icon: <Route size={16} />, count: overview.route_rules_count },
    { id: "ruleSets", label: "Rule Sets", icon: <FileJson size={16} />, count: overview.rule_sets.length },
  ];

  return (
    <section className="space-y-[18px]">
      {/* ── Hero Connection Card ── */}
      <div className="flex flex-col items-center rounded-[20px] border border-border bg-gradient-to-br from-surface/70 to-surface-elevated/60 px-6 pb-5 pt-7 text-center">
        {/* Shield icon with phase-driven glow + animation */}
        <div
          className={`relative mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-[24px] transition-all duration-500 ${
            heroAnim === "starting" ? "bg-emerald-500/20 text-emerald-600 dark:bg-emerald-500/25 dark:text-emerald-400 shadow-lg shadow-emerald-500/30 animate-hero-glow-in" :
            heroAnim === "running" ? "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400 shadow-lg shadow-emerald-500/20" :
            heroAnim === "stopping" ? "bg-emerald-500/8 text-emerald-500/70 dark:bg-emerald-500/10 dark:text-emerald-400/60 animate-hero-ring-collapse" :
            "bg-muted text-muted-foreground shadow-none"
          }`}
        >
          {/* Start pulse ring */}
          {heroAnim === "starting" && (
            <span className="pointer-events-none absolute inset-0 rounded-[24px] border-2 border-emerald-500/40 dark:border-emerald-400/40 animate-ping" />
          )}
          {heroAnim === "starting" ? (
            <Zap size={36} strokeWidth={2} className="animate-hero-pulse-on" />
          ) : (
            <Shield size={36} strokeWidth={2} />
          )}
        </div>

        {/* Status text with fade animation */}
        <h3
          key={statusText}
          className={`mb-1 animate-status-text-fade text-xl font-bold tracking-tight transition-colors duration-500 ${
            heroAnim === "starting" || heroAnim === "running"
              ? "text-emerald-600 dark:text-emerald-400"
              : heroAnim === "stopping"
                ? "text-content-secondary"
                : "text-content"
          }`}
        >
          {statusText}
        </h3>
        <p className="mb-5 text-sm text-content-secondary transition-colors duration-500">
          {subtitle}
        </p>

        {/* Toggle with transition progress bar */}
        <div className="mb-5 flex flex-col items-center gap-2">
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={isRunning}
              onChange={() => !loading && onToggleProxy?.()}
              disabled={loading}
              className="peer sr-only"
            />
            <span className={`h-7 w-[52px] rounded-full border transition-all duration-500 ${
              heroAnim === "starting" ? "border-emerald-500/50 bg-emerald-500/25 dark:border-emerald-500/60 dark:bg-emerald-500/30" :
              heroAnim === "running" ? "border-emerald-500/30 bg-emerald-500/15 dark:border-emerald-500/40 dark:bg-emerald-500/20" :
              heroAnim === "stopping" ? "border-amber-500/40 bg-amber-500/10" :
              "border-border/80 bg-muted"
            }`} />
            <span className={`pointer-events-none absolute left-[3px] flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-500 dark:bg-slate-200 ${
              heroAnim === "starting" ? "translate-x-[26px] bg-emerald-500" :
              heroAnim === "running" ? "translate-x-[26px] bg-emerald-500" :
              heroAnim === "stopping" ? "translate-x-[26px] bg-amber-500" :
              "translate-x-0"
            }`}>
              {loading && <Loader2 size={11} className="animate-spin text-white" />}
            </span>
          </label>

          {/* Transition progress bar */}
          {loading && (
            <div className="h-1 w-[52px] overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${
                  heroAnim === "starting" ? "animate-hero-progress bg-emerald-500" :
                  "animate-hero-progress bg-amber-500"
                }`}
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-center gap-10">
          <div className="text-center">
            <span className="text-base font-bold tabular-nums text-content">{routeDisplay}</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">{actualRuntimeRoute ? "Live route" : "Route"}</span>
          </div>
          <div className="text-center">
            <span className="text-base font-bold tabular-nums text-content">--</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">Uptime</span>
          </div>
          <div className="text-center">
            <span className="text-base font-bold tabular-nums text-content">--</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">Transfer</span>
          </div>
        </div>
      </div>

      {/* ── Snapshot Tiles (horizontal layout) ── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SnapshotTile
          icon={<Globe size={16} />}
          label="Routing Targets"
          value={`${proxyNodes.length} nodes`}
          meta={`${groups.length} groups ready`}
        />
        <SnapshotTile
          icon={<Shield size={16} />}
          label="Inbounds"
          value={primaryInbound?.inbound_type ?? "Unknown"}
          meta={primaryInbound?.tag ?? "No inbound tag"}
        />
        <SnapshotTile
          icon={<Network size={16} />}
          label="DNS"
          value={dnsServer?.dns_type ?? "Unset"}
          meta={dnsServer?.server ?? "Not configured"}
        />
        <SnapshotTile
          icon={<Users size={16} />}
          label="Node Groups"
          value={`${groups.length} groups`}
          meta={groups.map((g) => g.tag).join(" · ") || "None"}
        />
      </div>

      {/* ── Section Tabs ── */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">Configuration Overview</p>
          <h2 className="text-[1.2rem] font-semibold tracking-tight text-content">Runtime snapshot</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 rounded-[14px] border border-border/60 bg-muted/30 p-1.5">
          {sectionTabs.map((tab) => {
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`group inline-flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-sm font-medium transition-all ${
                  active
                    ? "bg-surface text-content shadow-sm"
                    : "text-content-muted hover:bg-surface/70 hover:text-content"
                }`}
                aria-pressed={active}
              >
                <span className={active ? "text-primary-500" : "text-content-muted group-hover:text-primary-500"}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overview Grid ── */}
      <div className={`grid gap-[18px] ${activeSection === "nodes" ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1"}`}>
        {/* Left column: section-specific list */}
        <div className="min-w-0">
          {activeSection === "nodes" && (
            <OverviewCard
              title="Groups"
              count={groups.length}
              items={groups.map((group) => {
                const isLiveGroup = isRunning && !isRuntimeTransitioning && runtimeGroupTag === group.tag;
                const isSelected = selectedOutboundTag === group.tag;
                const isSwitching = runtimePhase === "switching" && selectedOutboundTag === group.tag;
                return {
                  key: group.tag,
                  label: group.tag,
                  meta: `${group.group_members.length} members`,
                  badge: group.outbound_type,
                  badgeColor: "yellow" as const,
                  selected: isSelected,
                  isLive: isLiveGroup,
                  isSwitching,
                  onSelect: onSelectOutbound ? () => onSelectOutbound(group.tag) : undefined,
                };
              })}
            />
          )}
          {activeSection === "dns" && (
            <OverviewCard
              title="DNS"
              count={overview.dns_servers.length}
              items={overview.dns_servers.map((server) => ({
                key: server.tag,
                label: server.tag,
                meta: server.server,
                badge: server.dns_type,
                badgeColor: "green",
              }))}
            />
          )}
          {activeSection === "rules" && (
            <OverviewCard
              title="Route Rules"
              count={rulesWithOutbound}
              items={overview.route_rules.map((rule, idx) => ({
                key: `${rule.rule_type}-${idx}`,
                label: rule.summary,
                meta: [rule.rule_type, rule.action, rule.outbound].filter(Boolean).join(" · "),
                badge: "RULE",
                badgeColor: "purple",
                editable: true,
                onEdit: () => onEditRouteRule(idx, rule),
              }))}
            />
          )}
          {activeSection === "ruleSets" && (
            <OverviewCard
              title="Rule Sets"
              count={overview.rule_sets.length}
              items={overview.rule_sets.map((ruleSet) => ({
                key: ruleSet.tag,
                label: ruleSet.tag,
                meta: ruleSet.url,
                badge: ruleSet.format,
                badgeColor: "orange",
              }))}
            />
          )}
        </div>

        {/* Right column: proxy nodes (only in nodes view) */}
        {activeSection === "nodes" && (
          <div className="min-w-0">
            <OverviewCard
              title="Proxy Nodes"
              count={proxyNodes.length}
              items={proxyNodes.map((node) => {
                const isLiveNode = isRunning && !isRuntimeTransitioning && runtimeLeafTag === node.tag;
                const isSelected = selectedOutboundTag === node.tag;
                const isSwitching = runtimePhase === "switching" && selectedOutboundTag === node.tag;
                return {
                  key: node.tag,
                  label: node.tag,
                  meta: `${node.server}${node.port ? `:${node.port}` : ""}`,
                  badge: node.outbound_type,
                  badgeColor: "blue" as const,
                  selected: isSelected,
                  isLive: isLiveNode,
                  isSwitching,
                  onSelect: onSelectOutbound ? () => onSelectOutbound(node.tag) : undefined,
                };
              })}
            />
          </div>
        )}
      </div>
    </section>
  );
}

/* ── Sub-components ── */

function SnapshotTile({
  icon,
  label,
  value,
  meta,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-[14px] rounded-[14px] border border-border-muted bg-muted/35 px-4 py-4 transition-all hover:-translate-y-[1px] hover:bg-muted/55">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-primary-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-content-muted">{label}</p>
        <p className="mt-0.5 text-base font-bold text-content">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-content-secondary">{meta}</p>
      </div>
    </div>
  );
}

function OverviewCard({
  title,
  count,
  items,
}: {
  title: string;
  count: number;
  items: Array<{
    key: string;
    label: string;
    meta: string;
    badge: string;
    badgeColor: "yellow" | "green" | "blue" | "purple" | "orange";
    selected?: boolean;
    isLive?: boolean;
    isSwitching?: boolean;
    onSelect?: () => void;
    editable?: boolean;
    onEdit?: () => void;
  }>;
}) {
  const badgeColors: Record<string, string> = {
    yellow: "bg-amber-500/15 text-amber-700 dark:bg-yellow-500/20 dark:text-yellow-400",
    green: "bg-emerald-500/15 text-emerald-700 dark:bg-green-500/20 dark:text-green-400",
    blue: "bg-blue-500/12 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400",
    purple: "bg-purple-500/15 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400",
    orange: "bg-orange-500/15 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
  };

  return (
    <div className="rounded-[18px] border border-border/70 bg-surface/60">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h4 className="text-sm font-semibold text-content">{title}</h4>
        <span className="status-chip">{count}</span>
      </div>
      <div className="max-h-[400px] overflow-auto">
        {items.map((item, i) => {
          const clickable = !!item.onSelect;
          return (
            <div
              key={item.key}
              onClick={() => item.onSelect?.()}
              className={`flex items-start justify-between gap-3 px-4 py-2.5 transition-colors ${
                item.isLive ? "bg-emerald-500/10 dark:bg-emerald-500/8" :
                item.isSwitching ? "bg-primary-600/5" :
                item.selected ? "bg-primary-600/10" :
                "hover:bg-muted/30"
              } ${clickable ? "cursor-pointer" : ""} ${i !== items.length - 1 ? "border-b border-border/60" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {item.isSwitching ? (
                    <Loader2 size={14} className="shrink-0 animate-spin text-primary-500" />
                  ) : item.isLive ? (
                    <CheckCircle2 size={14} className="shrink-0 text-emerald-500" />
                  ) : item.selected ? (
                    <CheckCircle2 size={14} className="shrink-0 text-primary-500" />
                  ) : null}
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColors[item.badgeColor]}`}>
                    {item.badge}
                  </span>
                  <p className="truncate text-sm font-medium text-content">{item.label}</p>
                  {item.isSwitching && <span className="text-[10px] text-primary-500">Switching</span>}
                  {item.isLive && !item.isSwitching && <span className="text-[10px] text-emerald-500">Live</span>}
                  {item.selected && !item.isLive && !item.isSwitching && <span className="text-[10px] text-primary-500">Selected</span>}
                </div>
                <p className="mt-1 truncate text-xs text-content-secondary">{item.meta}</p>
              </div>
              {item.editable && item.onEdit && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    item.onEdit?.();
                  }}
                  className="mt-0.5 shrink-0 rounded-xl p-1.5 text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
                >
                  <Pencil size={14} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ConfigOverviewPanel;
