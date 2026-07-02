import { useMemo, useState } from "react";
import {
  FileJson,
  Globe,
  Network,
  Pencil,
  Route,
  Shield,
  Users,
} from "lucide-react";
import { ConfigOverview, RouteRuleInfo } from "../types";

type OverviewSection = "nodes" | "dns" | "rules" | "ruleSets";

interface ConfigOverviewPanelProps {
  overview: ConfigOverview;
  onEditRouteRule: (index: number, rule: RouteRuleInfo) => void;
  selectedOutboundTag: string | null;
  isRunning?: boolean;
  onToggleProxy?: () => void;
}

function ConfigOverviewPanel({
  overview,
  onEditRouteRule,
  selectedOutboundTag,
  isRunning = false,
  onToggleProxy,
}: ConfigOverviewPanelProps) {
  const [activeSection, setActiveSection] = useState<OverviewSection>("nodes");

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
  const rulesWithOutbound = overview.route_rules.filter((rule) => rule.outbound).length;

  const sectionTabs: Array<{
    id: OverviewSection;
    label: string;
    icon: React.ReactNode;
    count: string;
  }> = [
    { id: "nodes", label: "Nodes", icon: <Network size={16} />, count: `${proxyNodes.length}` },
    { id: "dns", label: "DNS", icon: <Globe size={16} />, count: `${overview.dns_servers.length}` },
    { id: "rules", label: "Rules", icon: <Route size={16} />, count: `${overview.route_rules_count}` },
    { id: "ruleSets", label: "Rule Sets", icon: <FileJson size={16} />, count: `${overview.rule_sets.length}` },
  ];

  return (
    <section className="space-y-[18px]">
      {/* ── Hero Connection Card ── */}
      <div className="flex flex-col items-center rounded-[20px] border border-border bg-gradient-to-br from-surface/70 to-surface-elevated/60 px-6 pb-5 pt-7 text-center">
        <div
          className={`mb-4 flex h-[72px] w-[72px] items-center justify-center rounded-[24px] shadow-lg transition-all ${
            isRunning
              ? "bg-emerald-500/20 text-emerald-400 shadow-emerald-500/20"
              : "bg-muted text-muted-foreground shadow-transparent"
          }`}
        >
          <Shield size={36} strokeWidth={2} />
        </div>

        <h3 className="mb-1 text-xl font-bold tracking-tight text-content">
          {isRunning ? "Connected" : "Disconnected"}
        </h3>
        <p className="mb-5 text-sm text-content-secondary">
          {isRunning ? "sing-box core is running" : "Proxy is stopped"}
        </p>

        <label className="relative mb-5 inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={isRunning}
            onChange={() => onToggleProxy?.()}
            className="peer sr-only"
          />
          <span className="h-7 w-[52px] rounded-full border border-border/80 bg-muted transition-colors peer-checked:border-emerald-500/40 peer-checked:bg-emerald-500/20" />
          <span className="pointer-events-none absolute left-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-[26px] peer-checked:bg-emerald-500 dark:bg-slate-200" />
        </label>

        <div className="flex items-center justify-center gap-10">
          <div className="text-center">
            <span className="text-base font-bold tabular-nums text-content">{activeOutbound?.tag ?? "auto"}</span>
            <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.08em] text-content-muted">Route</span>
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
        <div className="flex flex-wrap gap-2">
          {sectionTabs.map((tab) => {
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveSection(tab.id)}
                className={`group inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-all ${
                  active
                    ? "border-primary-500/30 bg-primary-500/10 text-primary-500 shadow-sm"
                    : "border-border/70 bg-surface/60 text-content-secondary hover:border-primary-500/25 hover:bg-primary-500/5 hover:text-content"
                }`}
                aria-pressed={active}
              >
                <span className={active ? "text-primary-500" : "text-content-muted group-hover:text-primary-500"}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                    active ? "bg-primary-500/20 text-primary-500" : "bg-surface-elevated text-content-muted"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Overview Grid ── */}
      <div className="grid grid-cols-1 gap-[18px] xl:grid-cols-2">
        {/* Left column: section-specific list */}
        <div className="min-w-0">
          {activeSection === "nodes" && (
            <OverviewCard
              title="Groups"
              count={groups.length}
              items={groups.map((group) => ({
                key: group.tag,
                label: group.tag,
                meta: `${group.group_members.length} members`,
                badge: group.outbound_type,
                badgeColor: "yellow",
              }))}
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

        {/* Right column: proxy nodes (only in nodes view) or secondary info */}
        {activeSection === "nodes" ? (
          <div className="min-w-0">
            <OverviewCard
              title="Proxy Nodes"
              count={proxyNodes.length}
              items={proxyNodes.map((node) => ({
                key: node.tag,
                label: node.tag,
                meta: `${node.server}${node.port ? `:${node.port}` : ""}`,
                badge: node.outbound_type,
                badgeColor: "blue",
                selected: selectedOutboundTag === node.tag,
              }))}
            />
          </div>
        ) : (
          <div className="hidden min-w-0 xl:flex xl:items-center xl:justify-center">
            <div className="rounded-[18px] border border-border/60 bg-surface/40 px-6 py-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-500">
                <Network size={22} />
              </div>
              <p className="text-sm font-medium text-content">Switch to Nodes</p>
              <p className="mt-1 text-xs text-content-secondary">to see paired proxy nodes and groups</p>
            </div>
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
    editable?: boolean;
    onEdit?: () => void;
  }>;
}) {
  const badgeColors: Record<string, string> = {
    yellow: "bg-yellow-500/20 text-yellow-600 dark:text-yellow-400",
    green: "bg-green-500/20 text-green-600 dark:text-green-400",
    blue: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
    purple: "bg-purple-500/20 text-purple-600 dark:text-purple-400",
    orange: "bg-orange-500/20 text-orange-600 dark:text-orange-400",
  };

  return (
    <div className="rounded-[18px] border border-border/70 bg-surface/60">
      <div className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <h4 className="text-sm font-semibold text-content">{title}</h4>
        <span className="status-chip">{count}</span>
      </div>
      <div className="max-h-[400px] overflow-auto">
        {items.map((item, i) => (
          <div
            key={item.key}
            className={`flex items-start justify-between gap-3 px-4 py-2.5 transition-colors ${
              item.selected ? "bg-primary-600/10" : "hover:bg-muted/30"
            } ${i !== items.length - 1 ? "border-b border-border/60" : ""}`}
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badgeColors[item.badgeColor]}`}>
                  {item.badge}
                </span>
                <p className="truncate text-sm font-medium text-content">{item.label}</p>
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
        ))}
      </div>
    </div>
  );
}

export default ConfigOverviewPanel;
