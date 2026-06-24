import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { ExternalLink, Info, PackageCheck, Rocket, CheckCircle2, Gauge, Shield } from "lucide-react";

function AboutPanel() {
  const [version, setVersion] = useState("0.1.0");
  const [coreVersion, setCoreVersion] = useState("Unknown");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => setVersion("0.1.0"));
  }, []);

  useEffect(() => {
    const loadCoreVersion = async () => {
      try {
        const result = await invoke<string>("get_singbox_core_version");
        setCoreVersion(result || "Unknown");
      } catch {
        setCoreVersion("Unknown");
      }
    };

    loadCoreVersion();
  }, []);

  return (
    <div className="page-entrance space-y-4">
      <section className="panel-card rounded-[22px] p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-content-secondary">
              <Info size={16} />
              <span className="section-label">About</span>
            </div>
            <div>
              <h2 className="text-[1.35rem] font-semibold tracking-tight text-content">SingBox Client</h2>
              <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-content-secondary">
                Desktop controller for sing-box profiles, outbound groups, node testing, and proxy routing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <AboutPill label="App" value={version} />
              <AboutPill label="Core" value={coreVersion} />
              <AboutPill label="Mode" value="Tray-first" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:min-w-[16rem]">
            <MiniStat icon={<CheckCircle2 size={16} />} label="Status" value="Ready" color="text-emerald-500 dark:text-emerald-400" />
            <MiniStat icon={<Gauge size={16} />} label="Client" value="Desktop" color="text-sky-500 dark:text-sky-400" />
            <MiniStat icon={<Shield size={16} />} label="Proxy" value="TUN / Mixed" color="text-purple-500 dark:text-purple-400" />
            <MiniStat icon={<PackageCheck size={16} />} label="Docs" value="Included" color="text-orange-500 dark:text-orange-400" />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ActionCard
          icon={<Rocket size={18} />}
          title="Samples"
          description="Open sample configuration references."
          actionLabel="Open Samples"
          onAction={() => open("https://sing-box.sagernet.org/examples/")}
        />
        <ActionCard
          icon={<Info size={18} />}
          title="Exit Application"
          description="Stop sing-box, restore proxy state, and quit."
          actionLabel="Exit Now"
          onAction={() => invoke("quit_application")}
        />
      </div>
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
    <div className="panel-card rounded-[18px] p-3">
      <div className={`mb-2.5 flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-elevated ${color}`}>{icon}</div>
      <p className="text-lg font-semibold tracking-tight text-content">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.15em] text-content-secondary">{label}</p>
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
    <div className="panel-card rounded-[20px] p-4">
      <div className="flex items-center gap-2 text-content-secondary">{icon}</div>
      <h3 className="mt-3 text-sm font-semibold text-content">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-5 text-content-secondary">{description}</p>
      <button
        type="button"
        onClick={onAction}
        className="btn-secondary mt-3 inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
      >
        <span>{actionLabel}</span>
        <ExternalLink size={14} />
      </button>
    </div>
  );
}

export default AboutPanel;
