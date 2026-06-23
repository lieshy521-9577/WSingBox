import { useState, useEffect, useRef } from "react";
import { Trash2 } from "lucide-react";

interface LogEntry {
  id: number;
  timestamp: string;
  level: string;
  message: string;
}

function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([
    {
      id: 1,
      timestamp: new Date().toLocaleTimeString(),
      level: "info",
      message: "SingBox Client initialized. Waiting for connection...",
    },
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const clearLogs = () => {
    setLogs([]);
  };

  const levelColors: Record<string, string> = {
    info: "text-blue-500 dark:text-blue-400",
    warn: "text-yellow-500 dark:text-yellow-400",
    error: "text-red-500 dark:text-red-400",
    debug: "text-gray-500 dark:text-gray-400",
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-content">Logs</h2>
        <button
          onClick={clearLogs}
          className="flex items-center gap-1.5 px-3 py-1.5 text-content-secondary hover:text-content text-sm rounded-lg hover:bg-surface-elevated transition-colors"
        >
          <Trash2 size={14} />
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div className="flex-1 bg-surface border border-border rounded-lg p-3 overflow-auto font-mono text-xs">
        {logs.length === 0 ? (
          <p className="text-content-muted text-center py-8">No logs yet</p>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="flex gap-2 py-0.5">
              <span className="text-content-muted shrink-0">{log.timestamp}</span>
              <span className={`shrink-0 uppercase w-12 ${levelColors[log.level] || "text-gray-400"}`}>
                [{log.level}]
              </span>
              <span className="text-content-secondary">{log.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

export default LogViewer;
