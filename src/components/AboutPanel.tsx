import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { ExternalLink, Gauge, Info } from "lucide-react";

interface CoreRuntimeInfo {
  binary_path: string;
  config_path: string;
  log_path: string;
  pid: number | null;
  running: boolean;
  tun_enabled: boolean;
}

function AboutPanel() {
  const [version, setVersion] = useState("0.1.0");
  const [coreVersion, setCoreVersion] = useState("Unknown");
  const [runtimeInfo, setRuntimeInfo] = useState<CoreRuntimeInfo | null>(null);

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

    void loadCoreVersion();
  }, []);

  useEffect(() => {
    const loadRuntimeInfo = async () => {
      try {
        const result = await invoke<CoreRuntimeInfo>("get_core_runtime_info");
        setRuntimeInfo(result);
      } catch {
        setRuntimeInfo(null);
      }
    };

    void loadRuntimeInfo();
  }, []);

  return (
    <div className="page-entrance space-y-4">
      <section className="panel-card rounded-[22px] p-3.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-content-secondary">
              <Info size={16} />
              <span className="section-label">About</span>
            </div>
            <h2 className="mt-1.5 text-[1.12rem] font-semibold tracking-tight text-content">SingBox Client</h2>
          </div>
          <div className="about-header-actions flex flex-wrap items-center gap-2">
            <AboutPill label="App" value={version} />
            <AboutPill label="Core" value={coreVersion} />
            <AboutPill label="Runtime" value={runtimeInfo?.running ? "Running" : "Idle"} />
            <AboutPill label="Mode" value={runtimeInfo?.tun_enabled ? "TUN" : "Mixed"} />
            <button
              type="button"
              onClick={() => open("https://sing-box.sagernet.org/")}
              className="btn-secondary inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
            >
              Docs
              <ExternalLink size={13} />
            </button>
            <button
              type="button"
              onClick={() => open("https://sing-box.sagernet.org/examples/")}
              className="btn-secondary inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
            >
              Samples
              <ExternalLink size={13} />
            </button>
          </div>
        </div>
      </section>

      <section className="panel-card rounded-[20px] p-3.5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2 text-content-secondary">
              <Gauge size={16} />
              <span className="section-label">Diagnostics</span>
            </div>
            <div className="about-diagnostics-actions flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => open("https://sing-box.sagernet.org/migration/")}
                className="btn-secondary inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
              >
                Migration Notes
                <ExternalLink size={13} />
              </button>
              <button
                type="button"
                onClick={() => invoke("quit_application")}
                className="btn-secondary inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm"
              >
                Exit Client
                <ExternalLink size={13} />
              </button>
            </div>
          </div>

          {runtimeInfo ? (
            <div className="overflow-hidden rounded-[18px] border border-border/70">
              <DebugRow label="Core Path" value={runtimeInfo.binary_path || "Unavailable"} />
              <DebugRow label="Runtime Config" value={runtimeInfo.config_path || "Unavailable"} />
              <DebugRow label="Runtime Log" value={runtimeInfo.log_path || "Unavailable"} />
              <DebugRow
                label="Session"
                value={`${runtimeInfo.running ? "Running" : "Stopped"}${runtimeInfo.pid ? ` | PID ${runtimeInfo.pid}` : ""}${runtimeInfo.tun_enabled ? " | TUN" : ""}`}
                last
              />
            </div>
          ) : (
            <div className="rounded-[18px] border border-border/70 px-3 py-3 text-sm text-content-secondary">
              Runtime diagnostics are unavailable until the desktop runtime responds.
            </div>
          )}

          <div className="rounded-2xl border border-border/70 bg-white/35 px-3 py-2 text-[11px] leading-5 text-content-secondary dark:bg-slate-950/20">
            Quit restores the system proxy state and stops the bundled sing-box core.
          </div>
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

function DebugRow({
  label,
  value,
  last = false,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div className={`px-3 py-2.5 ${last ? "" : "border-b border-border/60"}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className="mt-1 break-all text-[12px] leading-5 text-content">{value}</p>
    </div>
  );
}

export default AboutPanel;
