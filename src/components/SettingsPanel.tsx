import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Database, Globe, Shield } from "lucide-react";
import { AppSettings } from "../types";

interface SettingsPanelProps {
  onSaved: () => Promise<void>;
}

type SettingsSection = "inbound" | "ruleSets" | "tun" | "dns";

const defaultSettings: AppSettings = {
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
  dns_strategy: "ipv4_only",
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
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sections: {
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    {
      id: "inbound",
      label: "Inbound",
      icon: <ArrowRightLeft size={15} />,
      description: "Mixed inbound host and port.",
    },
    {
      id: "ruleSets",
      label: "Rule Sets",
      icon: <Database size={15} />,
      description: "Edit route.rule_set JSON.",
    },
    {
      id: "tun",
      label: "TUN",
      icon: <Shield size={15} />,
      description: "Enable and tune TUN mode.",
    },
    {
      id: "dns",
      label: "DNS",
      icon: <Globe size={15} />,
      description: "DNS final target, strategy, and servers.",
    },
  ];

  useEffect(() => {
    loadSettings();
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
    <div className="page-entrance space-y-6">
      <div className="panel-card rounded-[24px] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-label mb-2">Client Settings</p>
            <h2 className="text-2xl font-semibold tracking-tight text-content">Routing and runtime preferences</h2>
            <p className="mt-2 text-sm text-content-secondary">
              These settings are applied to imported configs and generated configs.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <SettingsPill label="Mode" value={settings.tun_enabled ? "TUN enabled" : "Mixed inbound"} />
            <SettingsPill label="DNS" value={settings.dns_final || "Unset"} />
            <SettingsPill label="Port" value={String(settings.mixed_port)} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SettingsMetric
          icon={<ArrowRightLeft size={16} />}
          label="Inbound"
          value={settings.mixed_listen}
          meta={`:${settings.mixed_port}`}
          color="text-sky-500 dark:text-sky-400"
        />
        <SettingsMetric
          icon={<Shield size={16} />}
          label="TUN"
          value={settings.tun_enabled ? "On" : "Off"}
          meta={settings.tun_interface_name}
          color="text-emerald-500 dark:text-emerald-400"
        />
        <SettingsMetric
          icon={<Globe size={16} />}
          label="DNS"
          value={settings.dns_final}
          meta={settings.dns_strategy}
          color="text-green-500 dark:text-green-400"
        />
        <SettingsMetric
          icon={<Database size={16} />}
          label="Servers"
          value={String(settings.dns_servers.length)}
          meta="DNS entries"
          color="text-orange-500 dark:text-orange-400"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="panel-card rounded-[24px] p-2">
          <div className="mb-2 px-3 py-2 text-xs uppercase tracking-wide text-content-muted">
            Settings Menu
          </div>
          <div className="space-y-1">
            {sections.map((section) => {
              const active = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full rounded-2xl px-3 py-3 text-left transition-colors ${
                    active
                      ? "bg-primary-600/15 text-primary-600 dark:text-primary-400"
                      : "text-content-secondary hover:bg-surface-elevated hover:text-content"
                  }`}
                >
                    <div className="flex items-center gap-2 text-sm font-medium">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${active ? "bg-primary-600/15" : "bg-surface-elevated"}`}>
                      {section.icon}
                    </span>
                    <span>{section.label}</span>
                  </div>
                  <p className="mt-1 text-[11px]">{section.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel-card rounded-[24px] p-5">
          {activeSection === "inbound" && (
            <section className="space-y-4">
              <div className="mb-4">
                <h3 className="text-sm font-medium text-content">Inbound</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Controls the local mixed inbound used for system proxy and optional TUN inbound.
                </p>
              </div>

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
              <div className="mb-4">
                <h3 className="text-sm font-medium text-content">Rule Sets</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Edit the active profile&apos;s `route.rule_set` array as raw JSON.
                </p>
              </div>

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
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-medium text-content">TUN</h3>
                  <p className="mt-1 text-xs text-content-secondary">
                    Adds or removes the TUN inbound in the active config.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-content">
                  <input
                    type="checkbox"
                    checked={settings.tun_enabled}
                    onChange={(e) => updateSetting("tun_enabled", e.target.checked)}
                  />
                  Enable TUN mode
                </label>
              </div>

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

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
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
              <div className="mb-4">
                <h3 className="text-sm font-medium text-content">DNS</h3>
                <p className="mt-1 text-xs text-content-secondary">
                  Edit the top-level DNS final target, strategy, and server definitions.
                </p>
              </div>

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

              <Field label="DNS Servers JSON" className="mt-4">
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

      <div className="panel-card flex items-center gap-3 rounded-[24px] p-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="btn-primary rounded-2xl px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <button
          onClick={loadSettings}
          disabled={saving}
          className="btn-secondary rounded-2xl px-4 py-2.5 text-sm transition-colors disabled:opacity-50"
        >
          Reload
        </button>
      </div>
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

function SettingsMetric({
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
      <p className="truncate text-xl font-semibold tracking-tight text-content">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-content-secondary">{label}</p>
      <p className="mt-2 truncate text-xs text-content-muted">{meta}</p>
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
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="surface-block flex items-center justify-between rounded-2xl px-3 py-2.5 text-sm text-content transition-transform duration-200 hover:-translate-y-[1px]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default SettingsPanel;
