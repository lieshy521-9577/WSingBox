import { useEffect, useState } from "react";
import ModalShell from "./ModalShell";

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
  description = "Edit the JSON directly. Invalid JSON will be rejected before save.",
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
    <ModalShell
      open={open}
      size="editor"
      label="JSON Editor"
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="btn-secondary rounded-2xl px-4 py-2 text-sm"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className="btn-primary rounded-2xl px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "Saving..." : saveLabel}
          </button>
        </div>
      }
    >
      <div className="flex min-h-[50vh] flex-col gap-4">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={18}
          className="input min-h-0 flex-1 resize-none font-mono text-xs"
          spellCheck={false}
        />

        {error && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-500 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </ModalShell>
  );
}

export default RouteRuleModal;
