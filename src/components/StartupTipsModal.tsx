import { AlertCircle, CheckCircle2, Clock3, Info, Shield, X } from "lucide-react";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/52 px-4 backdrop-blur-sm">
      <div className="panel-card w-full max-w-2xl rounded-[26px] p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-content-secondary">
              <Info size={16} />
              <span className="section-label">Startup tips</span>
            </div>
            <h2 className="mt-2 text-[1.3rem] font-semibold tracking-tight text-content">
              Before you start sing-box
            </h2>
            <p className="mt-2 text-[13px] leading-5 text-content-secondary">
              A quick reminder of the runtime version and a few setup notes that help avoid common startup issues.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl p-2 text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
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

        <div className="mt-5 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
      </div>
    </div>
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
