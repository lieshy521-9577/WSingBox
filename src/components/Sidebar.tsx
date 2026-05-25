import { Network, ScrollText, LayoutDashboard, FileUp, Trash2 } from "lucide-react";

type Page = "overview" | "nodes" | "logs";

interface SidebarProps {
  currentPage: Page;
  onPageChange: (page: Page) => void;
  isRunning: boolean;
  onImportConfig: () => void;
  onClearConfig: () => void;
}

function Sidebar({ currentPage, onPageChange, isRunning, onImportConfig, onClearConfig }: SidebarProps) {
  const navItems = [
    { id: "overview" as Page, label: "Overview", icon: LayoutDashboard },
    { id: "nodes" as Page, label: "Nodes", icon: Network },
    { id: "logs" as Page, label: "Logs", icon: ScrollText },
  ];

  return (
    <aside className="w-48 bg-dark-950 border-r border-dark-800 flex flex-col">
      {/* Status indicator */}
      <div className="p-4 border-b border-dark-800">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isRunning ? "bg-green-400 animate-pulse" : "bg-gray-500"
            }`}
          />
          <span className="text-xs text-dark-200">
            {isRunning ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onPageChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? "bg-primary-600/20 text-primary-400"
                  : "text-dark-200 hover:bg-dark-800 hover:text-white"
              }`}
            >
              <Icon size={16} />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Bottom actions */}
      <div className="p-2 border-t border-dark-800 space-y-1">
        <button
          onClick={onImportConfig}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-dark-200 hover:bg-dark-800 hover:text-white transition-colors"
        >
          <FileUp size={16} />
          Import Config
        </button>
        <button
          onClick={onClearConfig}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-dark-200 hover:bg-red-500/10 hover:text-red-400 transition-colors"
        >
          <Trash2 size={16} />
          Clear Config
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
