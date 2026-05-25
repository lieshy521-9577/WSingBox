import { useState } from "react";
import { X } from "lucide-react";
import { ProtocolType, PROTOCOL_LABELS } from "../types";

interface AddNodeModalProps {
  onClose: () => void;
  onAdd: (
    name: string,
    nodeType: string,
    server: string,
    port: number,
    settings: Record<string, unknown>
  ) => Promise<void>;
}

function AddNodeModal({ onClose, onAdd }: AddNodeModalProps) {
  const [name, setName] = useState("");
  const [nodeType, setNodeType] = useState<ProtocolType>("shadowsocks");
  const [server, setServer] = useState("");
  const [port, setPort] = useState(443);
  const [settingsJson, setSettingsJson] = useState("{}");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      await onAdd(name, nodeType, server, port, settings);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Protocol-specific settings hints
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
      <div className="bg-dark-900 border border-dark-700 rounded-xl w-[480px] max-h-[80vh] overflow-auto shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-800">
          <h3 className="text-base font-semibold text-white">Add Proxy Node</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-dark-700 text-dark-200"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-dark-200 mb-1">Node Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Server"
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-white placeholder-dark-200 focus:outline-none focus:border-primary-500"
            />
          </div>

          {/* Protocol */}
          <div>
            <label className="block text-xs text-dark-200 mb-1">Protocol *</label>
            <select
              value={nodeType}
              onChange={(e) => {
                const type = e.target.value as ProtocolType;
                setNodeType(type);
                setSettingsJson(settingsHints[type] || "{}");
              }}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500"
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
              <label className="block text-xs text-dark-200 mb-1">Server *</label>
              <input
                type="text"
                value={server}
                onChange={(e) => setServer(e.target.value)}
                placeholder="example.com"
                className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-white placeholder-dark-200 focus:outline-none focus:border-primary-500"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs text-dark-200 mb-1">Port *</label>
              <input
                type="number"
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
                className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-sm text-white focus:outline-none focus:border-primary-500"
              />
            </div>
          </div>

          {/* Protocol-specific settings */}
          <div>
            <label className="block text-xs text-dark-200 mb-1">
              Protocol Settings (JSON)
            </label>
            <textarea
              value={settingsJson}
              onChange={(e) => setSettingsJson(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 bg-dark-800 border border-dark-700 rounded-lg text-xs text-white font-mono placeholder-dark-200 focus:outline-none focus:border-primary-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-dark-200 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? "Adding..." : "Add Node"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddNodeModal;
