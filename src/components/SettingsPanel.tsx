import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Database, Globe, Loader2, Power, Shield } from "lucide-react";
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

  const sections: {
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "inbound",
      label: "Inbound",
      icon: <ArrowRightLeft size={15} />,
    },
    {
      id: "ruleSets",
      label: "Rule Sets",
      icon: <Database size={15} />,
    },
    {
      id: "tun",
      label: "TUN",
      icon: <Shield size={15} />,
    },
    {
      id: "dns",
      label: "DNS",
      icon: <Globe size={15} />,
    },
  ];

  const settingsInsights: {
    label: string;
    value: string;
    detail: string;
    icon: React.ReactNode;
  }[] = [
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
    {
      label: "Servers",
      value: String(settings.dns_servers.length),
      detail: "DNS entries",
      icon: <Database size={18} />,
    },
  ];

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    try {
      setLoading(true);
      const result = await invoke<AppSettings>("get_app_settings");
      const ruleSets = await invoke<Record<string, unknown>[]>("get_rule_sets_json");
      setSettings(result);
      setDnsServersText(JSON.stringify(result.dns_servers, null, 2));
      setRuleSetsText(JSON.stringify(ruleSets, null, 2));
      setTunAddressText(result.tun_address.join("\n"));
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  async function toggleAutostart(checked: boolean) {
    if (autostartSaving) {
      return;
    }

    const nextSettings = { ...settings, autostart_enabled: checked };
    try {
      setAutostartSaving(true);
      setError(null);
      setMessage(null);
      await invoke("save_app_settings", { settings: nextSettings });
      setSettings(nextSettings);
      setMessage(checked ? "Autostart enabled." : "Autostart disabled.");
    } catch (err) {
      setError(String(err));
    } finally {
      setAutostartSaving(false);
    }
  }

  async function handleSave() {
    try {
      setSaving(true);
      setError(null);
      setMessage(null);

      const dnsServers = JSON.parse(dnsServersText);
      if (!Array.isArray(dnsServers)) {
        throw new Error("DNS servers JSON must be an array");
      }
      const ruleSets = JSON.parse(ruleSetsText);
      if (!Array.isArray(ruleSets)) {
        throw new Error("Rule sets JSON must be an array");
      }

      const tunAddress = tunAddressText
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

      const payload: AppSettings = {
        ...settings,
        autostart_enabled: Boolean(settings.autostart_enabled),
        mixed_port: Number(settings.mixed_port),
        tun_mtu: Number(settings.tun_mtu),
        tun_address: tunAddress,
        dns_servers: dnsServers,
      };

      await invoke("save_app_settings", { settings: payload });
      await invoke("save_rule_sets_json", { ruleSets });
      setSettings(payload);
      setMessage("Settings saved. Restart proxy if it is already running.");
      await onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-content-secondary">Loading settings...</div>;
  }

  return (
    <div className="page-entrance space-y-4">
      <div className="panel-card rounded-[24px] p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <p className="section-label mb-2">Client Settings</p>
            <h2 className="text-[1.2rem] font-semibold tracking-tight text-content">Runtime preferences</h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SettingsPill label="Mode" value={settings.tun_enabled ? "TUN" : "Mixed"} />
            <SettingsPill label="DNS" value={settings.dns_final || "Unset"} />
            <SettingsPill label="Port" value={String(settings.mixed_port)} />
            <button
              onClick={handleSave}
              disabled={saving || autostartSaving}
              className="btn-primary rounded-2xl px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => void loadSettings()}
              disabled={saving || autostartSaving}
              className="btn-secondary rounded-2xl px-4 py-2 text-sm transition-colors disabled:opacity-50"
            >
              Reload
            </button>
          </div>
        </div>

        <div className="settings-insight-grid mt-4 gap-3">
          {settingsInsights.map((item) => (
            <SettingsInsightCard
              key={item.label}
              label={item.label}
              value={item.value}
              detail={item.detail}
              icon={item.icon}
            />
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[190px_minmax(0,1fr)]">
        <div className="panel-card rounded-[24px] p-2">
          <div className="space-y-1">
            {sections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  title={section.label}
                  className={`w-full rounded-2xl px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-primary-600/15 text-primary-600 dark:text-primary-400"
                      : "text-content-secondary hover:bg-surface-elevated hover:text-content"
                  }`}
                >
                  <div className="settings-menu-row flex items-center gap-2 text-sm font-medium">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${active ? "bg-primary-600/15" : "bg-surface-elevated"}`}>
                      {section.icon}
                    </span>
                    <span className="settings-menu-label">{section.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel-card rounded-[24px] p-4">
          {activeSection === "inbound" && (
            <section className="space-y-4">
              <SectionHeader title="Inbound" subtitle="Local mixed inbound for proxy and startup behavior." />

              <Toggle
                label="Start on Windows login"
                checked={settings.autostart_enabled}
                loading={autostartSaving}
                onChange={toggleAutostart}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Mixed Listen Host">
                  <input
                    type="text"
                    value={settings.mixed_listen}
                    onChange={(e) => updateSetting("mixed_listen", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Mixed Listen Port">
                  <input
                    type="number"
                    value={settings.mixed_port}
                    onChange={(e) => updateSetting("mixed_port", Number(e.target.value))}
                    className="input"
                  />
                </Field>
              </div>
            </section>
          )}

          {activeSection === "ruleSets" && (
            <section className="space-y-4">
              <SectionHeader title="Rule Sets" subtitle="Edit the active profile route.rule_set array as raw JSON." />

              <Field label="Rule Sets JSON">
                <textarea
                  value={ruleSetsText}
                  onChange={(e) => setRuleSetsText(e.target.value)}
                  rows={10}
                  className="input min-h-56 resize-y font-mono text-xs"
                />
              </Field>
            </section>
          )}

          {activeSection === "tun" && (
            <section className="space-y-4">
              <SectionHeader title="TUN" subtitle="Add or remove the TUN inbound in the active config." />

              <Toggle
                label="Enable TUN mode"
                checked={settings.tun_enabled}
                onChange={(checked) => updateSetting("tun_enabled", checked)}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="Interface Name">
                  <input
                    type="text"
                    value={settings.tun_interface_name}
                    onChange={(e) => updateSetting("tun_interface_name", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="MTU">
                  <input
                    type="number"
                    value={settings.tun_mtu}
                    onChange={(e) => updateSetting("tun_mtu", Number(e.target.value))}
                    className="input"
                  />
                </Field>
                <Field label="Stack">
                  <input
                    type="text"
                    value={settings.tun_stack}
                    onChange={(e) => updateSetting("tun_stack", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Address CIDRs">
                  <textarea
                    value={tunAddressText}
                    onChange={(e) => setTunAddressText(e.target.value)}
                    rows={3}
                    className="input min-h-24 resize-y"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Toggle
                  label="Auto Route"
                  checked={settings.tun_auto_route}
                  onChange={(checked) => updateSetting("tun_auto_route", checked)}
                />
                <Toggle
                  label="Strict Route"
                  checked={settings.tun_strict_route}
                  onChange={(checked) => updateSetting("tun_strict_route", checked)}
                />
                <Toggle
                  label="Sniff"
                  checked={settings.tun_sniff}
                  onChange={(checked) => updateSetting("tun_sniff", checked)}
                />
                <Toggle
                  label="Sniff Override Destination"
                  checked={settings.tun_sniff_override_destination}
                  onChange={(checked) => updateSetting("tun_sniff_override_destination", checked)}
                />
              </div>
            </section>
          )}

          {activeSection === "dns" && (
            <section className="space-y-4">
              <SectionHeader title="DNS" subtitle="Edit the top-level final target, strategy, and server definitions." />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field label="DNS Final">
                  <input
                    type="text"
                    value={settings.dns_final}
                    onChange={(e) => updateSetting("dns_final", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="DNS Strategy">
                  <input
                    type="text"
                    value={settings.dns_strategy}
                    onChange={(e) => updateSetting("dns_strategy", e.target.value)}
                    className="input"
                  />
                </Field>
              </div>

              <Field label="DNS Servers JSON">
                <textarea
                  value={dnsServersText}
                  onChange={(e) => setDnsServersText(e.target.value)}
                  rows={10}
                  className="input min-h-56 resize-y font-mono text-xs"
                />
              </Field>
            </section>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-500 dark:text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-2xl border border-green-500/20 bg-green-500/10 px-3 py-3 text-sm text-green-600 dark:text-green-300">
          {message}
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-content">{title}</h3>
      <p className="mt-1 text-xs text-content-secondary">{subtitle}</p>
    </div>
  );
}

function SettingsPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface-elevated/75 px-3 py-1.5 text-[11px] text-content-secondary">
      <span className="uppercase tracking-[0.14em] text-content-muted">{label}</span>
      <strong className="text-content">{value}</strong>
    </span>
  );
}

function SettingsInsightCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="surface-block rounded-[22px] px-5 py-4">
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated text-primary-600 shadow-sm dark:text-primary-300">
        {icon}
      </div>
      <div className="space-y-1">
        <div className="text-[1.05rem] font-semibold text-content">{value}</div>
        <div className="section-label">{label}</div>
        <div className="text-sm text-content-secondary">{detail}</div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-xs text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

function Toggle({
  label,
  checked,
  loading,
  onChange,
}: {
  label: string;
  checked: boolean;
  loading?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="surface-block flex cursor-pointer items-center justify-between rounded-2xl px-3 py-2.5 text-sm text-content transition-transform duration-200 hover:-translate-y-[1px]">
      <span className="pr-3">{label}</span>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
          disabled={loading}
        />
        <span className="h-5 w-10 rounded-full border border-border/80 bg-surface-elevated transition-colors peer-checked:border-primary-500/30 peer-checked:bg-primary-500/20" />
        <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-checked:bg-primary-500 dark:bg-slate-200" />
        {loading && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Loader2 size={12} className="animate-spin text-primary-600 dark:text-primary-300" />
          </span>
        )}
      </span>
    </label>
  );
}

export default SettingsPanel;
