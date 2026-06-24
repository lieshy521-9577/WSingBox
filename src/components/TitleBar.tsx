import { Minus, Square, X, Sun, Moon } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Theme } from "../hooks/useTheme";

interface TitleBarProps {
  theme: Theme;
  onToggleTheme: () => void;
  onCloseToTray: () => void;
}

function TitleBar({ theme, onToggleTheme, onCloseToTray }: TitleBarProps) {
  return (
    <div className="flex h-11 items-center justify-between border-b border-border/80 bg-titlebar px-3">
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-xl border border-sky-500/15 bg-sky-500/12 text-[11px] font-semibold text-sky-700 dark:text-sky-300">
            SB
          </div>
          <div>
            <p className="text-sm font-semibold text-content">SingBox Client</p>
            <p className="text-[11px] text-content-secondary">Desktop proxy control center</p>
          </div>
        </div>
      </div>
      <div className="ml-3 flex items-center gap-1">
        {/* Theme toggle */}
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-surface-elevated hover:text-content"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
        </button>
        <div className="mx-1 h-4 w-px bg-border" />
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-surface-elevated"
          onClick={() => {
            void getCurrentWindow().minimize();
          }}
        >
          <Minus size={14} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-surface-elevated"
          onClick={() => {
            void getCurrentWindow().toggleMaximize();
          }}
        >
          <Square size={11} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-red-600 hover:text-white"
          onClick={onCloseToTray}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
