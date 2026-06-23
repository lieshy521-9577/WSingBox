import { Minus, Square, X, Sun, Moon } from "lucide-react";
import { Theme } from "../hooks/useTheme";

interface TitleBarProps {
  theme: Theme;
  onToggleTheme: () => void;
}

function TitleBar({ theme, onToggleTheme }: TitleBarProps) {
  return (
    <div
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-titlebar border-b border-border px-3"
    >
      <span className="text-xs text-content-secondary font-medium">SingBox Client</span>
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-elevated text-content-muted hover:text-content transition-colors"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <div className="w-px h-3 bg-border mx-1" />
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-elevated text-content-secondary"
          onClick={() => {
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().minimize()
            );
          }}
        >
          <Minus size={14} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-surface-elevated text-content-secondary"
          onClick={() => {
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().toggleMaximize()
            );
          }}
        >
          <Square size={11} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600 text-content-secondary hover:text-white"
          onClick={() => {
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().close()
            );
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
