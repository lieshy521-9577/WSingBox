import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, FileJson, Link2, Shield } from "lucide-react";
import { ImportValidationReport } from "../types";
import ModalShell from "./ModalShell";

interface ImportProfileModalProps {
  open: boolean;
  onClose: () => void;
  onValidateFile: (filePath: string) => Promise<ImportValidationReport>;
  onValidateUrl: (url: string) => Promise<ImportValidationReport>;
  onImportFile: (filePath: string) => Promise<void>;
  onImportUrl: (url: string) => Promise<void>;
}

function ImportProfileModal({
  open,
  onClose,
  onValidateFile,
  onValidateUrl,
  onImportFile,
  onImportUrl,
}: ImportProfileModalProps) {
  const [mode, setMode] = useState<"file" | "url">("file");
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const [report, setReport] = useState<ImportValidationReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setReport(null);
      setError("");
      setLoading(false);
    }
  }, [open]);

  const resetFeedback = () => {
    setReport(null);
    setError("");
  };

  const handlePickFile = async () => {
    resetFeedback();
    const selected = await openDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "sing-box profile", extensions: ["json"] }],
    });
    const picked = Array.isArray(selected) ? selected[0] : selected;
    if (!picked) {
      return;
    }

    setFilePath(picked);
    setLoading(true);
    try {
      const nextReport = await onValidateFile(picked);
      setReport(nextReport);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleValidateUrl = async () => {
    resetFeedback();
    if (!url.trim()) {
      setError("Please enter a profile URL");
      return;
    }

    setLoading(true);
    try {
      const nextReport = await onValidateUrl(url.trim());
      setReport(nextReport);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    setError("");
    try {
      if (mode === "file") {
        await onImportFile(filePath);
      } else {
        await onImportUrl(url.trim());
      }
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const canImport =
    !!report &&
    ((mode === "file" && !!filePath) || (mode === "url" && !!url.trim()));

  return (
    <ModalShell
      open={open}
      size="wide"
      label="Import Profile"
      title="Validate before importing"
      description="Choose local JSON or subscription URL first, then run a quick compatibility check before saving."
      onClose={onClose}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={loading || !canImport}
            onClick={() => void handleImport()}
            className="btn-primary rounded-2xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Working..." : "Import Profile"}
          </button>
        </div>
      }
    >
      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ModeCard
              active={mode === "file"}
              icon={<FileJson size={18} />}
              title="Local JSON"
              description="Pick a file from Explorer and inspect it before importing."
              tone="primary"
              onClick={() => {
                setMode("file");
                resetFeedback();
              }}
            />
            <ModeCard
              active={mode === "url"}
              icon={<Link2 size={18} />}
              title="Subscription URL"
              description="Paste a remote profile link and preview compatibility first."
              tone="emerald"
              onClick={() => {
                setMode("url");
                resetFeedback();
              }}
            />
          </div>

          {mode === "file" ? (
            <div className="surface-block rounded-[22px] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-content">Selected file</h3>
                  <p className="mt-1 text-[12px] text-content-secondary">
                    Choose a sing-box JSON profile from your local disk.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handlePickFile()}
                  className="btn-primary rounded-2xl px-4 py-2 text-sm font-medium"
                >
                  Choose File
                </button>
              </div>
              <div className="mt-3 rounded-2xl border border-border/70 bg-surface-elevated/60 px-3 py-2 text-[12px] text-content-secondary">
                {filePath || "No file selected yet"}
              </div>
            </div>
          ) : (
            <div className="surface-block rounded-[22px] p-4">
              <h3 className="text-sm font-semibold text-content">Subscription URL</h3>
              <p className="mt-1 text-[12px] text-content-secondary">
                Paste the full profile URL, then validate before importing.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  type="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://example.com/profile.json"
                  className="input flex-1"
                />
                <button
                  type="button"
                  onClick={() => void handleValidateUrl()}
                  className="btn-secondary rounded-2xl px-4 py-2 text-sm font-medium"
                >
                  Check
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="surface-block rounded-[22px] p-4">
          <div className="flex items-center gap-2 text-content-secondary">
            <Shield size={16} />
            <span className="section-label">Import preflight</span>
          </div>

          {!report && !error && (
            <div className="mt-5 rounded-[20px] border border-dashed border-border/80 px-4 py-8 text-center text-[13px] text-content-muted">
              Run validation to preview nodes, groups, and TUN requirements before importing.
            </div>
          )}

          {error && (
            <div className="mt-4 rounded-[20px] border border-red-500/20 bg-red-500/10 p-4 text-[13px] text-red-600 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            </div>
          )}

          {report && (
            <div className="mt-4 space-y-3">
              <div className="rounded-[20px] border border-emerald-500/20 bg-emerald-500/8 p-4">
                <div className="flex items-start gap-2">
                  <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-500 dark:text-emerald-300" />
                  <div>
                    <p className="text-sm font-semibold text-content">{report.display_name}</p>
                    <p className="mt-1 text-[12px] text-content-secondary">
                      {report.source_kind === "url" ? "URL profile" : "Local file"} · {report.node_count} nodes · {report.group_count} groups
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <MiniStat label="Nodes" value={String(report.node_count)} />
                <MiniStat label="Groups" value={String(report.group_count)} />
                <MiniStat label="TUN" value={report.has_tun ? "Yes" : "No"} />
              </div>

              {report.warnings.length > 0 && (
                <div className="rounded-[20px] border border-amber-500/20 bg-amber-500/8 p-4">
                  <p className="text-[11px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                    Warnings
                  </p>
                  <div className="mt-2 space-y-1.5 text-[12px] leading-5 text-content-secondary">
                    {report.warnings.map((warning) => (
                      <p key={warning}>- {warning}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function ModeCard({
  active,
  icon,
  title,
  description,
  tone,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  tone: "primary" | "emerald";
  onClick: () => void;
}) {
  const activeClass =
    tone === "primary"
      ? "border-primary-500/30 bg-primary-600/10"
      : "border-emerald-500/30 bg-emerald-500/10";
  const iconClass =
    tone === "primary"
      ? "bg-primary-600/12 text-primary-600 dark:text-primary-300"
      : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-[22px] border p-4 text-left transition-all ${
        active
          ? activeClass
          : "border-border/80 bg-surface-elevated/40 hover:bg-surface-elevated/70"
      }`}
    >
      <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${iconClass}`}>
        {icon}
      </div>
      <h3 className="mt-3 text-sm font-semibold text-content">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-5 text-content-secondary">{description}</p>
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-border/70 bg-surface-elevated/50 px-3 py-2.5">
      <p className="text-[10px] uppercase tracking-[0.14em] text-content-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-content">{value}</p>
    </div>
  );
}

export default ImportProfileModal;
