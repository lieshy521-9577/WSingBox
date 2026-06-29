import { useEffect, useState } from "react";
import { X } from "lucide-react";

interface RouteRuleModalProps {
  open: boolean;
  title: string;
  initialValue: string;
  description?: string;
  saveLabel?: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}

function RouteRuleModal({
  open,
  title,
  initialValue,
  description = "Edit the rule JSON directly. Invalid JSON will be rejected.",
  saveLabel = "Save Rule",
  onClose,
  onSave,
}: RouteRuleModalProps) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setValue(initialValue);
    setError(null);
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await onSave(value);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[min(88vh,900px)] w-[min(92vw,1200px)] flex-col rounded-xl border border-border bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-content">{title}</h3>
            <p className="mt-1 text-xs text-content-secondary">
              {description}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col space-y-4 px-5 py-4">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={18}
            className="input min-h-0 flex-1 resize-none font-mono text-xs"
            spellCheck={false}
          />

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RouteRuleModal;
