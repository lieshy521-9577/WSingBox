import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import NodeList from "./components/NodeList";
import LogViewer from "./components/LogViewer";
import AddNodeModal from "./components/AddNodeModal";
import ConfigOverviewPanel from "./components/ConfigOverviewPanel";
import SettingsPanel from "./components/SettingsPanel";
import RouteRuleModal from "./components/RouteRuleModal";
import AboutPanel from "./components/AboutPanel";
import StartupTipsModal from "./components/StartupTipsModal";
import ImportProfileModal from "./components/ImportProfileModal";
import Toast, { ToastMessage } from "./components/Toast";
import { useSingbox } from "./hooks/useSingbox";
import { useTheme } from "./hooks/useTheme";
import { ConfigOverview, ImportValidationReport, ProxyNode, RouteRuleInfo } from "./types";

type Page = "overview" | "nodes" | "logs" | "settings" | "about";

const STARTUP_TIPS_DISMISSED_KEY = "singbox-startup-tips-dismissed-at";
const STARTUP_TIPS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("overview");
  const [showAddNode, setShowAddNode] = useState(false);
  const [configOverview, setConfigOverview] = useState<ConfigOverview | null>(null);
  const [editingRouteRule, setEditingRouteRule] = useState<{ index: number; rule: RouteRuleInfo } | null>(null);
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null);
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [coreVersion, setCoreVersion] = useState("Detecting...");
  const [showStartupTips, setShowStartupTips] = useState(false);
  const [suppressStartupTips, setSuppressStartupTips] = useState(true);
  const [showImportProfileModal, setShowImportProfileModal] = useState(false);
  const [editingConfigProfile, setEditingConfigProfile] = useState<{ id: string; name: string; value: string } | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  let toastIdCounter = 0;
  const addToast = useCallback((type: "success" | "error", message: string) => {
    const id = Date.now() + (toastIdCounter++);
    setToasts((prev) => [...prev, { id, type, message }]);
  }, []);
  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const singbox = useSingbox();
  const { theme, toggleTheme } = useTheme();

  const hideToTray = useCallback(async () => {
    await invoke("hide_main_window");
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    const setupCloseHandler = async () => {
      unlisten = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        void hideToTray();
      });
    };
    setupCloseHandler().catch((err) => console.error("Failed to register close handler:", err));
    return () => { unlisten?.(); };
  }, [hideToTray]);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(STARTUP_TIPS_DISMISSED_KEY) || "0");
    const withinQuietWindow = Number.isFinite(dismissedAt) && Date.now() - dismissedAt < STARTUP_TIPS_WINDOW_MS;
    if (!withinQuietWindow) setShowStartupTips(true);
  }, []);

  useEffect(() => {
    invoke<string>("get_singbox_core_version")
      .then((value) => setCoreVersion(value || "Unknown"))
      .catch(() => setCoreVersion("Unknown"));
  }, []);

  useEffect(() => {
    getVersion().then((value) => setAppVersion(value)).catch(() => setAppVersion("0.1.0"));
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const overview = await invoke<ConfigOverview | null>("get_config_overview");
      if (overview) setConfigOverview(overview); else setConfigOverview(null);
    } catch (err) { console.error("Failed to load overview:", err); }
  }, []);

  useEffect(() => { loadOverview(); }, [loadOverview, singbox.activeConfigProfileId]);

  const openImportProfileModal = useCallback(() => setShowImportProfileModal(true), []);

  const handleImportConfig = useCallback(async (filePath: string) => {
    try {
      const result = await invoke<{ overview: ConfigOverview; nodes: unknown[]; profiles: unknown[]; active_node: string; active_outbound: string }>("import_config_file", { filePath });
      setConfigOverview(result.overview);
      await singbox.onConfigImported(result.active_outbound || result.active_node);
      setCurrentPage("overview");
    } catch (err) { singbox.setError(String(err)); }
  }, [singbox]);

  const handleImportConfigUrl = useCallback(async (value: string) => {
    try {
      const resolvedUrl = value.trim();
      if (!resolvedUrl) return;
      const result = await invoke<{ overview: ConfigOverview; nodes: unknown[]; profiles: unknown[]; active_node: string; active_outbound: string }>("import_config_url", { url: resolvedUrl });
      setConfigOverview(result.overview);
      await singbox.onConfigImported(result.active_outbound || result.active_node);
      setCurrentPage("overview");
    } catch (err) { singbox.setError(String(err)); }
  }, [singbox]);

  const handleValidateImportFile = useCallback(async (filePath: string) =>
    invoke<ImportValidationReport>("validate_import_file", { filePath }), []);
  const handleValidateImportUrl = useCallback(async (url: string) =>
    invoke<ImportValidationReport>("validate_import_url", { url }), []);

  const handleEditRouteRule = useCallback((index: number, rule: RouteRuleInfo) => setEditingRouteRule({ index, rule }), []);

  const handleSaveRouteRule = useCallback(async (value: string) => {
    if (!configOverview || !editingRouteRule) throw new Error("No route rule is selected");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(value); } catch { throw new Error("Route rule must be valid JSON"); }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Route rule must be a JSON object");
    const nextRules = configOverview.route_rules.map((rule, idx) => idx === editingRouteRule.index ? parsed : rule.raw);
    await invoke("save_route_rules_json", { rules: nextRules });
    setEditingRouteRule(null);
    await loadOverview();
  }, [configOverview, editingRouteRule, loadOverview]);

  const handleDismissStartupTips = useCallback(() => {
    if (suppressStartupTips) localStorage.setItem(STARTUP_TIPS_DISMISSED_KEY, String(Date.now()));
    else localStorage.removeItem(STARTUP_TIPS_DISMISSED_KEY);
    setShowStartupTips(false);
  }, [suppressStartupTips]);

  const handleOpenConfigProfileEditor = useCallback(async (profileId: string) => {
    try {
      const profile = singbox.configProfiles.find((item) => item.id === profileId);
      if (!profile) throw new Error("Profile not found");
      const config = await invoke<Record<string, unknown>>("get_config_profile_json", { profileId });
      setEditingConfigProfile({ id: profileId, name: profile.name, value: JSON.stringify(config, null, 2) });
    } catch (err) { singbox.setError(String(err)); }
  }, [singbox]);

  const handleSaveConfigProfile = useCallback(async (value: string) => {
    if (!editingConfigProfile) throw new Error("No config profile selected");
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(value); } catch { throw new Error("Profile config must be valid JSON"); }
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Profile config must be a JSON object");
    await invoke("save_config_profile_json", { profileId: editingConfigProfile.id, config: parsed });
    setEditingConfigProfile(null);
    await singbox.loadConfigProfiles();
    if (singbox.activeConfigProfileId === editingConfigProfile.id) { await loadOverview(); await singbox.onConfigImported(""); }
  }, [editingConfigProfile, loadOverview, singbox]);

  const handleCopySubscriptionUrl = useCallback(async (profileId: string) => {
    try {
      const profile = singbox.configProfiles.find((item) => item.id === profileId);
      if (!profile || profile.source_kind !== "url") throw new Error("This profile does not have an exportable subscription URL");
      await navigator.clipboard.writeText(profile.source_path);
      singbox.setError(null);
    } catch (err) { singbox.setError(String(err)); }
  }, [singbox]);

  return (
    <div className="flex flex-col h-screen p-2.5">
      {/* Title bar */}
      <TitleBar theme={theme} onToggleTheme={toggleTheme} onCloseToTray={() => void hideToTray()} />

      <div className="flex flex-1 gap-2.5 min-h-0">
        {/* Sidebar */}
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isRunning={singbox.isRunning}
          runtimePhase={singbox.runtimePhase}
          loading={singbox.loading}
          onToggleProxy={() => void singbox.toggleProxy()}
          onImportProfile={openImportProfileModal}
          configProfiles={singbox.configProfiles}
          activeConfigProfileId={singbox.activeConfigProfileId}
          onSwitchConfigProfile={(id) => void singbox.switchConfigProfile(id)}
          onEditConfigProfile={(id) => void handleOpenConfigProfileEditor(id)}
          onDeleteConfigProfile={singbox.deleteConfigProfile}
          onRefreshConfigProfile={(id) => void singbox.refreshConfigProfile(id)}
          onCopySubscriptionUrl={(id) => void handleCopySubscriptionUrl(id)}
        />

        {/* Workspace */}
        <main className="flex flex-1 min-w-0 flex-col overflow-hidden rounded-[22px] border border-border bg-surface/60">
          {/* Page content */}
          <div className="flex-1 overflow-auto p-[18px]">
            {currentPage === "overview" && (
              configOverview ? (
                <div className="page-entrance">
                  <ConfigOverviewPanel
                    overview={configOverview}
                    onEditRouteRule={handleEditRouteRule}
                    selectedOutboundTag={singbox.selectedOutboundTag}
                    isRunning={singbox.isRunning}
                    runtimePhase={singbox.runtimePhase}
                    onToggleProxy={() => void singbox.toggleProxy()}
                    loading={singbox.loading}
                  />
                </div>
              ) : (
                <div className="page-entrance flex h-full items-center justify-center">
                  <div className="rounded-2xl border border-border bg-muted/30 p-8 text-center max-w-md w-full">
                    <p className="section-label mb-2">Ready to configure</p>
                    <h2 className="text-[1.35rem] font-semibold text-primary">No configuration loaded</h2>
                    <p className="mx-auto mt-2 max-w-md text-[13px] text-secondary">
                      Import a profile to inspect routes, manage nodes, and control sing-box from one workspace.
                    </p>
                    <button
                      onClick={openImportProfileModal}
                      className="mt-4 rounded-2xl bg-primary-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-primary-700"
                    >
                      Import Profile
                    </button>
                  </div>
                </div>
              )
            )}
            {currentPage === "nodes" && (
              <NodeList
                nodes={singbox.nodes}
                profiles={singbox.profiles}
                selectedOutboundTag={singbox.selectedOutboundTag}
                runtimeDebug={singbox.runtimeDebug}
                runtimePhase={singbox.runtimePhase}
                isRunning={singbox.isRunning}
                hasConfig={singbox.hasConfig}
                onSelect={singbox.setSelectedOutboundTag}
                onRemove={singbox.removeNode}
                onRemoveGroup={singbox.removeGroup}
                onAdd={() => setShowAddNode(true)}
                onEdit={setEditingNode}
              />
            )}
            {currentPage === "logs" && <LogViewer />}
            {currentPage === "settings" && <SettingsPanel onSaved={loadOverview} />}
            {currentPage === "about" && <AboutPanel />}
          </div>
        </main>
      </div>

      {/* Modals */}
      {showAddNode && <AddNodeModal onClose={() => setShowAddNode(false)} onSubmit={singbox.addNode} />}
      {editingNode && (
        <AddNodeModal
          onClose={() => setEditingNode(null)}
          initialNode={editingNode}
          onSubmit={(name, nodeType, server, port, settings) =>
            singbox.updateNode(editingNode.id, name, nodeType, server, port, settings)
          }
        />
      )}
      {editingRouteRule && (
        <RouteRuleModal
          open={!!editingRouteRule}
          title={`Edit Route Rule ${editingRouteRule.index + 1}`}
          initialValue={JSON.stringify(editingRouteRule.rule.raw, null, 2)}
          onClose={() => setEditingRouteRule(null)}
          onSave={handleSaveRouteRule}
        />
      )}
      {editingConfigProfile && (
        <RouteRuleModal
          open={!!editingConfigProfile}
          title={`Edit Profile JSON: ${editingConfigProfile.name}`}
          description="Edit the full saved sing-box profile JSON."
          initialValue={editingConfigProfile.value}
          saveLabel="Save Profile"
          onClose={() => setEditingConfigProfile(null)}
          onSave={handleSaveConfigProfile}
        />
      )}
      {showStartupTips && (
        <StartupTipsModal
          appVersion={appVersion}
          coreVersion={coreVersion}
          suppressForSevenDays={suppressStartupTips}
          onSuppressForSevenDaysChange={setSuppressStartupTips}
          onClose={handleDismissStartupTips}
        />
      )}
      <ImportProfileModal
        open={showImportProfileModal}
        onClose={() => setShowImportProfileModal(false)}
        onValidateFile={handleValidateImportFile}
        onValidateUrl={handleValidateImportUrl}
        onImportFile={(filePath) => handleImportConfig(filePath)}
        onImportUrl={(url) => handleImportConfigUrl(url)}
      />
    </div>
  );
}

export default App;
