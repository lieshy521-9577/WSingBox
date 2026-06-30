import { Network, ScrollText, LayoutDashboard, FileUp, Trash2, Settings, FolderOpen, Info, Pencil, RefreshCw, Copy } from "lucide-react";
import { ConfigProfile } from "../types";

type Page = "overview" | "nodes" | "logs" | "settings" | "about";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isRunning: boolean;
  onImportProfile: () => void;
  configProfiles: ConfigProfile[];
  activeConfigProfileId: string | null;
  onSwitchConfigProfile: (profileId: string) => void;
  onRefreshConfigProfile: (profileId: string) => void;
  onCopySubscriptionUrl: (profileId: string) => void;
  onDeleteConfigProfile: (profileId: string) => void;
  onEditConfigProfile: (profileId: string) => void;
}

function Sidebar({
  currentPage,
  onPageChange,
  isRunning,
  onImportProfile,
  configProfiles,
  activeConfigProfileId,
  onSwitchConfigProfile,
  onRefreshConfigProfile,
  onCopySubscriptionUrl,
  onDeleteConfigProfile,
  onEditConfigProfile,
}: SidebarProps) {
  const navItems = [
    { id: "overview" as Page, label: "Overview", icon: LayoutDashboard },
    { id: "nodes" as Page, label: "Nodes", icon: Network },
    { id: "logs" as Page, label: "Logs", icon: ScrollText },
    { id: "settings" as Page, label: "Settings", icon: Settings },
    { id: "about" as Page, label: "About", icon: Info },
  ];

  return (
    <aside className="panel-card flex w-[clamp(12.2rem,19vw,14.5rem)] min-h-0 flex-col overflow-hidden rounded-[24px] bg-sidebar/90">
      <div className="shrink-0 border-b border-border/80 px-[clamp(0.625rem,1vw,0.875rem)] py-[clamp(0.625rem,1vw,0.875rem)]">
        <p className="section-label mb-2">Session</p>
        <div className="surface-block rounded-2xl px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${
                    isRunning ? "bg-green-400 animate-pulse" : "bg-gray-400 dark:bg-gray-500"
                  }`}
                />
                <span className="truncate text-xs font-medium text-content">
                  {isRunning ? "Connected" : "Disconnected"}
                </span>
              </div>
              <p className="session-helper-copy mt-1 text-[10px] text-content-muted">
                {isRunning ? "Traffic routing active" : "Waiting for runtime start"}
              </p>
            </div>
            <span className={`status-pill shrink-0 ${isRunning ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-slate-400/10 text-slate-600 dark:text-slate-300"}`}>
              {isRunning ? "Live" : "Idle"}
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            <SessionMetric label="Engine" value={isRunning ? "Running" : "Stopped"} accent={isRunning ? "success" : "muted"} />
            <SessionMetric label="Tray" value="Enabled" accent="info" />
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="shrink-0 space-y-1 px-[clamp(0.625rem,1vw,0.75rem)] py-[clamp(0.625rem,1vw,0.75rem)]">
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
      <div className="min-h-0 border-t border-border/80 px-[clamp(0.625rem,1vw,0.75rem)] py-[clamp(0.625rem,1vw,0.75rem)]">
        <div className="flex min-h-0 flex-col gap-2.5">
          <button
            onClick={onImportProfile}
            className="btn-primary flex w-full items-center justify-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-sm font-medium shadow-[0_10px_30px_rgba(37,99,235,0.18)] transition-all hover:translate-y-[-1px]"
          >
            <FileUp size={16} />
            Import Profile
          </button>
        {configProfiles.length > 0 && (
          <div className="min-h-0 flex flex-1 flex-col space-y-1">
            <div className="flex items-center justify-between px-2 pb-1">
              <div className="text-[11px] uppercase tracking-[0.16em] text-content-muted">
                Saved Profiles
              </div>
              <span className="status-chip">{configProfiles.length}</span>
            </div>
            <div className="saved-profiles-list app-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {configProfiles.map((profile) => {
                const isActive = activeConfigProfileId === profile.id;
                const profileMeta = formatProfileMeta(profile.source_kind, profile.updated_at);
                return (
                  <div
                    key={profile.id}
                    className={`profile-row group min-w-0 rounded-2xl border px-1.5 py-1 transition-all ${
                      isActive
                        ? "border-primary-500/20 bg-primary-600/10"
                        : "border-transparent bg-white/45 hover:border-border/70 dark:bg-slate-900/20"
                    }`}
                  >
                    <button
                      onClick={() => onSwitchConfigProfile(profile.id)}
                      className={`flex min-w-0 w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs transition-colors ${
                        isActive
                          ? "text-primary-700 dark:text-primary-300"
                          : "text-content-secondary hover:text-content"
                      }`}
                      title={profile.source_path}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-elevated">
                        <FolderOpen size={13} />
                      </span>
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium">{profile.name}</span>
                          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] ${
                            profile.source_kind === "url"
                              ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300"
                              : "bg-slate-500/12 text-slate-600 dark:text-slate-300"
                          }`}>
                            {profile.source_kind === "url" ? "URL" : "JSON"}
                          </span>
                          {isActive && (
                            <span className="shrink-0 rounded-full bg-primary-600/12 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-primary-600 dark:text-primary-300">
                              Active
                            </span>
                          )}
                        </span>
                        <span className="profile-row-meta mt-1 flex items-center gap-1.5 text-[10px] text-content-muted">
                          <span className="truncate">{profileMeta}</span>
                        </span>
                      </span>
                    </button>
                    <div
                      className={`profile-row-actions flex items-center justify-end gap-0.5 overflow-hidden rounded-xl border border-border/60 bg-white/80 px-1 py-0.5 shadow-[0_8px_20px_rgba(15,23,42,0.08)] transition-all dark:bg-slate-950/85 ${
                        isActive
                          ? "mt-1 max-h-10 opacity-100"
                          : "mt-0 max-h-0 border-transparent px-0 py-0 opacity-0 shadow-none group-hover:mt-1 group-hover:max-h-10 group-hover:border-border/60 group-hover:px-1 group-hover:py-0.5 group-hover:opacity-100 group-focus-within:mt-1 group-focus-within:max-h-10 group-focus-within:border-border/60 group-focus-within:px-1 group-focus-within:py-0.5 group-focus-within:opacity-100"
                      }`}
                    >
                      {profile.refreshable && (
                        <button
                          onClick={() => onCopySubscriptionUrl(profile.id)}
                          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-sky-500/10 hover:text-sky-500 dark:hover:text-sky-300"
                          title="Copy subscription URL"
                        >
                          <Copy size={11} />
                        </button>
                      )}
                      {profile.refreshable && (
                        <button
                          onClick={() => onRefreshConfigProfile(profile.id)}
                          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-500 dark:hover:text-emerald-300"
                          title="Refresh URL profile"
                        >
                          <RefreshCw size={11} />
                        </button>
                      )}
                      <button
                        onClick={() => onEditConfigProfile(profile.id)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-primary-500/10 hover:text-primary-500 dark:hover:text-primary-300"
                        title="Edit profile JSON"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onDeleteConfigProfile(profile.id)}
                        className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
                        title="Delete profile"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
      </div>
    </aside>
  );
}

function formatProfileMeta(sourceKind: string, updatedAt: number) {
  const timestamp = updatedAt < 1_000_000_000_000 ? updatedAt * 1000 : updatedAt;
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return sourceKind === "url" ? "subscription profile" : "saved config";
  }

  const formatted = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(date);

  return sourceKind === "url" ? `updated ${formatted}` : `saved ${formatted}`;
}

function SessionMetric({
  label,
  value,
  accent = "muted",
}: {
  label: string;
  value: string;
  accent?: "muted" | "success" | "info";
}) {
  const accentClass =
    accent === "success"
      ? "text-emerald-600 dark:text-emerald-300"
      : accent === "info"
        ? "text-primary-600 dark:text-primary-300"
        : "text-content";

  return (
    <div className="rounded-2xl border border-border/70 bg-white/55 px-2 py-1.5 dark:bg-slate-900/25">
      <p className="text-[9px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className={`mt-1 truncate text-[11px] font-semibold ${accentClass}`}>{value}</p>
    </div>
  );
}

export default Sidebar;
