import { Network, ScrollText, LayoutDashboard, FileUp, Trash2, Settings, FolderOpen, Info } from "lucide-react";
import { ConfigProfile } from "../types";

type Page = "overview" | "nodes" | "logs" | "settings" | "about";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isRunning: boolean;
  onImportConfig: () => void;
  onClearConfig: () => void;
  configProfiles: ConfigProfile[];
  activeConfigProfileId: string | null;
  onSwitchConfigProfile: (profileId: string) => void;
  onDeleteConfigProfile: (profileId: string) => void;
}

function Sidebar({
  currentPage,
  onPageChange,
  isRunning,
  onImportConfig,
  onClearConfig,
  configProfiles,
  activeConfigProfileId,
  onSwitchConfigProfile,
  onDeleteConfigProfile,
}: SidebarProps) {
  const navItems = [
    { id: "overview" as Page, label: "Overview", icon: LayoutDashboard },
    { id: "nodes" as Page, label: "Nodes", icon: Network },
    { id: "logs" as Page, label: "Logs", icon: ScrollText },
    { id: "settings" as Page, label: "Settings", icon: Settings },
    { id: "about" as Page, label: "About", icon: Info },
  ];

  return (
    <aside className="panel-card flex w-[clamp(13.75rem,22vw,16rem)] min-h-0 flex-col overflow-hidden rounded-[24px] bg-sidebar/90">
      <div className="border-b border-border/80 px-[clamp(0.75rem,1.25vw,1rem)] py-[clamp(0.75rem,1.25vw,1rem)]">
        <p className="section-label mb-2">Session</p>
        <div className="surface-block rounded-2xl px-3 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  isRunning ? "bg-green-400 animate-pulse" : "bg-gray-400 dark:bg-gray-500"
                }`}
              />
              <span className="text-xs font-medium text-content-secondary">
                {isRunning ? "Connected" : "Disconnected"}
              </span>
            </div>
            <span className={`status-pill ${isRunning ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-400/10 text-slate-600 dark:text-slate-300"}`}>
              {isRunning ? "Live" : "Idle"}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <SessionTag label="Engine" value={isRunning ? "Running" : "Stopped"} />
            <SessionTag label="Tray" value="Enabled" />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="space-y-1 px-[clamp(0.625rem,1vw,0.75rem)] py-[clamp(0.75rem,1.25vw,1rem)]">
        <p className="section-label px-2 pb-2">Workspace</p>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`flex w-full items-center gap-[clamp(0.5rem,0.9vw,0.75rem)] rounded-2xl px-[clamp(0.625rem,1vw,0.75rem)] py-[clamp(0.625rem,1vw,0.75rem)] text-sm transition-all ${
                isActive
                  ? "bg-primary-600/14 text-primary-700 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.14)] dark:text-primary-300"
                  : "text-content-secondary hover:bg-surface-elevated hover:text-content"
              }`}
            >
              <span className={`flex h-[clamp(1.9rem,3vw,2rem)] w-[clamp(1.9rem,3vw,2rem)] items-center justify-center rounded-xl ${
                isActive ? "bg-primary-600/15" : "bg-white/70 dark:bg-slate-900/30"
              }`}>
                <Icon size={16} />
              </span>
              <span className="font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="min-h-0 flex-1 overflow-hidden border-t border-border/80 px-[clamp(0.625rem,1vw,0.75rem)] py-[clamp(0.625rem,1vw,0.75rem)]">
        <div className="flex h-full min-h-0 flex-col">
        <div className="surface-block mb-3 rounded-2xl p-2">
          <button
            onClick={onImportConfig}
            className="btn-primary flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-colors"
          >
            <FileUp size={16} />
            Import Profile
          </button>
        </div>
        {configProfiles.length > 0 && (
          <div className="mb-3 min-h-0 flex-1 space-y-1 overflow-hidden">
            <div className="flex items-center justify-between px-2 pb-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-content-muted">
                Saved Profiles
              </div>
              <span className="status-chip">{configProfiles.length}</span>
            </div>
            <div className="app-scroll h-full min-h-0 space-y-1 overflow-auto pr-1">
              {configProfiles.map((profile) => {
                const isActive = activeConfigProfileId === profile.id;
                return (
                  <div
                    key={profile.id}
                    className={`flex items-center gap-2 rounded-2xl border px-2 py-1.5 transition-all ${
                      isActive
                        ? "border-primary-500/20 bg-primary-600/10"
                        : "border-transparent bg-white/45 hover:border-border/70 dark:bg-slate-900/20"
                    }`}
                  >
                    <button
                      onClick={() => onSwitchConfigProfile(profile.id)}
                      className={`flex flex-1 items-center gap-2 rounded-xl px-2 py-2 text-left text-xs transition-colors ${
                        isActive
                          ? "text-primary-700 dark:text-primary-300"
                          : "text-content-secondary hover:text-content"
                      }`}
                      title={profile.source_path}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-elevated">
                        <FolderOpen size={14} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{profile.name}</span>
                        <span className="block truncate text-[10px] text-content-muted">
                          saved config
                        </span>
                      </span>
                    </button>
                    <button
                      onClick={() => onDeleteConfigProfile(profile.id)}
                      className="rounded-xl p-2 text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
                      title="Delete profile"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <button
          onClick={onClearConfig}
          className="mt-auto flex w-full items-center gap-2 rounded-2xl px-3 py-2.5 text-sm text-content-secondary transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
          title="Clear all saved profiles"
        >
          <Trash2 size={15} />
          <span className="truncate">Clear All Profiles</span>
        </button>
        </div>
      </div>
    </aside>
  );
}

function SessionTag({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex min-w-0 items-center justify-between gap-1 rounded-full border border-border/80 bg-white/65 px-2 py-1 text-[10px] text-content-secondary dark:bg-slate-900/35">
      <span className="truncate uppercase tracking-[0.14em] text-content-muted">{label}</span>
      <strong className="truncate text-content">{value}</strong>
    </span>
  );
}

export default Sidebar;
