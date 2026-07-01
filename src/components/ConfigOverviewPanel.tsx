import { useMemo, useState } from "react";
import {
  FileJson,
  Globe,
  Layers3,
  Network,
  Pencil,
  Route,
  Sparkles,
} from "lucide-react";
import { ConfigOverview, RouteRuleInfo } from "../types";

type OverviewSection = "nodes" | "dns" | "rules" | "ruleSets";

interface ConfigOverviewPanelProps {
  overview: ConfigOverview;
  onEditRouteRule: (index: number, rule: RouteRuleInfo) => void;
  selectedOutboundTag: string | null;
}

function ConfigOverviewPanel({
  overview,
  onEditRouteRule,
  selectedOutboundTag,
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
  const dnsLocalCount = overview.dns_servers.filter((server) => server.dns_type === "local").length;
  const dnsRemoteCount = overview.dns_servers.length - dnsLocalCount;

  const sectionTabs: Array<{
    id: OverviewSection;
    label: string;
    icon: React.ReactNode;
    count: string;
  }> = [
    { id: "nodes", label: "Nodes", icon: <Network size={13} />, count: `${proxyNodes.length}` },
    { id: "dns", label: "DNS", icon: <Globe size={13} />, count: `${overview.dns_servers.length}` },
    { id: "rules", label: "Rules", icon: <Route size={13} />, count: `${overview.route_rules_count}` },
    { id: "ruleSets", label: "Rule Sets", icon: <FileJson size={13} />, count: `${overview.rule_sets.length}` },
  ];

  return (
    <section className="panel-card rounded-[22px] p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="section-label mb-1.5">Configuration Overview</p>
            <h2 className="text-[1.2rem] font-semibold tracking-tight text-content">
              Runtime snapshot
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            {sectionTabs.map((tab) => {
              const active = activeSection === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveSection(tab.id)}
                  className={`overview-subtab ${active ? "active" : ""}`}
                  aria-pressed={active}
                >
                  <span className="flex items-center gap-1.5">
                    {tab.icon}
                    <span>{tab.label}</span>
                  </span>
                  <span className="rounded-full bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
          <SnapshotChip
            icon={<Sparkles size={13} />}
            label="Route target"
            value={activeOutbound?.tag ?? "Not selected"}
            detail={
              activeOutbound
                ? activeOutbound.is_group
                  ? `${activeOutbound.outbound_type} group`
                  : activeOutbound.outbound_type
                : "Choose a node or group"
            }
          />
          <SnapshotChip
            icon={<Network size={13} />}
            label="Inbound"
            value={primaryInbound?.inbound_type ?? "Unknown"}
            detail={primaryInbound?.tag ?? "No inbound tag"}
          />
          <SnapshotChip
            icon={<Globe size={13} />}
            label="DNS"
            value={dnsServer?.tag ?? "Unset"}
            detail={dnsServer?.server ?? "No DNS server configured"}
          />
          <SnapshotChip
            icon={<Layers3 size={13} />}
            label="Nodes / Groups"
            value={`${proxyNodes.length} / ${groups.length}`}
            detail={`${rulesWithOutbound} rule targets`}
          />
        </div>
      </div>

      <div className="mt-3 rounded-[20px] border border-border/70 bg-white/20 p-3 dark:bg-slate-950/15">
        {activeSection === "nodes" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.35fr)]">
              <div className="space-y-2">
                <SectionTitle
                  title="Groups"
                  meta={`${groups.length}`}
                />
                <div className="overflow-hidden rounded-[18px] border border-border/70">
                  {groups.map((group, index) => {
                    return (
                      <div
                        key={group.tag}
                        className={`flex flex-wrap items-center gap-2 px-3 py-2.5 ${
                          index !== groups.length - 1 ? "border-b border-border/60" : ""
                        }`}
                      >
                        <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                          {group.outbound_type}
                        </span>
                        <p className="truncate text-sm font-medium text-content">{group.tag}</p>
                        <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-content-secondary">
                          {group.group_members.length} members
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <SectionTitle
                  title="Nodes"
                  meta={`${proxyNodes.length}`}
                />
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {proxyNodes.map((node) => {
                    const isSelected = selectedOutboundTag === node.tag;

                    return (
                      <div
                        key={node.tag}
                        className={`subtle-row rounded-2xl px-3 py-2.5 ${
                          isSelected ? "border-primary-500/30 bg-primary-600/10" : ""
                        }`}
                        title={`${node.server}${node.port ? `:${node.port}` : ""}`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                            {node.outbound_type}
                          </span>
                          <p className="truncate text-sm font-medium text-content">{node.tag}</p>
                          {isSelected && <span className="text-[10px] text-primary-500">Active</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeSection === "dns" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
              <CompactRow
                label="Servers"
                value={`${overview.dns_servers.length}`}
                detail={`${dnsLocalCount} local / ${dnsRemoteCount} remote`}
              />
              <CompactRow
                label="Primary"
                value={dnsServer?.tag ?? "Unset"}
                detail={dnsServer?.dns_type ?? "No DNS server configured"}
              />
              <CompactRow
                label="Address"
                value={dnsServer?.server ?? "Unavailable"}
                detail="Top-level DNS server"
              />
            </div>

            <div className="space-y-2">
              <SectionTitle
                title="DNS Servers"
                meta={`${overview.dns_servers.length}`}
              />
              <div className="overflow-hidden rounded-[18px] border border-border/70">
                {overview.dns_servers.map((server, index) => (
                  <div
                    key={server.tag}
                    className={`flex flex-col gap-1.5 px-3 py-2.5 ${
                      index !== overview.dns_servers.length - 1 ? "border-b border-border/60" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                        {server.dns_type}
                      </span>
                      <p className="text-sm font-medium text-content">{server.tag}</p>
                    </div>
                    <p className="break-all text-xs leading-5 text-content-secondary">{server.server}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeSection === "rules" && (
          <div className="space-y-2">
            <SectionTitle
              title="Editable Rules"
              meta={`${rulesWithOutbound}`}
            />
            <div className="overflow-hidden rounded-[18px] border border-border/70">
              {overview.route_rules.map((rule, idx) => (
                <button
                  key={`${rule.rule_type}-${idx}`}
                  type="button"
                  onClick={() => onEditRouteRule(idx, rule)}
                  className={`flex w-full items-start justify-between gap-3 px-3 py-3 text-left transition-all hover:bg-white/5 dark:hover:bg-white/[0.03] ${
                    idx !== overview.route_rules.length - 1 ? "border-b border-border/60" : ""
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                        RULE
                      </span>
                      {rule.rule_type && (
                        <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                          {rule.rule_type}
                        </span>
                      )}
                      {rule.action && (
                        <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                          {rule.action}
                        </span>
                      )}
                      {rule.outbound && (
                        <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                          {rule.outbound}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm font-medium text-content">{rule.summary}</p>
                  </div>
                  <Pencil size={14} className="mt-0.5 shrink-0 text-content-muted" />
                </button>
              ))}
            </div>
          </div>
        )}

        {activeSection === "ruleSets" && (
          <div className="space-y-2">
            <SectionTitle
              title="Rule Sets"
              meta={`${overview.rule_sets.length}`}
            />
            <div className="overflow-hidden rounded-[18px] border border-border/70">
              {overview.rule_sets.map((ruleSet, index) => (
                <div
                  key={ruleSet.tag}
                  className={`flex flex-col gap-1.5 px-3 py-2.5 ${
                    index !== overview.rule_sets.length - 1 ? "border-b border-border/60" : ""
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                      {ruleSet.rule_type}
                    </span>
                    <p className="text-sm font-medium text-content">{ruleSet.tag}</p>
                    <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                      {ruleSet.format}
                    </span>
                  </div>
                  <p className="break-all text-xs leading-5 text-content-secondary">{ruleSet.url}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SnapshotChip({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="surface-block rounded-[18px] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-elevated text-content-secondary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
          <p className="truncate text-sm font-medium text-content">{value}</p>
          <p className="mt-0.5 truncate text-[11px] text-content-secondary">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function CompactRow({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="subtle-row rounded-2xl px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-content">{value}</p>
      <p className="mt-1 truncate text-[11px] text-content-secondary">{detail}</p>
    </div>
  );
}

function SectionTitle({
  title,
  meta,
}: {
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold text-content">{title}</h4>
      <span className="status-chip">{meta}</span>
    </div>
  );
}

export default ConfigOverviewPanel;
