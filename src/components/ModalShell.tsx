import { X } from "lucide-react";

interface ModalShellProps {
  open: boolean;
  label?: string;
  title: string;
  description?: string;
  size?: "standard" | "wide" | "editor";
  footer?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

const sizeClassMap: Record<NonNullable<ModalShellProps["size"]>, string> = {
  standard: "max-w-2xl",
  wide: "max-w-3xl",
  editor: "max-w-6xl",
};

function ModalShell({
  open,
  label,
  title,
  description,
  size = "standard",
  footer,
  onClose,
  children,
}: ModalShellProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 dark:bg-slate-950/58 px-4 py-5 backdrop-blur-sm">
      <div
        className={`panel-card modal-shell flex max-h-[min(90vh,980px)] w-full flex-col overflow-hidden rounded-[26px] p-0 shadow-2xl ${sizeClassMap[size]}`}
      >
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {label && <p className="section-label">{label}</p>}
              <h2 className="mt-1.5 text-[1.2rem] font-semibold tracking-tight text-content">{title}</h2>
              {description && (
                <p className="mt-2 max-w-3xl text-[13px] leading-5 text-content-secondary">
                  {description}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl p-2 text-content-secondary transition-colors hover:bg-surface-elevated hover:text-content"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>

        {footer && <div className="border-t border-border/70 px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export default ModalShell;
