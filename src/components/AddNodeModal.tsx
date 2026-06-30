import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { ProtocolType, PROTOCOL_LABELS, ProxyNode } from "../types";
import ModalShell from "./ModalShell";

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
    setError("");
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
    <ModalShell
      open
      size="wide"
      label={initialNode ? "Edit Proxy Node" : "Add Proxy Node"}
      title={initialNode ? "Update outbound node" : "Create outbound node"}
      description="Keep the primary fields visible, then paste protocol-specific JSON only when needed."
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary rounded-2xl px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="proxy-node-form"
            disabled={loading}
            className="btn-primary rounded-2xl px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {loading ? (initialNode ? "Saving..." : "Adding...") : initialNode ? "Save Node" : "Add Node"}
          </button>
        </div>
      }
    >
      <form id="proxy-node-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <Field label="Node Name *">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Server"
                className="input"
              />
            </Field>

            <div className="grid grid-cols-[minmax(0,1fr)_6.25rem] gap-3">
              <Field label="Server *">
                <input
                  type="text"
                  value={server}
                  onChange={(e) => setServer(e.target.value)}
                  placeholder="example.com"
                  className="input"
                />
              </Field>
              <Field label="Port *">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(Number(e.target.value))}
                  className="input"
                />
              </Field>
            </div>

            {error && (
              <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
                {error}
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs text-content-secondary">Protocol *</label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {Object.entries(PROTOCOL_LABELS).map(([key, label]) => {
                  const active = nodeType === key;

                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        const type = key as ProtocolType;
                        setNodeType(type);
                        setSettingsJson(settingsHints[type] || "{}");
                      }}
                      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-sm transition-all ${
                        active
                          ? "border-primary-500/40 bg-primary-600/12 text-primary-200 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.16)]"
                          : "border-border bg-surface-elevated text-content-secondary hover:bg-surface-subtle hover:text-content"
                      }`}
                    >
                      <span className="truncate">{label}</span>
                      {active && <Check size={14} className="shrink-0 text-primary-300" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <Field label="Protocol Settings (JSON)">
              <textarea
                value={settingsJson}
                onChange={(e) => setSettingsJson(e.target.value)}
                rows={10}
                className="input min-h-60 resize-y font-mono text-xs"
                spellCheck={false}
              />
            </Field>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-content-secondary">{label}</span>
      {children}
    </label>
  );
}

export default AddNodeModal;
