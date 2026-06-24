import {
  Globe,
  Shield,
  Router,
  Server,
  ArrowRightLeft,
  Database,
  FileJson,
  Pencil,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  MousePointerClick,
  Network,
  Layers3,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { ConfigOverview, RouteRuleInfo } from "../types";

interface ConfigOverviewPanelProps {
  overview: ConfigOverview;
  onEditRouteRule: (index: number, rule: RouteRuleInfo) => void;
  selectedOutboundTag: string | null;
  onSelectOutbound: (tag: string) => void;
}

function ConfigOverviewPanel({
  overview,
  onEditRouteRule,
  selectedOutboundTag,
  onSelectOutbound,
}: ConfigOverviewPanelProps) {
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    inbounds: true,
    outboundGroups: true,
    proxyNodes: true,
    dnsServers: true,
    routeRules: true,
    ruleSets: true,
  });
  const proxyNodes = overview.outbounds.filter(
    (o) => !["direct", "block", "selector", "urltest"].includes(o.outbound_type)
  );
  const groups = overview.outbounds.filter((o) => o.is_group);
  const activeOutbound = overview.outbounds.find((o) => o.tag === selectedOutboundTag) ?? null;
  const primaryInbound = overview.inbounds[0] ?? null;
  const rulesWithOutbound = overview.route_rules.filter((rule) => rule.outbound).length;

  const toggleSection = (key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-5">
      <div className="panel-card rounded-[24px] p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <p className="section-label mb-2">Configuration Overview</p>
            <h2 className="text-2xl font-semibold tracking-tight text-content">Runtime configuration map</h2>
            <p className="mt-2 max-w-2xl text-sm text-content-secondary">
              Review inbound mode, outbound hierarchy, DNS routing, and rule assets from the current active profile.
            </p>
            <div className="flex flex-wrap gap-2">
              <SummaryPill
                icon={<Sparkles size={13} />}
                label="Active target"
                value={activeOutbound?.tag ?? "Not selected"}
              />
              <SummaryPill
                icon={<Layers3 size={13} />}
                label="Groups"
                value={`${groups.length} available`}
              />
              <SummaryPill
                icon={<Network size={13} />}
                label="Inbound mode"
                value={primaryInbound?.inbound_type ?? "Unknown"}
              />
            </div>
          </div>
          <div className="surface-block rounded-2xl px-4 py-3 xl:min-w-[20rem]">
            <div className="flex items-center gap-2 text-xs text-content-secondary">
              <FileJson size={14} className="shrink-0" />
              <span className="section-label !tracking-[0.14em]">Active file</span>
            </div>
            <span className="mt-1 block max-w-[34rem] truncate text-sm font-medium text-content">{overview.file_path}</span>
          </div>
        </div>
      </div>

      {/* File path */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard
          icon={<Server size={16} />}
          label="Outbounds"
          value={String(overview.outbounds.length)}
          meta={`${proxyNodes.length} nodes / ${groups.length} groups`}
          color="text-blue-500 dark:text-blue-400"
        />
        <StatCard
          icon={<Globe size={16} />}
          label="DNS Servers"
          value={String(overview.dns_servers.length)}
          meta={overview.dns_servers[0]?.server ?? "No DNS server"}
          color="text-green-500 dark:text-green-400"
        />
        <StatCard
          icon={<Router size={16} />}
          label="Route Rules"
          value={String(overview.route_rules_count)}
          meta={`${rulesWithOutbound} rules target outbound`}
          color="text-purple-500 dark:text-purple-400"
        />
        <StatCard
          icon={<Database size={16} />}
          label="Rule Sets"
          value={String(overview.rule_sets.length)}
          meta={overview.rule_sets[0]?.tag ?? "No remote set"}
          color="text-orange-500 dark:text-orange-400"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          sectionKey="inbounds"
          title="Inbounds"
          count={overview.inbounds.length}
          icon={<ArrowRightLeft size={15} />}
          open={openSections.inbounds}
          onToggle={toggleSection}
        >
          {overview.inbounds.map((inbound, idx) => (
            <div key={idx} className="subtle-row flex items-center justify-between rounded-2xl p-3">
              <div className="flex items-center gap-2">
                <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                  {inbound.inbound_type.toUpperCase()}
                </span>
                <span className="text-sm text-content">{inbound.tag}</span>
              </div>
              <span className="text-xs text-content-secondary">{inbound.details}</span>
            </div>
          ))}
        </Section>

        {groups.length > 0 && (
          <Section
            sectionKey="outboundGroups"
            title="Outbound Groups"
            count={groups.length}
            icon={<Shield size={15} />}
            open={openSections.outboundGroups}
            onToggle={toggleSection}
          >
            {groups.map((group, idx) => {
              const isSelected = selectedOutboundTag === group.tag;
              return (
              <button
                type="button"
                key={idx}
                onClick={() => onSelectOutbound(group.tag)}
                className={`w-full space-y-2 rounded-2xl p-3 text-left transition-all ${
                  isSelected
                    ? "bg-primary-600/10 border border-primary-500/30"
                    : "subtle-row"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {isSelected ? (
                      <CheckCircle2 size={14} className="text-primary-500" />
                    ) : (
                      <MousePointerClick size={14} className="text-content-muted" />
                    )}
                    <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded font-medium">
                      {group.outbound_type.toUpperCase()}
                    </span>
                    <span className="text-sm text-content font-medium">{group.tag}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSelected && <span className="status-chip status-chip-primary">Active</span>}
                    <span className="text-xs text-content-secondary">{group.details}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-1">
                  {group.group_members.map((member, mIdx) => (
                    <span key={mIdx} className="rounded-xl bg-surface-elevated px-2 py-0.5 text-[11px] text-content-secondary">
                      {member}
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[11px] text-content-muted">
                  <span>{group.group_members.length} candidates</span>
                  <span>Click to route traffic through this group</span>
                </div>
              </button>
            )})}
          </Section>
        )}

        <Section
          sectionKey="proxyNodes"
          title="Proxy Nodes"
          count={proxyNodes.length}
          icon={<Server size={15} />}
          open={openSections.proxyNodes}
          onToggle={toggleSection}
        >
          {proxyNodes.map((node, idx) => {
            const isSelected = selectedOutboundTag === node.tag;
            return (
            <button
              type="button"
              key={idx}
              onClick={() => onSelectOutbound(node.tag)}
              className={`flex w-full items-center justify-between rounded-2xl p-3 text-left transition-all ${
                isSelected
                  ? "bg-primary-600/10 border border-primary-500/30"
                  : "subtle-row"
              }`}
            >
              <div className="flex items-center gap-2">
                {isSelected ? (
                  <CheckCircle2 size={14} className="text-primary-500" />
                ) : (
                  <MousePointerClick size={14} className="text-content-muted" />
                )}
                <span className="text-[10px] bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">
                  {node.outbound_type.toUpperCase()}
                </span>
                <span className="text-sm text-content">{node.tag}</span>
              </div>
              <div className="text-right">
                {isSelected && <p className="mb-1 text-[11px] font-medium text-primary-500">Current route target</p>}
                <p className="text-xs text-content-secondary">
                  {node.server}{node.port > 0 && `:${node.port}`}
                </p>
                <p className="text-[11px] text-content-muted">{node.details}</p>
              </div>
            </button>
          )})}
        </Section>

        <Section
          sectionKey="dnsServers"
          title="DNS Servers"
          count={overview.dns_servers.length}
          icon={<Globe size={15} />}
          open={openSections.dnsServers}
          onToggle={toggleSection}
        >
          <div className="grid grid-cols-1 gap-1.5">
            {overview.dns_servers.map((dns, idx) => (
              <div key={idx} className="subtle-row flex items-center justify-between rounded-2xl p-3">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-green-500/20 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                    {dns.dns_type.toUpperCase()}
                  </span>
                  <span className="text-sm text-content">{dns.tag}</span>
                </div>
                <span className="text-xs text-content-secondary">{dns.server}</span>
              </div>
            ))}
          </div>
        </Section>

        {overview.route_rules.length > 0 && (
          <Section
            sectionKey="routeRules"
            title="Route Rules"
            count={overview.route_rules.length}
            icon={<Router size={15} />}
            open={openSections.routeRules}
            onToggle={toggleSection}
          >
            <div className="space-y-1.5">
              {overview.route_rules.map((rule, idx) => (
                <div key={idx} className="subtle-row flex items-start justify-between gap-3 rounded-2xl p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-purple-500/20 text-purple-600 dark:text-purple-400 px-1.5 py-0.5 rounded font-medium">
                        RULE
                      </span>
                      {rule.action && (
                        <span className="text-[10px] bg-surface-elevated text-content-secondary px-1.5 py-0.5 rounded">
                          {rule.action}
                        </span>
                      )}
                      {rule.outbound && (
                        <span className="text-[10px] bg-surface-elevated text-content-secondary px-1.5 py-0.5 rounded">
                          {rule.outbound}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate text-sm text-content">{rule.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onEditRouteRule(idx, rule)}
                    className="shrink-0 rounded p-1.5 text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
                    title="Edit rule"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              ))}
            </div>
          </Section>
        )}

        {overview.rule_sets.length > 0 && (
          <Section
            sectionKey="ruleSets"
            title="Rule Sets"
            count={overview.rule_sets.length}
            icon={<Database size={15} />}
            open={openSections.ruleSets}
            onToggle={toggleSection}
          >
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {overview.rule_sets.map((rs, idx) => (
                <div key={idx} className="subtle-row flex items-center gap-2 rounded-2xl p-3">
                  <span className="text-[10px] bg-orange-500/20 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded font-medium">
                    {rs.rule_type.toUpperCase()}
                  </span>
                  <span className="text-xs text-content truncate">{rs.tag}</span>
                </div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}

function SummaryPill({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="surface-block flex items-center gap-2 rounded-full px-3 py-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-elevated text-content-secondary">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
        <p className="truncate text-xs font-medium text-content">{value}</p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  meta,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  meta: string;
  color: string;
}) {
  return (
    <div className="panel-card rounded-[22px] p-4">
      <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated ${color}`}>{icon}</div>
      <p className="text-2xl font-semibold tracking-tight text-content">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-content-secondary">{label}</p>
      <p className="mt-2 truncate text-xs text-content-muted">{meta}</p>
    </div>
  );
}

function Section({
  sectionKey,
  title,
  count,
  icon,
  children,
  open,
  onToggle,
}: {
  sectionKey: string;
  title: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="panel-card rounded-[24px] p-4">
      <button
        type="button"
        onClick={() => onToggle(sectionKey)}
        className="mb-3 flex w-full items-center gap-2 rounded-2xl px-2 py-2 text-left transition-colors hover:bg-surface-elevated/60"
      >
        <span className="text-content-secondary">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-surface-elevated text-content-secondary">{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-content">{title}</h3>
          <p className="text-[11px] text-content-muted">Expand to inspect current configuration</p>
        </div>
        <span className="status-chip">{count}</span>
      </button>
      {open && <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

export default ConfigOverviewPanel;
