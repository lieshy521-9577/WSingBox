import { AlertCircle, CheckCircle2, Clock3, Info, Shield } from "lucide-react";
import ModalShell from "./ModalShell";

interface StartupTipsModalProps {
  appVersion: string;
  coreVersion: string;
  suppressForSevenDays: boolean;
  onSuppressForSevenDaysChange: (value: boolean) => void;
  onClose: () => void;
}

function StartupTipsModal({
  appVersion,
  coreVersion,
  suppressForSevenDays,
  onSuppressForSevenDaysChange,
  onClose,
}: StartupTipsModalProps) {
  return (
    <ModalShell
      open
      size="wide"
      label="Startup Tips"
      title="Before you start sing-box"
      description="A quick reminder of the runtime version and a few setup notes that help avoid common startup issues."
      onClose={onClose}
      footer={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="inline-flex items-center gap-2 text-[13px] text-content-secondary">
            <input
              type="checkbox"
              checked={suppressForSevenDays}
              onChange={(event) => onSuppressForSevenDaysChange(event.target.checked)}
              className="h-4 w-4 rounded border-border text-primary-600 focus:ring-primary-500"
            />
            <span className="inline-flex items-center gap-1.5">
              <Clock3 size={14} />
              Do not show again for 7 days
            </span>
          </label>

          <button
            type="button"
            onClick={onClose}
            className="btn-primary inline-flex items-center justify-center rounded-2xl px-4 py-2 text-sm font-medium"
          >
            Continue
          </button>
        </div>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <TipStat
          icon={<CheckCircle2 size={16} />}
          label="Client version"
          value={appVersion}
          tone="text-sky-500 dark:text-sky-400"
        />
        <TipStat
          icon={<Shield size={16} />}
          label="sing-box core"
          value={coreVersion}
          tone="text-emerald-500 dark:text-emerald-400"
        />
      </div>

      <div className="mt-4 grid gap-3">
        <TipRow
          icon={<Shield size={16} />}
          title="Built-in core"
          body="This build ships with the bundled sing-box core. No separate sing-box installation or PATH setup should be required."
        />
        <TipRow
          icon={<AlertCircle size={16} />}
          title="TUN mode requires UAC"
          body="If your imported profile includes a TUN inbound, Windows will show a UAC prompt when starting the core."
        />
        <TipRow
          icon={<Info size={16} />}
          title="Profile compatibility"
          body="Older profiles are partially normalized on import. If startup still fails, review DNS, route rule, and TUN fields against the bundled core version."
        />
      </div>
    </ModalShell>
  );
}

function TipStat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <div className="surface-block rounded-[20px] p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl bg-surface-elevated ${tone}`}>
        {icon}
      </div>
      <p className="mt-3 text-[11px] uppercase tracking-[0.15em] text-content-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold text-content">{value}</p>
    </div>
  );
}

function TipRow({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="surface-block rounded-[20px] p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-surface-elevated text-content-secondary">
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-content">{title}</h3>
          <p className="mt-1.5 text-[13px] leading-5 text-content-secondary">{body}</p>
        </div>
      </div>
    </div>
  );
}

export default StartupTipsModal;
