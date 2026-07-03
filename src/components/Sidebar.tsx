import { useState, useRef, useEffect } from "react";
import { Network, ScrollText, LayoutDashboard, FileUp, Settings, Info, ChevronUp, Pencil, Download, FolderOpen, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { ConfigProfile } from "../types";
import { RuntimePhase } from "../hooks/useSingbox";

type Page = "overview" | "nodes" | "logs" | "settings" | "about";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isRunning: boolean;
  runtimePhase: RuntimePhase;
  onToggleProxy: () => void;
  loading: boolean;
  onImportProfile: () => void;
  configProfiles: ConfigProfile[];
  activeConfigProfileId: string | null;
  onSwitchConfigProfile: (profileId: string) => void;
  onEditConfigProfile: (profileId: string) => void;
  onDeleteConfigProfile: (profileId: string) => void;
  onRefreshConfigProfile: (profileId: string) => void;
  onExportProfile: (profileId: string) => void;
  isElevated: boolean | null;
  needsElevation: boolean;
  requestElevation: () => void;
}

function Sidebar({
  currentPage,
  onPageChange,
  isRunning,
  runtimePhase,
  onToggleProxy,
  loading,
  onImportProfile,
  configProfiles,
  activeConfigProfileId,
  onSwitchConfigProfile,
  onEditConfigProfile,
  onDeleteConfigProfile: _onDeleteConfigProfile,
  onRefreshConfigProfile,
  onExportProfile,
  isElevated,
  needsElevation,
  requestElevation,
}: SidebarProps) {
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!profileDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setProfileDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [profileDropdownOpen]);

  const navItems = [
    { id: "overview" as Page, label: "Overview", icon: LayoutDashboard },
    { id: "nodes" as Page, label: "Nodes", icon: Network },
    { id: "logs" as Page, label: "Logs", icon: ScrollText },
    { id: "settings" as Page, label: "Settings", icon: Settings },
    { id: "about" as Page, label: "About", icon: Info },
  ];

  const sessionState = getSessionState(runtimePhase, isRunning, loading, needsElevation);
  const activeProfile = configProfiles.find((p) => p.id === activeConfigProfileId);

  return (
    <aside className="flex w-[240px] min-w-[220px] max-w-[260px] flex-col gap-2 rounded-[22px] border border-border bg-gradient-to-b from-surface/98 to-surface-elevated/96 p-2.5">
      {/* ======== Session ======== */}
      <div className="shrink-0 px-1.5 pt-1">
        <p className="section-label pb-1.5">Session</p>
        <div
          onClick={loading ? undefined : onToggleProxy}
          className={`select-none rounded-2xl border border-muted bg-muted/50 p-3 transition-all ${
            loading
              ? "cursor-not-allowed opacity-80"
              : "cursor-pointer hover:border-primary-500/30 hover:bg-muted/70 active:scale-[0.985]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {loading ? (
                <Loader2 size={14} className="animate-spin text-primary-500" />
              ) : (
                <div className={`status-dot ${sessionState.dotClass}`} />
              )}
              <span className="text-[13px] font-semibold text-content">{sessionState.label}</span>
            </div>
            <span className={`status-pill ${sessionState.pillClass}`}>
              {loading ? (
                <Loader2 size={10} className="animate-spin" />
              ) : (
                <span style={{ width: 6, height: 6 }} className={`status-dot ${sessionState.dotClass}`} />
              )}
              {sessionState.pillLabel}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-content-muted">{sessionState.helper}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="metric-chip"><strong>Engine</strong> {sessionState.engineLabel}</span>
            <span className="metric-chip"><strong>Tray</strong> Enabled</span>
          </div>
        </div>
      </div>

      {/* ======== Elevation hint ======== */}
      {needsElevation && isElevated === false && (
        <div className="shrink-0 px-1.5 pt-1">
          <button
            onClick={requestElevation}
            className="w-full flex items-center gap-2 rounded-xl border border-amber-500/25 bg-amber-50/60 dark:bg-amber-500/10 px-3 py-2 text-[12px] text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-500/15 transition-colors cursor-pointer"
          >
            <ShieldAlert size={14} className="shrink-0" />
            <span className="min-w-0">TUN profile requires administrator access</span>
          </button>
        </div>
      )}
      {isElevated === true && (
        <div className="shrink-0 px-1.5 pt-1">
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-50/40 dark:bg-emerald-500/8 px-3 py-2 text-[12px] text-emerald-700 dark:text-emerald-300">
            <ShieldAlert size={14} className="shrink-0" />
            <span className="min-w-0">Running as admin — no UAC needed</span>
          </div>
        </div>
      )}

      {/* ======== Workspace Nav ======== */}
      <nav className="flex-1 min-h-0 flex flex-col overflow-hidden px-1.5">
        <p className="section-label pb-1.5">Workspace</p>
        <div className="flex flex-col gap-0.5 overflow-y-auto min-h-0">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onPageChange(item.id)}
                className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14px] font-semibold transition-all ${
                  isActive
                    ? "bg-primary-500/12 border border-primary-500/25 text-primary-500"
                    : "border border-transparent text-content-secondary hover:bg-muted/50 hover:text-content"
                }`}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* ======== Bottom Actions ======== */}
      <div className="shrink-0 px-1.5 pb-1 flex flex-col gap-2">
        {/* Import button */}
        <button
          onClick={onImportProfile}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 px-3 py-2.5 text-[13px] font-semibold text-white transition-all hover:translate-y-[-0.5px] hover:shadow-md active:translate-y-0"
        >
          <FileUp size={15} />
          Import Profile
        </button>

        {/* Profile selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
            className="flex w-full items-center justify-between gap-2 rounded-[14px] border border-muted bg-muted px-3 py-2.5 text-left transition-all hover:border-border"
          >
            <div className="flex items-center gap-2 min-w-0">
              <FolderOpen size={14} className="shrink-0 text-content-muted" />
              <span className="truncate text-[13px] font-semibold text-content">
                {activeProfile ? activeProfile.name : "No profile"}
              </span>
            </div>
            <ChevronUp
              size={14}
              className={`shrink-0 text-content-muted transition-transform ${profileDropdownOpen ? "" : "rotate-180"}`}
            />
          </button>

          {profileDropdownOpen && configProfiles.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 z-50 mb-1.5 rounded-2xl border border-border bg-surface p-1.5 shadow-lg">
              <div className="flex items-center justify-between px-2.5 py-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-content-muted">Saved Profiles</span>
                <span className="rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold text-content-muted">{configProfiles.length}</span>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {configProfiles.map((profile) => {
                  const isActive = activeConfigProfileId === profile.id;
                  return (
                    <button
                      key={profile.id}
                      onClick={() => {
                        onSwitchConfigProfile(profile.id);
                        setProfileDropdownOpen(false);
                      }}
                      className={`group/profile flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left transition-all ${
                        isActive
                          ? "bg-primary-500/10 border border-primary-500/20"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[12px] font-semibold text-content">{profile.name}</span>
                          {profile.source_kind === "url" && (
                            <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-content-muted">URL</span>
                          )}
                          {isActive && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/profile:opacity-100">
                        <button
                          onClick={(e) => { e.stopPropagation(); onEditConfigProfile(profile.id); setProfileDropdownOpen(false); }}
                          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-primary-500/10 hover:text-primary-500"
                          title="Edit profile"
                        >
                          <Pencil size={11} />
                        </button>
                        {profile.source_kind === "url" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onRefreshConfigProfile(profile.id); }}
                            className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-500"
                            title="Refresh from URL"
                          >
                            <RefreshCw size={11} />
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); onExportProfile(profile.id); }}
                          className="rounded-lg p-1.5 text-content-muted transition-colors hover:bg-sky-500/10 hover:text-sky-500"
                          title={profile.source_kind === "url" ? "Copy subscription URL" : "Copy profile JSON"}
                        >
                          <Download size={11} />
                        </button>
                      </div>
                    </button>
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

function getSessionState(
  runtimePhase: RuntimePhase,
  isRunning: boolean,
  loading: boolean,
  needsElevation: boolean
) {
  if (loading) {
    return {
      label: isRunning ? "Stopping" : "Starting",
      helper: isRunning ? "Closing sing-box core" : "Initializing sing-box core",
      pillLabel: "Processing",
      pillClass: "info",
      dotClass: "live",
      engineLabel: isRunning ? "Stopping" : "Booting",
    };
  }
  if (runtimePhase === "running" && isRunning) {
    return {
      label: "Connected",
      helper: "Traffic routing active",
      pillLabel: "Live",
      pillClass: "",
      dotClass: "live",
      engineLabel: "Running",
    };
  }
  if (runtimePhase === "starting") {
    return {
      label: "Starting",
      helper: "Waiting for sing-box to finish startup",
      pillLabel: "Booting",
      pillClass: "info",
      dotClass: "live",
      engineLabel: "Booting",
    };
  }
  if (runtimePhase === "switching") {
    return {
      label: "Switching",
      helper: "Applying profile or node changes",
      pillLabel: "Apply",
      pillClass: "warning",
      dotClass: "live",
      engineLabel: "Updating",
    };
  }
  if (runtimePhase === "stopping") {
    return {
      label: "Stopping",
      helper: "Closing runtime and restoring local settings",
      pillLabel: "Closing",
      pillClass: "warning",
      dotClass: "error-dot",
      engineLabel: "Stopping",
    };
  }
  if (runtimePhase === "error") {
    if (needsElevation) {
      return {
        label: "Needs Admin",
        helper: "Restart the app as administrator for this TUN profile",
        pillLabel: "UAC",
        pillClass: "warning",
        dotClass: "warning-dot",
        engineLabel: "Elevate",
      };
    }
    return {
      label: "Failed",
      helper: "Runtime did not become ready",
      pillLabel: "Error",
      pillClass: "error",
      dotClass: "error-dot",
      engineLabel: "Failed",
    };
  }
  if (needsElevation) {
    return {
      label: "Needs Admin",
      helper: "TUN profile needs administrator restart before connecting",
      pillLabel: "UAC",
      pillClass: "warning",
      dotClass: "warning-dot",
      engineLabel: "Elevate",
    };
  }
  return {
    label: "Disconnected",
    helper: "Waiting for runtime start",
    pillLabel: "Idle",
    pillClass: "error",
    dotClass: "error-dot",
    engineLabel: "Stopped",
  };
}

export default Sidebar;
