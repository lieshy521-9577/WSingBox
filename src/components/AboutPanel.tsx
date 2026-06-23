import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { BookOpen, ExternalLink, Info, PackageCheck, Rocket } from "lucide-react";

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
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card/50 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-content-secondary">
              <Info size={16} />
              <span className="text-xs uppercase tracking-[0.2em]">About</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold text-content">SingBox Client</h2>
            <p className="mt-2 max-w-2xl text-sm text-content-secondary">
              Desktop controller for sing-box profiles, outbound groups, node testing, and local proxy or TUN routing.
            </p>
          </div>
          <div className="rounded-xl border border-border bg-surface px-4 py-3 text-right">
            <p className="text-[11px] uppercase tracking-wide text-content-muted">Version</p>
            <p className="mt-1 text-lg font-semibold text-content">{version}</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
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
      </div>

      {message && (
        <div className="rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-content-secondary">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-border bg-card/50 p-6">
        <h3 className="text-sm font-semibold text-content">Quick Links</h3>
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
    <div className="rounded-2xl border border-border bg-card/50 p-5">
      <div className="flex items-center gap-2 text-content-secondary">{icon}</div>
      <h3 className="mt-4 text-base font-semibold text-content">{title}</h3>
      <p className="mt-2 text-sm text-content-secondary">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-content transition-colors hover:bg-surface-elevated"
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
      className="flex items-start justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-elevated"
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
