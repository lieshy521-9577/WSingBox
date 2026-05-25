import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import TitleBar from "./components/TitleBar";
import Sidebar from "./components/Sidebar";
import NodeList from "./components/NodeList";
import ProxyControl from "./components/ProxyControl";
import LogViewer from "./components/LogViewer";
import AddNodeModal from "./components/AddNodeModal";
import ConfigOverviewPanel from "./components/ConfigOverviewPanel";
import { useSingbox } from "./hooks/useSingbox";
import { ConfigOverview } from "./types";

type Page = "overview" | "nodes" | "logs";

function App() {
  const [currentPage, setCurrentPage] = useState<Page>("overview");
  const [showAddNode, setShowAddNode] = useState(false);
  const [configOverview, setConfigOverview] = useState<ConfigOverview | null>(null);
  const singbox = useSingbox();

  // Load overview on mount
  useEffect(() => {
    loadOverview();
  }, []);

  const loadOverview = useCallback(async () => {
    try {
      const overview = await invoke<ConfigOverview | null>("get_config_overview");
      if (overview) {
        setConfigOverview(overview);
      }
    } catch (err) {
      console.error("Failed to load overview:", err);
    }
  }, []);

  const handleImportConfig = useCallback(async () => {
    try {
      // Use a simple prompt for file path (Tauri 2 file dialog requires additional plugin)
      const filePath = window.prompt(
        "Enter the path to your sing-box config JSON file:",
        "C:\\_dProj\\Proxy\\client.json"
      );
      if (!filePath) return;

      // import_config_file now returns ImportResult with nodes + profiles + active_node
      const result = await invoke<{
        overview: ConfigOverview;
        nodes: unknown[];
        profiles: unknown[];
        active_node: string;
      }>("import_config_file", { filePath });

      setConfigOverview(result.overview);
      // Refresh nodes and auto-select based on profile
      await singbox.onConfigImported(result.active_node);
      setCurrentPage("overview");
    } catch (err) {
      singbox.setError(String(err));
    }
  }, [singbox]);

  const handleClearConfig = useCallback(async () => {
    if (!window.confirm("Are you sure you want to clear all proxy configuration?")) return;
    try {
      await invoke("clear_config");
      setConfigOverview(null);
      await singbox.onConfigImported("");
      singbox.setError(null);
    } catch (err) {
      singbox.setError(String(err));
    }
  }, [singbox]);

  return (
    <div className="h-screen flex flex-col bg-dark-900">
      {/* Custom title bar */}
      <TitleBar />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar navigation */}
        <Sidebar
          currentPage={currentPage}
          onPageChange={setCurrentPage}
          isRunning={singbox.isRunning}
          onImportConfig={handleImportConfig}
          onClearConfig={handleClearConfig}
        />

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Proxy control bar */}
          <ProxyControl
            isRunning={singbox.isRunning}
            proxyEnabled={singbox.proxyEnabled}
            loading={singbox.loading}
            selectedNodeId={singbox.selectedNodeId}
            nodes={singbox.nodes}
            hasConfig={singbox.hasConfig}
            onToggle={singbox.toggleProxy}
            error={singbox.error}
            onDismissError={() => singbox.setError(null)}
          />

          {/* Page content */}
          <div className="flex-1 overflow-auto p-4">
            {currentPage === "overview" && (
              configOverview ? (
                <ConfigOverviewPanel overview={configOverview} />
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-dark-200">
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
                selectedNodeId={singbox.selectedNodeId}
                onSelect={singbox.setSelectedNodeId}
                onRemove={singbox.removeNode}
                onAdd={() => setShowAddNode(true)}
              />
            )}
            {currentPage === "logs" && <LogViewer />}
          </div>
        </main>
      </div>

      {/* Add node modal */}
      {showAddNode && (
        <AddNodeModal
          onClose={() => setShowAddNode(false)}
          onAdd={singbox.addNode}
        />
      )}
    </div>
  );
}

export default App;
