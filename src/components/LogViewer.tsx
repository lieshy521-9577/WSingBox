import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, Activity, ShieldAlert, TerminalSquare } from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
}

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadLogs = async () => {
      try {
        const result = await invoke<LogEntry[]>("get_runtime_logs");
        if (active) {
          setLogs(result);
        }
      } catch (err) {
        console.error("Failed to load runtime logs:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadLogs();
    const timer = window.setInterval(loadLogs, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const clearLogs = async () => {
    try {
      await invoke("clear_runtime_logs");
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear runtime logs:", err);
    }
  };

  const levelColors: Record<string, string> = {
    info: "text-blue-500 dark:text-blue-400",
    warn: "text-yellow-500 dark:text-yellow-400",
    error: "text-red-500 dark:text-red-400",
    debug: "text-gray-500 dark:text-gray-400",
  };

  return (
    <div className="page-entrance flex h-full flex-col gap-4">
      <div className="panel-card rounded-[24px] p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="section-label mb-1">Runtime</p>
            <h2 className="text-2xl font-semibold tracking-tight text-content">Live logs</h2>
            <p className="mt-2 text-sm text-content-secondary">
              Inspect recent sing-box activity, routing decisions, and runtime failures without leaving the client.
            </p>
          </div>
          <button
            onClick={clearLogs}
            className="btn-secondary flex items-center gap-1.5 rounded-2xl px-3 py-2 text-sm transition-colors"
          >
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MiniStat icon={<TerminalSquare size={16} />} label="Entries" value={String(logs.length)} color="text-sky-500 dark:text-sky-400" />
        <MiniStat icon={<Activity size={16} />} label="Stream" value={loading ? "..." : "Live"} color="text-emerald-500 dark:text-emerald-400" />
        <MiniStat
          icon={<ShieldAlert size={16} />}
          label="Errors"
          value={String(logs.filter((log) => log.level === "error").length)}
          color="text-red-500 dark:text-red-400"
        />
        <MiniStat
          icon={<Activity size={16} />}
          label="Warnings"
          value={String(logs.filter((log) => log.level === "warn").length)}
          color="text-yellow-500 dark:text-yellow-400"
        />
      </div>

      <div className="flex-1 overflow-hidden rounded-[24px] border border-slate-900/90 bg-slate-950 text-xs shadow-[0_30px_80px_rgba(2,6,23,0.34)]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Stream
          </div>
          <span className="text-[11px] text-slate-500">{logs.length} entries</span>
        </div>
        <div className="app-scroll h-full select-text overflow-auto p-4 font-mono text-xs">
          {loading ? (
            <p className="py-8 text-center text-slate-500">Loading logs...</p>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-slate-500">No logs yet</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="log-row flex gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                <span className="shrink-0 text-slate-500">{log.timestamp || "--"}</span>
                <span className={`shrink-0 uppercase w-12 ${levelColors[log.level] || "text-gray-400"}`}>
                  [{log.level}]
                </span>
                <span className="whitespace-pre-wrap break-all text-slate-200/90">{log.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
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

export default LogViewer;
