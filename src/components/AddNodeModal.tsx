import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ProtocolType, PROTOCOL_LABELS, ProxyNode } from "../types";

interface AddNodeModalProps {
  onClose: () => void;
  onSubmit: (
    name: string,
    nodeType: string,
    server: string,
    port: number,
    settings: Record<string, unknown>
  ) => Promise<void>;
  initialNode?: ProxyNode | null;
}

function AddNodeModal({ onClose, onSubmit, initialNode = null }: AddNodeModalProps) {
  const [name, setName] = useState("");
  const [nodeType, setNodeType] = useState<ProtocolType>("shadowsocks");
  const [server, setServer] = useState("");
  const [port, setPort] = useState(443);
  const [settingsJson, setSettingsJson] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initialNode) {
      return;
    }

    setName(initialNode.name);
    setNodeType(initialNode.node_type as ProtocolType);
    setServer(initialNode.server);
    setPort(initialNode.port);
    setSettingsJson(JSON.stringify(initialNode.settings, null, 2));
  }, [initialNode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !server || !port) {
      setError("Please fill in all required fields");
      return;
    }

    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(settingsJson);
    } catch {
      setError("Invalid JSON in settings field");
      return;
    }

    setLoading(true);
    try {
      await onSubmit(name, nodeType, server, port, settings);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const settingsHints: Record<ProtocolType, string> = {
    shadowsocks: '{\n  "method": "aes-256-gcm",\n  "password": "your-password"\n}',
    vmess: '{\n  "uuid": "your-uuid",\n  "security": "auto",\n  "alter_id": 0\n}',
    trojan: '{\n  "password": "your-password",\n  "tls": { "enabled": true }\n}',
    vless: '{\n  "uuid": "your-uuid",\n  "flow": "xtls-rprx-vision"\n}',
    hysteria2: '{\n  "password": "your-password",\n  "tls": { "enabled": true }\n}',
    tuic: '{\n  "uuid": "your-uuid",\n  "password": "your-password"\n}',
    wireguard: '{\n  "private_key": "your-key",\n  "peer_public_key": "peer-key"\n}',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-surface-base border border-border rounded-xl w-[480px] max-h-[80vh] overflow-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-base font-semibold text-content">
            {initialNode ? "Edit Proxy Node" : "Add Proxy Node"}
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-elevated text-content-secondary"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-content-secondary mb-1">Node Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-content placeholder-content-muted focus:outline-none focus:border-primary-500"
            />
          </div>

          {/* Protocol */}
          <div>
            <label className="block text-xs text-content-secondary mb-1">Protocol *</label>
            <select
              value={nodeType}
              onChange={(e) => {
                const type = e.target.value as ProtocolType;
                setNodeType(type);
                setSettingsJson(settingsHints[type] || "{}");
              }}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-content focus:outline-none focus:border-primary-500"
            >
              {Object.entries(PROTOCOL_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Server & Port */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs text-content-secondary mb-1">Server *</label>
              <input
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-content placeholder-content-muted focus:outline-none focus:border-primary-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-content-secondary mb-1">Port *</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-sm text-content focus:outline-none focus:border-primary-500"
              />
            </div>
          </div>

          {/* Protocol-specific settings */}
          <div>
            <label className="block text-xs text-content-secondary mb-1">
              Protocol Settings (JSON)
            </label>
            <textarea
              value={settingsJson}
              onChange={(e) => setSettingsJson(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-surface-elevated border border-border rounded-lg text-xs text-content font-mono placeholder-content-muted focus:outline-none focus:border-primary-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-content-secondary hover:text-content transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? (initialNode ? "Saving..." : "Adding...") : (initialNode ? "Save Node" : "Add Node")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddNodeModal;
