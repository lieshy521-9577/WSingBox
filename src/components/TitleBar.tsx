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
    <div className="flex h-[42px] items-center justify-between rounded-2xl border border-border bg-gradient-to-b from-surface/98 to-surface-elevated/96 px-3.5 mb-2.5">
      <div data-tauri-drag-region className="flex min-w-0 flex-1 items-center">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500/12">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-500">
              <path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <div>
            <p className="text-[13px] font-semibold text-content">SingBox Client</p>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-muted transition-colors hover:bg-muted/50 hover:text-content"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <div className="mx-1 h-4 w-px bg-border/60" />
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-muted/50 hover:text-content"
          onClick={() => { void getCurrentWindow().minimize(); }}
        >
          <Minus size={14} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-muted/50 hover:text-content"
          onClick={() => { void getCurrentWindow().toggleMaximize(); }}
        >
          <Square size={11} />
        </button>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-xl text-content-secondary transition-colors hover:bg-error/80 hover:text-white"
          onClick={onCloseToTray}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
