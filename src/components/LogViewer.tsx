import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Activity,
  Copy,
  Pause,
  Play,
  ShieldAlert,
  TerminalSquare,
  Trash2,
} from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
}

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [autoScroll, setAutoScroll] = useState(false);
  const [copied, setCopied] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const errorCount = logs.filter((log) => log.level === "error").length;
  const warningCount = logs.filter((log) => log.level === "warn").length;

  useEffect(() => {
    let active = true;

    const loadLogs = async () => {
      if (paused) {
        return;
      }

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

    void loadLogs();
    const timer = window.setInterval(() => {
      void loadLogs();
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [paused]);

  useEffect(() => {
    if (!autoScroll || !streamRef.current) {
      return;
    }

    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [autoScroll, logs]);

  const clearLogs = async () => {
    try {
      await invoke("clear_runtime_logs");
      setLogs([]);
    } catch (err) {
      console.error("Failed to clear runtime logs:", err);
    }
  };

  const copyLogs = async () => {
    try {
      const text = logs
        .map((log) => `${log.timestamp || "--"} [${log.level}] ${log.message}`)
        .join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) {
      console.error("Failed to copy runtime logs:", err);
    }
  };

  const levelColors: Record<string, string> = {
    info: "text-blue-500 dark:text-blue-400",
    warn: "text-yellow-500 dark:text-yellow-400",
    error: "text-red-500 dark:text-red-400",
    debug: "text-gray-500 dark:text-gray-400",
  };

  return (
    <div className="page-entrance flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-slate-900/90 bg-slate-950 text-xs shadow-[0_30px_80px_rgba(2,6,23,0.34)]">
        <div className="flex flex-col gap-2.5 border-b border-slate-800 px-4 py-3">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/70 text-sky-400">
                <TerminalSquare size={14} />
              </span>
              <div>
                <p className="section-label text-slate-500">Runtime</p>
                <h2 className="text-[0.98rem] font-semibold tracking-tight text-white">Live logs</h2>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToolButton onClick={() => setPaused((value) => !value)} icon={paused ? <Play size={12} /> : <Pause size={12} />}>
                {paused ? "Resume" : "Pause"}
              </ToolButton>
              <ToolButton onClick={() => void copyLogs()} icon={<Copy size={12} />}>
                {copied ? "Copied" : "Copy"}
              </ToolButton>
              <ToolButton
                onClick={() => setAutoScroll((value) => !value)}
                active={autoScroll}
                icon={<Activity size={12} />}
              >
                Auto-scroll
              </ToolButton>
              <ToolButton onClick={() => void clearLogs()} icon={<Trash2 size={12} />}>
                Clear
              </ToolButton>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StreamStat icon={<TerminalSquare size={12} />} label="Entries" value={String(logs.length)} color="text-sky-400" />
            <StreamStat icon={<Activity size={12} />} label="Stream" value={paused ? "Paused" : loading ? "..." : "Live"} color="text-emerald-400" />
            <StreamStat icon={<ShieldAlert size={12} />} label="Errors" value={String(errorCount)} color="text-red-400" />
            <StreamStat icon={<Activity size={12} />} label="Warnings" value={String(warningCount)} color="text-yellow-400" />
          </div>
        </div>

        <div ref={streamRef} className="app-scroll min-h-[22rem] flex-1 select-text overflow-auto p-3 font-mono text-xs">
          {loading ? (
            <p className="py-8 text-center text-slate-500">Loading logs...</p>
          ) : logs.length === 0 ? (
            <p className="py-8 text-center text-slate-500">No logs yet</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="log-row flex gap-3 rounded-xl px-2 py-1.5 hover:bg-white/5">
                <span className="shrink-0 text-slate-500">{log.timestamp || "--"}</span>
                <span className={`w-12 shrink-0 uppercase ${levelColors[log.level] || "text-gray-400"}`}>
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

function StreamStat({
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
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900/75 px-3 py-1.5 text-[11px] text-slate-300">
      <span className={color}>{icon}</span>
      <span className="uppercase tracking-[0.15em] text-slate-500">{label}</span>
      <strong className="text-white">{value}</strong>
    </span>
  );
}

function ToolButton({
  active = false,
  icon,
  children,
  onClick,
}: {
  active?: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-2xl border px-3 py-1.5 text-[11px] transition-colors ${
        active
          ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
          : "border-slate-700 text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

export default LogViewer;
