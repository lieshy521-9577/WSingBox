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
import { useSingbox } from "./hooks/useSingbox";
import { useTheme } from "./hooks/useTheme";
import { ConfigOverview, ProxyNode, RouteRuleInfo } from "./types";

type Page = "overview" | "nodes" | "logs" | "settings";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("overview");
  const [showAddNode, setShowAddNode] = useState(false);
  const [showQuitPrompt, setShowQuitPrompt] = useState(false);
  const [configOverview, setConfigOverview] = useState<ConfigOverview | null>(null);
  const [editingRouteRule, setEditingRouteRule] = useState<{ index: number; rule: RouteRuleInfo } | null>(null);
  const [editingNode, setEditingNode] = useState<ProxyNode | null>(null);
  const singbox = useSingbox();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupCloseHandler = async () => {
      unlisten = await getCurrentWindow().onCloseRequested((event) => {
        event.preventDefault();
        setShowQuitPrompt(true);
      });
    };

    setupCloseHandler().catch((err) => {
      console.error("Failed to register close handler:", err);
    });

    return () => {
      unlisten?.();
    };
  }, []);

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

  const handleMinimizeInstead = useCallback(async () => {
    setShowQuitPrompt(false);
    await getCurrentWindow().minimize();
  }, []);

  const handleExitApp = useCallback(async () => {
    setShowQuitPrompt(false);
    try {
      await invoke("quit_application");
    } catch (err) {
      console.error("Failed to quit application cleanly:", err);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-surface-base">
      {/* Custom title bar */}
      <TitleBar theme={theme} onToggleTheme={toggleTheme} />

      <div className="flex flex-1 overflow-hidden">
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
        <main className="flex-1 flex flex-col overflow-hidden">
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
          <div className="flex-1 overflow-auto p-4">
            {currentPage === "overview" && (
              configOverview ? (
                <ConfigOverviewPanel overview={configOverview} onEditRouteRule={handleEditRouteRule} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-content-muted">
                  <p className="text-sm mb-3">No configuration loaded</p>
                  <button
                    onClick={handleImportConfig}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors"
                  >
                    Import sing-box Config
                  </button>
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
          </div>
        </main>
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

      {showQuitPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface shadow-2xl">
            <div className="border-b border-border px-5 py-4">
              <h3 className="text-base font-semibold text-content">Quit SingBox Client</h3>
              <p className="mt-1 text-sm text-content-secondary">
                Minimize the window or exit the application?
              </p>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4">
              <button
                onClick={() => setShowQuitPrompt(false)}
                className="rounded-lg px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
              >
                Cancel
              </button>
              <button
                onClick={handleMinimizeInstead}
                className="rounded-lg border border-border px-4 py-2 text-sm text-content transition-colors hover:bg-surface-elevated"
              >
                Minimize
              </button>
              <button
                onClick={handleExitApp}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-700"
              >
                Exit
              </button>
            </div>
          </div>
        </div>
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
