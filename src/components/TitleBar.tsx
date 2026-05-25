import { Minus, Square, X } from "lucide-react";

function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      className="h-8 flex items-center justify-between bg-dark-950 border-b border-dark-800 px-3"
    >
      <span className="text-xs text-dark-200 font-medium">SingBox Client</span>
      <div className="flex items-center gap-1">
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-dark-700 text-dark-200"
          onClick={() => {
            // Tauri window minimize
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().minimize()
            );
          }}
        >
          <Minus size={14} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-dark-700 text-dark-200"
          onClick={() => {
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().toggleMaximize()
            );
          }}
        >
          <Square size={11} />
        </button>
        <button
          className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-600 text-dark-200"
          onClick={() => {
            import("@tauri-apps/api/window").then((m) =>
              m.getCurrentWindow().close()
            );
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
