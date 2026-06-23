import {
  Globe,
  Shield,
  Router,
  Server,
  ArrowRightLeft,
  Database,
  FileJson,
  Pencil,
} from "lucide-react";
import { ConfigOverview, RouteRuleInfo } from "../types";

interface ConfigOverviewPanelProps {
  overview: ConfigOverview;
  onEditRouteRule: (index: number, rule: RouteRuleInfo) => void;
}

function ConfigOverviewPanel({ overview, onEditRouteRule }: ConfigOverviewPanelProps) {
  const proxyNodes = overview.outbounds.filter(
    (o) => !["direct", "block", "selector", "urltest"].includes(o.outbound_type)
  );
  const groups = overview.outbounds.filter((o) => o.is_group);

  return (
    <div className="space-y-4">
      {/* File path */}
      <div className="flex items-center gap-2 text-xs text-content-secondary bg-card/50 px-3 py-2 rounded-lg">
        <FileJson size={14} className="shrink-0" />
        <span className="truncate">{overview.file_path}</span>
      </div>

      {/* Stats summary bar */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<Server size={16} />} label="Outbounds" value={String(overview.outbounds.length)} color="text-blue-500 dark:text-blue-400" />
        <StatCard icon={<Globe size={16} />} label="DNS Servers" value={String(overview.dns_servers.length)} color="text-green-500 dark:text-green-400" />
        <StatCard icon={<Router size={16} />} label="Route Rules" value={String(overview.route_rules_count)} color="text-purple-500 dark:text-purple-400" />
        <StatCard icon={<Database size={16} />} label="Rule Sets" value={String(overview.rule_sets.length)} color="text-orange-500 dark:text-orange-400" />
      </div>

      {/* Inbounds */}
      <Section title="Inbounds" icon={<ArrowRightLeft size={15} />}>
        {overview.inbounds.map((inbound, idx) => (
          <div key={idx} className="flex items-center justify-between p-2.5 bg-card/50 rounded-lg">
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

      {/* Outbound Groups */}
      {groups.length > 0 && (
        <Section title="Outbound Groups" icon={<Shield size={15} />}>
          {groups.map((group, idx) => (
            <div key={idx} className="p-2.5 bg-card/50 rounded-lg space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded font-medium">
                    {group.outbound_type.toUpperCase()}
                  </span>
                  <span className="text-sm text-content font-medium">{group.tag}</span>
                </div>
                <span className="text-xs text-content-secondary">{group.details}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 pl-1">
                {group.group_members.map((member, mIdx) => (
                  <span key={mIdx} className="text-[11px] bg-surface-elevated text-content-secondary px-2 py-0.5 rounded">
                    {member}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Proxy Nodes */}
      <Section title="Proxy Nodes" icon={<Server size={15} />}>
        {proxyNodes.map((node, idx) => (
          <div key={idx} className="flex items-center justify-between p-2.5 bg-card/50 rounded-lg">
            <div className="flex items-center gap-2">
              <span className="text-[10px] bg-blue-500/20 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded font-medium">
                {node.outbound_type.toUpperCase()}
              </span>
              <span className="text-sm text-content">{node.tag}</span>
            </div>
            <div className="text-right">
              <p className="text-xs text-content-secondary">
                {node.server}{node.port > 0 && `:${node.port}`}
              </p>
              <p className="text-[11px] text-content-muted">{node.details}</p>
            </div>
          </div>
        ))}
      </Section>

      {/* DNS Servers */}
      <Section title="DNS Servers" icon={<Globe size={15} />}>
        <div className="grid grid-cols-1 gap-1.5">
          {overview.dns_servers.map((dns, idx) => (
            <div key={idx} className="flex items-center justify-between p-2.5 bg-card/50 rounded-lg">
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

      {/* Route Rules */}
      {overview.route_rules.length > 0 && (
        <Section title="Route Rules" icon={<Router size={15} />}>
          <div className="space-y-1.5">
            {overview.route_rules.map((rule, idx) => (
              <div key={idx} className="flex items-start justify-between gap-3 rounded-lg bg-card/50 p-2.5">
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

      {/* Rule Sets */}
      {overview.rule_sets.length > 0 && (
        <Section title="Rule Sets" icon={<Database size={15} />}>
          <div className="grid grid-cols-2 gap-1.5">
            {overview.rule_sets.map((rs, idx) => (
              <div key={idx} className="flex items-center gap-2 p-2 bg-card/50 rounded-lg">
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
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-card/50 border border-border rounded-lg p-3 text-center">
      <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
      <p className="text-lg font-bold text-content">{value}</p>
      <p className="text-[10px] text-content-secondary">{label}</p>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-content-secondary">{icon}</span>
        <h3 className="text-sm font-medium text-content">{title}</h3>
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

export default ConfigOverviewPanel;
