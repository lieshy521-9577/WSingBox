import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { BookOpen, ExternalLink, Info, PackageCheck, Rocket, CheckCircle2, Gauge, Shield } from "lucide-react";

function AboutPanel() {
  const [version, setVersion] = useState("0.1.0");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  const handleCheckUpdates = () => {
    setMessage("Updater is not configured in this build yet. Add the Tauri updater plugin to enable real update checks.");
  };

  return (
    <div className="page-entrance space-y-6">
      <section className="panel-card rounded-[24px] p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-content-secondary">
              <Info size={16} />
              <span className="section-label">About</span>
            </div>
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-content">SingBox Client</h2>
              <p className="mt-2 max-w-2xl text-sm text-content-secondary">
                Desktop controller for sing-box profiles, outbound groups, node testing, and local proxy or TUN routing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AboutPill label="Version" value={version} />
              <AboutPill label="Scope" value="Profiles and routing" />
              <AboutPill label="Mode" value="Tray-first desktop app" />
            </div>
          </div>
          <div className="grid min-w-[18rem] grid-cols-2 gap-3">
            <MiniStat icon={<CheckCircle2 size={16} />} label="Status" value="Ready" color="text-emerald-500 dark:text-emerald-400" />
            <MiniStat icon={<Gauge size={16} />} label="Client" value="Desktop" color="text-sky-500 dark:text-sky-400" />
            <MiniStat icon={<Shield size={16} />} label="Proxy" value="TUN / Mixed" color="text-purple-500 dark:text-purple-400" />
            <MiniStat icon={<PackageCheck size={16} />} label="Docs" value="Included" color="text-orange-500 dark:text-orange-400" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-4">
        <ActionCard
          icon={<PackageCheck size={18} />}
          title="Check for Updates"
          description="Show updater status for this build."
          actionLabel="Check Now"
          onAction={handleCheckUpdates}
        />
        <ActionCard
          icon={<BookOpen size={18} />}
          title="Help"
          description="Open the official sing-box documentation."
          actionLabel="Open Docs"
          onAction={() => open("https://sing-box.sagernet.org/")}
        />
        <ActionCard
          icon={<Rocket size={18} />}
          title="Samples"
          description="Open sample sing-box configuration references."
          actionLabel="Open Samples"
          onAction={() => open("https://sing-box.sagernet.org/examples/")}
        />
        <ActionCard
          icon={<Info size={18} />}
          title="Exit Application"
          description="Stop sing-box, restore proxy state, and quit the tray app."
          actionLabel="Exit Now"
          onAction={() => invoke("quit_application")}
        />
      </div>

      {message && (
        <div className="panel-card rounded-[24px] px-4 py-3 text-sm text-content-secondary">
          {message}
        </div>
      )}

      <section className="panel-card rounded-[24px] p-6">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-content">Quick Links</h3>
            <p className="mt-1 text-xs text-content-secondary">Reference material for configuration, routing, and TUN behavior.</p>
          </div>
          <span className="status-chip">4 links</span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <LinkRow
            title="Configuration Guide"
            description="Routing, DNS, rule sets, and inbound configuration."
            url="https://sing-box.sagernet.org/configuration/"
          />
          <LinkRow
            title="Outbound Reference"
            description="Protocol-specific options for VLESS, VMess, Trojan, TUIC, and more."
            url="https://sing-box.sagernet.org/configuration/outbound/"
          />
          <LinkRow
            title="TUN Inbound"
            description="How transparent routing works and what requires elevation."
            url="https://sing-box.sagernet.org/configuration/inbound/tun/"
          />
          <LinkRow
            title="Route Rules"
            description="Examples for domain, ip, rule_set, and action-based routing."
            url="https://sing-box.sagernet.org/configuration/route/rule/"
          />
        </div>
      </section>
    </div>
  );
}

function AboutPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface-elevated/75 px-3 py-1.5 text-[11px] text-content-secondary">
      <span className="uppercase tracking-[0.14em] text-content-muted">{label}</span>
      <strong className="text-content">{value}</strong>
    </span>
  );
}

function MiniStat({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="panel-card rounded-[22px] p-4">
      <div className={`mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-elevated ${color}`}>{icon}</div>
      <p className="text-2xl font-semibold tracking-tight text-content">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-[0.15em] text-content-secondary">{label}</p>
    </div>
  );
}

function ActionCard({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void | Promise<void>;
}) {
  return (
    <div className="panel-card rounded-[24px] p-5">
      <div className="flex items-center gap-2 text-content-secondary">{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 text-sm text-content-secondary">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="btn-secondary mt-4 inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
      >
        <span>{actionLabel}</span>
        <ExternalLink size={14} />
      </button>
    </div>
  );
}

function LinkRow({
  title,
  description,
  url,
}: {
  title: string;
  description: string;
  url: string;
}) {
  return (
    <button
      type="button"
      onClick={() => open(url)}
      className="surface-block flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
    >
      <div>
        <p className="text-sm font-medium text-content">{title}</p>
        <p className="mt-1 text-xs text-content-secondary">{description}</p>
      </div>
      <ExternalLink size={14} className="mt-1 shrink-0 text-content-muted" />
    </button>
  );
}

export default AboutPanel;
