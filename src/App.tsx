import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import NodeList from "./components/NodeList";
import ProxyControl from "./components/ProxyControl";
import LogViewer from "./components/LogViewer";
import AddNodeModal from "./components/AddNodeModal";
import ConfigOverviewPanel from "./components/ConfigOverviewPanel";
import SettingsPanel from "./components/SettingsPanel";
import RouteRuleModal from "./components/RouteRuleModal";
import AboutPanel from "./components/AboutPanel";
import { useSingbox } from "./hooks/useSingbox";
import { useTheme } from "./hooks/useTheme";
import { ConfigOverview, ProxyNode, RouteRuleInfo } from "./types";

type Page = "overview" | "nodes" | "logs" | "settings" | "about";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("overview");
  const [showAddNode, setShowAddNode] = useState(false);
  const [configOverview, setConfigOverview] = useState<ConfigOverview | null>(null);
  const [editingRouteRule, setEditingRouteRule] = useState<{ index: number; rule: RouteRuleInfo } | null>(null);
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null);
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

    setupCloseHandler().catch((err) => {
      console.error("Failed to register close handler:", err);
    });

    return () => {
      unlisten?.();
    };
  }, [hideToTray]);

  const loadOverview = useCallback(async () => {
    try {
      const overview = await invoke<ConfigOverview | null>("get_config_overview");
      if (overview) {
        setConfigOverview(overview);
      } else {
        setConfigOverview(null);
      }
    } catch (err) {
      console.error("Failed to load overview:", err);
    }
  }, []);

  // Load overview on mount and when the active saved profile changes
  useEffect(() => {
    loadOverview();
  }, [loadOverview, singbox.activeConfigProfileId]);

  const handleImportConfig = useCallback(async () => {
    try {
      const filePath = window.prompt(
        "Enter the path to your sing-box config JSON file to import as a saved profile:",
        "C:\\_dProj\\Proxy\\client.json"
      );
      if (!filePath) return;

      const result = await invoke<{
        overview: ConfigOverview;
        nodes: unknown[];
        profiles: unknown[];
        active_node: string;
        active_outbound: string;
      }>("import_config_file", { filePath });

      setConfigOverview(result.overview);
      await singbox.onConfigImported(result.active_outbound || result.active_node);
      setCurrentPage("overview");
    } catch (err) {
      singbox.setError(String(err));
    }
  }, [singbox]);

  const handleClearConfig = useCallback(async () => {
    if (!window.confirm("Are you sure you want to clear all saved imported profiles?")) return;
    try {
      await invoke("clear_config");
      setConfigOverview(null);
      await singbox.onConfigImported("");
      singbox.setError(null);
    } catch (err) {
      singbox.setError(String(err));
    }
  }, [singbox]);

  const handleEditRouteRule = useCallback((index: number, rule: RouteRuleInfo) => {
    setEditingRouteRule({ index, rule });
  }, []);

  const handleSaveRouteRule = useCallback(async (value: string) => {
    if (!configOverview || !editingRouteRule) {
      throw new Error("No route rule is selected");
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Route rule must be valid JSON");
    }

    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Route rule must be a JSON object");
    }

    const nextRules = configOverview.route_rules.map((rule, idx) =>
      idx === editingRouteRule.index ? parsed : rule.raw
    );

    await invoke("save_route_rules_json", { rules: nextRules });
    setEditingRouteRule(null);
    await loadOverview();
  }, [configOverview, editingRouteRule, loadOverview]);

  return (
    <div className="h-screen overflow-hidden bg-surface-base p-2">
      <div className="panel-shell flex h-full flex-col overflow-hidden rounded-[28px]">
        {/* Custom title bar */}
        <TitleBar theme={theme} onToggleTheme={toggleTheme} onCloseToTray={() => void hideToTray()} />

        <div className="flex flex-1 overflow-hidden p-3">
        {/* Sidebar navigation */}
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isRunning={singbox.isRunning}
          onImportConfig={handleImportConfig}
          onClearConfig={handleClearConfig}
          configProfiles={singbox.configProfiles}
          activeConfigProfileId={singbox.activeConfigProfileId}
          onSwitchConfigProfile={singbox.switchConfigProfile}
          onDeleteConfigProfile={singbox.deleteConfigProfile}
        />

        {/* Main content */}
        <main className="workspace-shell ml-3 flex flex-1 flex-col overflow-hidden rounded-[24px] border border-border/70">
          {/* Proxy control bar */}
          <ProxyControl
            isRunning={singbox.isRunning}
            proxyEnabled={singbox.proxyEnabled}
            loading={singbox.loading}
            selectedOutboundTag={singbox.selectedOutboundTag}
            nodes={singbox.nodes}
            profiles={singbox.profiles}
            hasConfig={singbox.hasConfig}
            tunEnabled={configOverview?.inbounds.some((inbound) => inbound.inbound_type === "tun") ?? false}
            onToggle={singbox.toggleProxy}
            error={singbox.error}
            onDismissError={() => singbox.setError(null)}
          />

          {/* Page content */}
          <div className="app-scroll flex-1 overflow-auto px-5 pb-5 pt-4">
            {currentPage === "overview" && (
              configOverview ? (
                <div className="page-entrance">
                  <ConfigOverviewPanel
                    overview={configOverview}
                    onEditRouteRule={handleEditRouteRule}
                    selectedOutboundTag={singbox.selectedOutboundTag}
                    onSelectOutbound={singbox.setSelectedOutboundTag}
                  />
                </div>
              ) : (
                <div className="page-entrance flex h-full items-center justify-center">
                  <div className="panel-card w-full max-w-xl rounded-[28px] p-8 text-center">
                    <p className="section-label mb-3">Ready to configure</p>
                    <h2 className="text-2xl font-semibold tracking-tight text-content">No configuration loaded</h2>
                    <p className="mx-auto mt-3 max-w-md text-sm text-content-secondary">
                      Import a sing-box profile to inspect routes, manage nodes, and control proxy behavior from one workspace.
                    </p>
                  <button
                    onClick={handleImportConfig}
                      className="mt-6 rounded-2xl bg-primary-600 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-primary-700"
                  >
                    Import sing-box Config
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
                hasConfig={singbox.hasConfig}
                onSelect={singbox.setSelectedOutboundTag}
                onRemove={singbox.removeNode}
                onRemoveGroup={singbox.removeGroup}
                onAdd={() => setShowAddNode(true)}
                onEdit={setEditingNode}
              />
            )}
            {currentPage === "logs" && <LogViewer />}
            {currentPage === "settings" && (
              <SettingsPanel onSaved={loadOverview} />
            )}
            {currentPage === "about" && <AboutPanel />}
          </div>
        </main>
      </div>
      </div>

      {/* Add node modal */}
      {showAddNode && (
        <AddNodeModal
          onClose={() => setShowAddNode(false)}
          onSubmit={singbox.addNode}
        />
      )}

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
    </div>
  );
}

export default App;
