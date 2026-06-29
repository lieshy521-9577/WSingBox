import { useMemo, useState } from "react";
import {
  ChevronRight,
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
    <div className="space-y-3">
      <section className="panel-card rounded-[22px] p-4">
        <div className="space-y-3">
          <div>
            <p className="section-label mb-1.5">Configuration Overview</p>
            <h2 className="text-[1.35rem] font-semibold tracking-tight text-content">
              Runtime snapshot
            </h2>
            <p className="mt-2 max-w-2xl text-[13px] leading-5 text-content-secondary">
              A compact view of the active runtime state and the imported profile behind it.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
            <SnapshotChip
              icon={<Sparkles size={13} />}
              label="Route target"
              value={activeOutbound?.tag ?? "Not selected"}
              detail={
                activeOutbound
                  ? activeOutbound.is_group
                    ? `${activeOutbound.outbound_type} group`
                    : `${activeOutbound.outbound_type}${activeOutbound.server ? ` - ${activeOutbound.server}` : ""}`
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
              detail="Manage membership in the Nodes page"
            />
            <SnapshotChip
              icon={<Route size={13} />}
              label="Route Rules"
              value={String(overview.route_rules_count)}
              detail={`${rulesWithOutbound} target outbound`}
            />
            <SnapshotChip
              icon={<FileJson size={13} />}
              label="Rule Sets"
              value={String(overview.rule_sets.length)}
              detail={overview.rule_sets[0]?.tag ?? "No remote set"}
            />
          </div>
        </div>
      </section>

      <section className="panel-card rounded-[22px] p-4">
        <div className="flex flex-col gap-3 border-b border-border/60 pb-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-content">Overview workspace</h3>
            <p className="mt-1 text-[11px] text-content-muted">
              Switch between node, DNS, rule, and rule-set details without leaving Overview.
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4 lg:w-auto lg:min-w-[30rem] lg:grid-cols-4">
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

        <div className="pt-4">
          {activeSection === "nodes" && (
            <div className="space-y-3">
              <section className="surface-block rounded-[20px] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-content">Groups</h4>
                    <p className="mt-1 text-[11px] text-content-muted">
                      Selector and urltest groups extracted from the active profile.
                    </p>
                  </div>
                  <span className="status-chip">{groups.length}</span>
                </div>
                <div className="space-y-2">
                  {groups.map((group) => (
                    <div key={group.tag} className="subtle-row rounded-2xl px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-yellow-500/20 px-1.5 py-0.5 text-[10px] font-medium text-yellow-600 dark:text-yellow-400">
                          {group.outbound_type}
                        </span>
                        <p className="text-sm font-medium text-content">{group.tag}</p>
                        {selectedOutboundTag === group.tag && (
                          <span className="status-chip status-chip-primary">Active</span>
                        )}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-content-secondary">
                        <span className="rounded-full bg-surface-elevated px-2 py-1">
                          members: {group.group_members.length}
                        </span>
                        {group.details && (
                          <span className="rounded-full bg-surface-elevated px-2 py-1">
                            {group.details}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="surface-block rounded-[20px] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-content">Nodes</h4>
                    <p className="mt-1 text-[11px] text-content-muted">
                      Direct outbound nodes available for selection.
                    </p>
                  </div>
                  <span className="status-chip">{proxyNodes.length}</span>
                </div>
                <div className="grid grid-cols-1 gap-2 xl:grid-cols-2 2xl:grid-cols-3">
                  {proxyNodes.map((node) => {
                    const isSelected = selectedOutboundTag === node.tag;

                    return (
                      <div
                        key={node.tag}
                        className={`subtle-row rounded-2xl px-3 py-2.5 ${
                          isSelected ? "border-primary-500/30 bg-primary-600/10" : ""
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                                {node.outbound_type}
                              </span>
                              <p className="truncate text-sm font-medium text-content">{node.tag}</p>
                              {isSelected && <span className="status-chip status-chip-primary">Active</span>}
                            </div>
                          </div>
                          <ChevronRight size={14} className="shrink-0 text-content-muted" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>
          )}

          {activeSection === "dns" && (
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
              <section className="surface-block rounded-[20px] p-4">
                <h4 className="text-sm font-semibold text-content">DNS Summary</h4>
                <p className="mt-1 text-[11px] text-content-muted">
                  Top-level DNS target and server list from the current profile.
                </p>
                <div className="mt-3 space-y-2">
                  <CompactRow
                    label="Final"
                    value={dnsServer?.tag ?? "Unset"}
                    detail={
                      dnsServer
                        ? `${dnsServer.dns_type} - ${dnsServer.server}`
                        : "No server configured"
                    }
                  />
                  <CompactRow
                    label="Servers"
                    value={`${overview.dns_servers.length}`}
                    detail={
                      overview.dns_servers.length > 0
                        ? `${overview.dns_servers.filter((server) => server.dns_type === "local").length} local, ${overview.dns_servers.filter((server) => server.dns_type !== "local").length} remote`
                        : "No DNS servers configured"
                    }
                  />
                </div>
              </section>

              <section className="surface-block rounded-[20px] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-content">DNS Servers</h4>
                    <p className="mt-1 text-[11px] text-content-muted">
                      All configured DNS servers in the active profile.
                    </p>
                  </div>
                  <span className="status-chip">{overview.dns_servers.length}</span>
                </div>
                <div className="space-y-2">
                  {overview.dns_servers.map((server) => (
                    <div key={server.tag} className="subtle-row rounded-2xl px-3 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                            {server.dns_type}
                          </span>
                          <p className="text-sm font-medium text-content">{server.tag}</p>
                        </div>
                        <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-content-secondary">
                          DNS server
                        </span>
                      </div>
                      <p className="mt-2 break-all text-xs leading-5 text-content-secondary">{server.server}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-content-secondary">
                          tag: {server.tag}
                        </span>
                        <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-content-secondary">
                          type: {server.dns_type}
                        </span>
                        {server.server && (
                          <span className="rounded-full bg-surface-elevated px-2 py-1 text-[10px] text-content-secondary">
                            address: {server.server}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {activeSection === "rules" && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-content">Editable rules</h4>
                  <p className="mt-1 text-[11px] text-content-muted">
                    {overview.route_rules_count} total rules, all available here for editing.
                  </p>
                </div>
                <span className="status-chip">{rulesWithOutbound} target outbound</span>
              </div>
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {overview.route_rules.map((rule, idx) => (
                  <button
                    key={`${rule.rule_type}-${idx}`}
                    type="button"
                    onClick={() => onEditRouteRule(idx, rule)}
                    className="subtle-row flex items-start justify-between gap-3 rounded-[20px] p-3 text-left transition-all hover:border-border"
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
                      <p className="mt-1 truncate text-sm font-medium text-content">{rule.summary}</p>
                      <p className="mt-1 truncate text-[11px] text-content-secondary">
                        Click to open the full JSON editor
                      </p>
                    </div>
                    <Pencil size={14} className="shrink-0 text-content-muted" />
                  </button>
                ))}
              </div>
            </section>
          )}

          {activeSection === "ruleSets" && (
            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-content">Rule Sets</h4>
                  <p className="mt-1 text-[11px] text-content-muted">
                    Remote and local rule-set definitions loaded by the profile.
                  </p>
                </div>
                <span className="status-chip">{overview.rule_sets.length}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 xl:grid-cols-2">
                {overview.rule_sets.map((ruleSet) => (
                  <div key={ruleSet.tag} className="subtle-row rounded-[20px] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-medium text-orange-600 dark:text-orange-400">
                        {ruleSet.rule_type}
                      </span>
                      <p className="text-sm font-medium text-content">{ruleSet.tag}</p>
                      <span className="rounded bg-surface-elevated px-1.5 py-0.5 text-[10px] text-content-secondary">
                        {ruleSet.format}
                      </span>
                    </div>
                    <p className="mt-1.5 break-all text-xs text-content-secondary">{ruleSet.url}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
    </div>
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
    <div className="surface-block rounded-[18px] px-3.5 py-2.5">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-elevated text-content-secondary">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
          <p className="truncate text-sm font-medium text-content">{value}</p>
        </div>
      </div>
      <p className="mt-2 truncate text-[11px] text-content-secondary">{detail}</p>
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
    <div className="surface-block rounded-[18px] px-3.5 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-content">{value}</p>
      <p className="mt-1 truncate text-[11px] text-content-secondary">{detail}</p>
    </div>
  );
}

export default ConfigOverviewPanel;
