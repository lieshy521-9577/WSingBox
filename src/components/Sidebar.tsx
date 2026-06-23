import { Network, ScrollText, LayoutDashboard, FileUp, Trash2, Settings, FolderOpen } from "lucide-react";
import { ConfigProfile } from "../types";

type Page = "overview" | "nodes" | "logs" | "settings";

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
  ];

  return (
    <aside className="w-48 bg-sidebar border-r border-border flex flex-col">
      {/* Status indicator */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isRunning ? "bg-green-400 animate-pulse" : "bg-gray-400 dark:bg-gray-500"
            }`}
          />
          <span className="text-xs text-content-secondary">
            {isRunning ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary-600/20 text-primary-600 dark:text-primary-400"
                  : "text-content-secondary hover:bg-surface-elevated hover:text-content"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-border p-2 space-y-2">
        <button
          onClick={onImportConfig}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-surface-elevated hover:text-content transition-colors"
        >
          <FileUp size={16} />
          Import Profile
        </button>
        {configProfiles.length > 0 && (
          <div className="space-y-1">
            <div className="px-3 pt-1 text-[11px] uppercase tracking-wide text-content-muted">
              Saved Profiles
            </div>
            {configProfiles.map((profile) => {
              const isActive = activeConfigProfileId === profile.id;
              return (
                <div
                  key={profile.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1 ${
                    isActive ? "bg-primary-600/10" : ""
                  }`}
                >
                  <button
                    onClick={() => onSwitchConfigProfile(profile.id)}
                    className={`flex flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors ${
                      isActive
                        ? "text-primary-600 dark:text-primary-400"
                        : "text-content-secondary hover:bg-surface-elevated hover:text-content"
                    }`}
                    title={profile.source_path}
                  >
                    <FolderOpen size={14} />
                    <span className="truncate">{profile.name}</span>
                  </button>
                  <button
                    onClick={() => onDeleteConfigProfile(profile.id)}
                    className="rounded p-1.5 text-content-muted transition-colors hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400"
                    title="Delete profile"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button
          onClick={onClearConfig}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-red-500/10 hover:text-red-500 dark:hover:text-red-400 transition-colors"
        >
          <Trash2 size={16} />
          Clear All Profiles
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
