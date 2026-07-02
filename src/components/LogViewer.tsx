import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Copy, Pause, Play, ShieldAlert, TerminalSquare, Trash2, ArrowDown } from "lucide-react";

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
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState<"all" | "error" | "warn">("all");
  const streamRef = useRef<HTMLDivElement | null>(null);
  const errorCount = logs.filter((log) => log.level === "error").length;
  const warningCount = logs.filter((log) => log.level === "warn").length;

  useEffect(() => {
    let active = true;

    const loadLogs = async () => {
      if (paused) return;
      try {
        const result = await invoke<LogEntry[]>("get_runtime_logs");
        if (active) setLogs(result);
      } catch (err) {
        console.error("Failed to load runtime logs:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadLogs();
    const timer = window.setInterval(() => { void loadLogs(); }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [paused]);

  useEffect(() => {
    if (!autoScroll || !streamRef.current) return;
    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [autoScroll, logs]);

  const clearLogs = async () => {
    try {
      await invoke("clear_runtime_logs");
      setLogs([]);
    } catch (err) { console.error("Failed to clear logs:", err); }
  };

  const copyLogs = async () => {
    try {
      const text = logs.map((log) => `${log.timestamp || "--"} [${log.level}] ${log.message}`).join("\n");
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (err) { console.error("Failed to copy logs:", err); }
  };

  const filteredLogs = filter === "all" ? logs : logs.filter((l) => l.level === filter);

  const levelColors: Record<string, string> = {
    info: "#7dcfff",
    warn: "#facc15",
    error: "#f87171",
    debug: "#94a3b8",
  };

  return (
    <div className="page-entrance flex h-full min-h-0 flex-col rounded-2xl border border-slate-900 bg-slate-950 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] tracking-[0.15em] text-slate-500">
            <TerminalSquare size={12} className="text-sky-400" />
            <span className="uppercase">Stream</span>
            <strong className="text-slate-300">{paused ? "Paused" : loading ? "..." : "Live"}</strong>
          </span>
          <span className="flex items-center gap-1.5 text-[11px] tracking-[0.15em] text-slate-500">
            <Activity size={12} className="text-slate-400" />
            <span className="uppercase">Entries</span>
            <strong className="text-slate-300">{logs.length}</strong>
          </span>
          <button
            onClick={() => setFilter(filter === "error" ? "all" : "error")}
            className={`flex items-center gap-1.5 text-[11px] tracking-[0.15em] rounded-full px-2.5 py-1 transition-colors ${
              filter === "error" ? "bg-red-500/15 text-red-400" : "text-slate-500 hover:text-red-400"
            }`}
          >
            <ShieldAlert size={12} />
            <span className="uppercase">Errors</span>
            <strong>{errorCount}</strong>
          </button>
          <button
            onClick={() => setFilter(filter === "warn" ? "all" : "warn")}
            className={`flex items-center gap-1.5 text-[11px] tracking-[0.15em] rounded-full px-2.5 py-1 transition-colors ${
              filter === "warn" ? "bg-yellow-500/15 text-yellow-400" : "text-slate-500 hover:text-yellow-400"
            }`}
          >
            <Activity size={12} />
            <span className="uppercase">Warnings</span>
            <strong>{warningCount}</strong>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPaused((v) => !v)}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white"
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            onClick={() => void copyLogs()}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <Copy size={12} />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={() => setAutoScroll((v) => !v)}
            className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl border px-2.5 text-[11px] transition-colors ${
              autoScroll ? "border-sky-500/40 bg-sky-500/10 text-sky-300" : "border-slate-700 text-slate-300 hover:bg-white/5 hover:text-white"
            }`}
          >
            <ArrowDown size={12} />
            Auto-scroll
          </button>
          <button
            onClick={() => void clearLogs()}
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-700 px-2.5 text-[11px] text-slate-300 hover:bg-white/5 hover:text-white"
          >
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>

      {/* Log stream */}
      <div
        ref={streamRef}
        className="flex-1 select-text overflow-auto p-3"
        style={{
          fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
          fontSize: "12px",
          lineHeight: 1.6,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {loading ? (
          <p className="py-8 text-center text-slate-500" style={{ fontFamily: "inherit" }}>Loading logs...</p>
        ) : filteredLogs.length === 0 ? (
          <p className="py-8 text-center text-slate-500" style={{ fontFamily: "inherit" }}>
            {filter !== "all" ? `No ${filter} entries` : "No logs yet"}
          </p>
        ) : (
          filteredLogs.map((log) => (
            <div key={log.id} className="log-row flex gap-3 rounded-md px-2 py-0.5 hover:bg-white/[0.04]">
              <span className="shrink-0 select-none text-slate-600">{log.timestamp || "--"}</span>
              <span
                className="w-14 shrink-0 select-none text-right text-[11px] font-semibold uppercase"
                style={{ color: levelColors[log.level] || "#94a3b8" }}
              >
                {log.level}
              </span>
              <span className="break-all text-slate-300/80">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default LogViewer;
