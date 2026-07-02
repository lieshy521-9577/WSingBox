import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open } from "@tauri-apps/plugin-shell";
import { ExternalLink, Gauge } from "lucide-react";

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
    getVersion().then(setVersion).catch(() => setVersion("0.1.0"));
  }, []);

  useEffect(() => {
    invoke<string>("get_singbox_core_version")
      .then((r) => setCoreVersion(r || "Unknown"))
      .catch(() => setCoreVersion("Unknown"));
  }, []);

  useEffect(() => {
    invoke<CoreRuntimeInfo>("get_core_runtime_info")
      .then(setRuntimeInfo)
      .catch(() => setRuntimeInfo(null));
  }, []);

  return (
    <div className="page-entrance space-y-4">
      {/* Brand header */}
      <section className="rounded-[20px] border border-border bg-surface/60 p-6 text-center">
        <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary-500/12 mb-3">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-500">
            <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <h1 className="text-[1.25rem] font-bold text-content">SingBox Client</h1>
        <p className="mt-1 text-[13px] text-content-muted">v{version} · sing-box core {coreVersion}</p>
        <p className="mx-auto mt-3 max-w-xs text-[13px] text-content-secondary">
          A desktop GUI for sing-box built with Tauri and React. Designed for clarity, speed, and control.
        </p>
        <div className="mt-4 flex items-center justify-center gap-2.5">
          <a href="#" onClick={(e) => { e.preventDefault(); open("https://sing-box.sagernet.org/"); }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[12px] font-medium text-content-secondary hover:bg-muted/50 hover:text-content"
          >
            Docs <ExternalLink size={11} />
          </a>
          <a href="#" onClick={(e) => { e.preventDefault(); open("https://sing-box.sagernet.org/examples/"); }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[12px] font-medium text-content-secondary hover:bg-muted/50 hover:text-content"
          >
            Examples <ExternalLink size={11} />
          </a>
        </div>
      </section>

      {/* Diagnostics */}
      <section className="rounded-[18px] border border-border bg-surface/60">
        <div className="flex items-center gap-2 border-b border-border px-5 py-3">
          <Gauge size={15} className="text-content-muted" />
          <span className="text-[13px] font-semibold text-content">Runtime Diagnostics</span>
        </div>
        {runtimeInfo ? (
          <div>
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
          <div className="px-5 py-4 text-[13px] text-content-muted">
            Runtime diagnostics are unavailable until the desktop runtime responds.
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <span className="text-[11px] text-content-muted">Quit restores the system proxy state and stops the bundled sing-box core.</span>
        <button
          onClick={() => invoke("quit_application")}
          className="btn-secondary inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[12px]"
        >
          Exit Client
        </button>
      </div>
    </div>
  );
}

function DebugRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`px-5 py-3 ${last ? "" : "border-b border-border/60"}`}>
      <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className="mt-1 break-all text-[12px] text-content-secondary">{value}</p>
    </div>
  );
}

export default AboutPanel;
