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
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-content">Client Settings</h2>
        <p className="mt-1 text-sm text-content-secondary">
          These settings are applied to imported configs and generated configs.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="rounded-xl border border-border bg-card/50 p-2">
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
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${
                    active
                      ? "bg-primary-600/15 text-primary-600 dark:text-primary-400"
                      : "text-content-secondary hover:bg-surface-elevated hover:text-content"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {section.icon}
                    <span>{section.label}</span>
                  </div>
                  <p className="mt-1 text-[11px]">{section.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4">
          {activeSection === "inbound" && (
            <section>
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
            <section>
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
            <section>
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
            <section>
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
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-300">
          {message}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>
        <button
          onClick={loadSettings}
          disabled={saving}
          className="rounded-lg border border-border px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content disabled:opacity-50"
        >
          Reload
        </button>
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
      <span className="mb-1 block text-xs text-content-secondary">{label}</span>
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
    <label className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

export default SettingsPanel;
