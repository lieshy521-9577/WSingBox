import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, X } from "lucide-react";

export interface ToastMessage {
  id: number;
  type: "success" | "error";
  message: string;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));

    // Auto-dismiss after 3.5s
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, 3500);

    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="alert"
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-xl transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0"
      } ${
        toast.type === "success"
          ? "border-emerald-500/30 bg-emerald-50/90 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
          : "border-red-500/30 bg-red-50/90 text-red-800 dark:bg-red-500/15 dark:text-red-200"
      }`}
      style={{ minWidth: 280 }}
    >
      {toast.type === "success" ? (
        <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <AlertTriangle size={18} className="shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="flex-1 text-[13px] leading-snug">{toast.message}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="shrink-0 rounded-lg p-1 opacity-60 transition-opacity hover:opacity-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export default Toast;
