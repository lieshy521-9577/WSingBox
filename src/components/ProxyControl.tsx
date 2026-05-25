import { Power, AlertCircle } from "lucide-react";
import { ProxyNode } from "../types";

interface ProxyControlProps {
  isRunning: boolean;
  proxyEnabled: boolean;
  loading: boolean;
  selectedNodeId: string | null;
  nodes: ProxyNode[];
  hasConfig: boolean;
  onToggle: () => void;
  error: string | null;
  onDismissError: () => void;
}

function ProxyControl({
  isRunning,
  proxyEnabled,
  loading,
  selectedNodeId,
  nodes,
  hasConfig,
  onToggle,
  error,
  onDismissError,
}: ProxyControlProps) {
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  // Can start if we have an imported config OR a selected node
  const canStart = hasConfig || !!selectedNodeId;

  return (
    <div className="border-b border-dark-800 bg-dark-850 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Left: status info */}
        <div className="flex items-center gap-4">
          <button
            onClick={onToggle}
            disabled={loading || (!canStart && !isRunning)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isRunning
                ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                : "bg-dark-700 text-dark-200 hover:bg-dark-600"
            } ${loading ? "opacity-50 cursor-not-allowed" : ""}`}
          >
            <Power size={18} />
          </button>
          <div>
            <p className="text-sm font-medium text-white">
              {isRunning ? "Running" : "Stopped"}
            </p>
            <p className="text-xs text-dark-200">
              {selectedNode
                ? `Active: ${selectedNode.name} (${selectedNode.server}:${selectedNode.port})`
                : hasConfig
                  ? "Using imported config (auto-select by profile)"
                  : "No node selected"}
            </p>
          </div>
        </div>

        {/* Right: proxy mode indicator */}
        <div className="flex items-center gap-2">
          {hasConfig && (
            <span className="text-xs bg-green-600/20 text-green-400 px-2 py-1 rounded">
              TUN Mode
            </span>
          )}
          {proxyEnabled && (
            <span className="text-xs bg-primary-600/20 text-primary-400 px-2 py-1 rounded">
              System Proxy: ON
            </span>
          )}
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mt-2 flex items-center gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <span className="text-xs text-red-300 flex-1">{error}</span>
          <button
            onClick={onDismissError}
            className="text-xs text-red-400 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

export default ProxyControl;
