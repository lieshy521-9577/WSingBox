import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Database, Globe, Loader2, Power, Shield, Settings2, Check } from "lucide-react";
import { AppSettings } from "../types";

interface SettingsPanelProps {
  onSaved: () => Promise<void>;
}

type SettingsSection = "inbound" | "ruleSets" | "tun" | "dns";

const defaultSettings: AppSettings = {
  autostart_enabled: false,
  tun_enabled: false,
  mixed_listen: "127.0.0.1",
  mixed_port: 7890,
  tun_interface_name: "singbox",
  tun_mtu: 9000,
  tun_stack: "mixed",
  tun_auto_route: true,
  tun_strict_route: true,
  tun_sniff: true,
  tun_sniff_override_destination: true,
  tun_address: ["172.19.0.1/30"],
  dns_final: "google",
  dns_strategy: "auto",
  dns_servers: [],
};

function SettingsPanel({ onSaved }: SettingsPanelProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [dnsServersText, setDnsServersText] = useState("[]");
  const [ruleSetsText, setRuleSetsText] = useState("[]");
  const [tunAddressText, setTunAddressText] = useState("172.19.0.1/30");
  const [activeSection, setActiveSection] = useState<SettingsSection>("inbound");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [autostartSaving, setAutostartSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections: { id: SettingsSection; label: string; icon: React.ReactNode }[] = [
    { id: "inbound", label: "Inbound", icon: <ArrowRightLeft size={15} /> },
    { id: "ruleSets", label: "Rule Sets", icon: <Database size={15} /> },
    { id: "tun", label: "TUN", icon: <Shield size={15} /> },
    { id: "dns", label: "DNS", icon: <Globe size={15} /> },
  ];

  const settingsInsights = [
    {
      label: "Autostart",
      value: settings.autostart_enabled ? "On" : "Off",
      detail: settings.autostart_enabled ? "Windows startup enabled" : "Manual launch",
      icon: <Power size={18} />,
    },
    {
      label: "Inbound",
      value: settings.mixed_listen,
      detail: `:${settings.mixed_port}`,
      icon: <ArrowRightLeft size={18} />,
    },
    {
      label: "TUN",
      value: settings.tun_enabled ? "On" : "Off",
      detail: settings.tun_interface_name || "singbox",
      icon: <Shield size={18} />,
    },
    {
      label: "DNS",
      value: settings.dns_final || "Unset",
      detail: settings.dns_strategy || "auto",
      icon: <Globe size={18} />,
    },
  ];

  useEffect(() => { void loadSettings(); }, []);

  async function loadSettings() {
    try { setLoading(true);
      const result = await invoke<AppSettings>("get_app_settings");
      const ruleSets = await invoke<Record<string, unknown>[]>("get_rule_sets_json");
      setSettings(result);
      setDnsServersText(JSON.stringify(result.dns_servers, null, 2));
      setRuleSetsText(JSON.stringify(ruleSets, null, 2));
      setTunAddressText(result.tun_address.join("\n"));
      setError(null);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function toggleAutostart(checked: boolean) {
    if (autostartSaving) return;
    const nextSettings = { ...settings, autostart_enabled: checked };
    try { setAutostartSaving(true); setError(null); setMessage(null);
      await invoke("save_app_settings", { settings: nextSettings });
      setSettings(nextSettings);
      setMessage(checked ? "Autostart enabled." : "Autostart disabled.");
    } catch (err) { setError(String(err)); }
    finally { setAutostartSaving(false); }
  }

  async function handleSave() {
    try { setSaving(true); setError(null); setMessage(null);
      const dnsServers = JSON.parse(dnsServersText);
      if (!Array.isArray(dnsServers)) throw new Error("DNS servers JSON must be an array");
      const ruleSets = JSON.parse(ruleSetsText);
      if (!Array.isArray(ruleSets)) throw new Error("Rule sets JSON must be an array");
      const tunAddress = tunAddressText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const payload: AppSettings = {
        ...settings, autostart_enabled: Boolean(settings.autostart_enabled),
        mixed_port: Number(settings.mixed_port), tun_mtu: Number(settings.tun_mtu),
        tun_address: tunAddress, dns_servers: dnsServers,
      };
      await invoke("save_app_settings", { settings: payload });
      await invoke("save_rule_sets_json", { ruleSets });
      setSettings(payload);
      setMessage("Settings saved. Restart proxy if it is already running.");
      await onSaved();
    } catch (err) { setError(String(err)); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="text-sm text-content-secondary">Loading settings...</div>;

  return (
    <div className="space-y-4">
      {/* ── Header + Quick Actions ── */}
      <div className="panel-card rounded-[22px] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-content-muted">Client Settings</p>
            <h2 className="text-[1.2rem] font-semibold tracking-tight text-content">Runtime preferences</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleSave} disabled={saving || autostartSaving}
              className="btn-primary flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50">
              <Check size={15} />{saving ? "Saving..." : "Save"}
            </button>
            <button onClick={() => void loadSettings()} disabled={saving || autostartSaving}
              className="btn-secondary flex items-center gap-1.5 rounded-2xl px-4 py-2 text-sm transition-colors disabled:opacity-50">
              <Settings2 size={15} />Reload
            </button>
          </div>
        </div>

        {/* ── Insight Cards ── */}
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          {settingsInsights.map((item) => (
            <SettingsInsightCard key={item.label} {...item} />
          ))}
        </div>
      </div>

      {/* ── Section Tabs + Content ── */}
      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Left tab nav */}
        <div className="panel-card rounded-[22px] p-2">
          <div className="space-y-1">
            {sections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button key={section.id} type="button" onClick={() => setActiveSection(section.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-primary-600/15 text-primary-500" : "text-content-secondary hover:bg-surface-elevated hover:text-content"
                  }`}>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${active ? "bg-primary-600/15" : "bg-surface-elevated"}`}>
                    {section.icon}
                  </span>
                  <span className="text-sm font-medium">{section.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right content */}
        <div className="panel-card rounded-[22px] p-5">
          {activeSection === "inbound" && (
            <section className="space-y-5">
              <SectionHeader title="Inbound" subtitle="Local mixed inbound for proxy and startup behavior." />
              <ToggleRow label="Start on Windows login" checked={settings.autostart_enabled} loading={autostartSaving} onChange={toggleAutostart} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Mixed Listen Host">
                  <input type="text" value={settings.mixed_listen} onChange={(e) => updateSetting("mixed_listen", e.target.value)} className="input" />
                </Field>
                <Field label="Mixed Listen Port">
                  <input type="number" value={settings.mixed_port} onChange={(e) => updateSetting("mixed_port", Number(e.target.value))} className="input" />
                </Field>
              </div>
            </section>
          )}

          {activeSection === "ruleSets" && (
            <section className="space-y-5">
              <SectionHeader title="Rule Sets" subtitle="Edit the active profile route.rule_set array as raw JSON." />
              <Field label="Rule Sets JSON">
                <textarea value={ruleSetsText} onChange={(e) => setRuleSetsText(e.target.value)}
                  rows={10} className="input min-h-56 resize-y font-mono text-xs" />
              </Field>
            </section>
          )}

          {activeSection === "tun" && (
            <section className="space-y-5">
              <SectionHeader title="TUN" subtitle="Add or remove the TUN inbound in the active config." />
              <ToggleRow label="Enable TUN mode" checked={settings.tun_enabled} onChange={(checked) => updateSetting("tun_enabled", checked)} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Interface Name">
                  <input type="text" value={settings.tun_interface_name} onChange={(e) => updateSetting("tun_interface_name", e.target.value)} className="input" />
                </Field>
                <Field label="MTU">
                  <input type="number" value={settings.tun_mtu} onChange={(e) => updateSetting("tun_mtu", Number(e.target.value))} className="input" />
                </Field>
                <Field label="Stack">
                  <input type="text" value={settings.tun_stack} onChange={(e) => updateSetting("tun_stack", e.target.value)} className="input" />
                </Field>
                <Field label="Address CIDRs">
                  <textarea value={tunAddressText} onChange={(e) => setTunAddressText(e.target.value)} rows={3} className="input min-h-24 resize-y" />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <ToggleRow label="Auto Route" checked={settings.tun_auto_route} onChange={(c) => updateSetting("tun_auto_route", c)} />
                <ToggleRow label="Strict Route" checked={settings.tun_strict_route} onChange={(c) => updateSetting("tun_strict_route", c)} />
                <ToggleRow label="Sniff" checked={settings.tun_sniff} onChange={(c) => updateSetting("tun_sniff", c)} />
                <ToggleRow label="Sniff Override Destination" checked={settings.tun_sniff_override_destination} onChange={(c) => updateSetting("tun_sniff_override_destination", c)} />
              </div>
            </section>
          )}

          {activeSection === "dns" && (
            <section className="space-y-5">
              <SectionHeader title="DNS" subtitle="Edit the top-level final target, strategy, and server definitions." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="DNS Final">
                  <input type="text" value={settings.dns_final} onChange={(e) => updateSetting("dns_final", e.target.value)} className="input" />
                </Field>
                <Field label="DNS Strategy">
                  <input type="text" value={settings.dns_strategy} onChange={(e) => updateSetting("dns_strategy", e.target.value)} className="input" />
                </Field>
              </div>
              <Field label="DNS Servers JSON">
                <textarea value={dnsServersText} onChange={(e) => setDnsServersText(e.target.value)}
                  rows={10} className="input min-h-56 resize-y font-mono text-xs" />
              </Field>
            </section>
          )}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-500">{error}</div>
      )}
      {message && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">{message}</div>
      )}
    </div>
  );
}

/* ── Sub-components ── */

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-content">{title}</h3>
      <p className="mt-1 text-xs text-content-secondary">{subtitle}</p>
    </div>
  );
}

function SettingsInsightCard({ label, value, detail, icon }: {
  label: string; value: string; detail: string; icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-[14px] rounded-[14px] border border-border-muted bg-muted/35 px-4 py-4 transition-all hover:bg-muted/55 hover:-translate-y-[1px]">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-primary-500">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-content-muted">{label}</p>
        <p className="mt-0.5 text-base font-bold text-content">{value}</p>
        <p className="mt-0.5 truncate text-[11px] text-content-secondary">{detail}</p>
      </div>
    </div>
  );
}

function Field({ label, children, className = "" }: {
  label: string; children: React.ReactNode; className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({ label, checked, loading, onChange }: {
  label: string; checked: boolean; loading?: boolean; onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between rounded-2xl border border-border/60 bg-muted/30 px-3 py-2.5 text-sm text-content transition-all hover:border-border hover:-translate-y-[1px]">
      <span className="pr-3">{label}</span>
      <span className="relative inline-flex items-center">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only" disabled={loading} />
        <span className="h-5 w-10 rounded-full border border-border/80 bg-surface-elevated transition-colors peer-checked:border-primary-500/30 peer-checked:bg-primary-500/20" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:bg-primary-500 dark:bg-slate-200" />
        {loading && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 size={12} className="animate-spin text-primary-500" />
          </span>
        )}
      </span>
    </label>
  );
}

export default SettingsPanel;
