/**
 * SidebarTabs component
 *
 * A compact two-tab toggle for switching between Fleet View and Recent Conversations
 * in the sidebar. Uses herd-* design tokens for styling.
 */

import { useSidebarTab, useUIActions } from "../../store";
import type { SidebarTab } from "../../store/ui-slice";

interface TabButtonProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function TabButton({ label, isActive, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 py-1.5 text-xs font-medium transition-colors rounded-md ${
        isActive
          ? "text-herd-sidebar-fg bg-herd-primary/15"
          : "text-herd-sidebar-muted hover:text-herd-sidebar-fg hover:bg-herd-sidebar-hover"
      }`}
    >
      {label}
    </button>
  );
}

export function SidebarTabs() {
  const sidebarTab = useSidebarTab();
  const { setSidebarTab } = useUIActions();

  const handleTabChange = (tab: SidebarTab) => {
    setSidebarTab(tab);
  };

  return (
    <div className="flex gap-1 p-1 mx-2 mb-2 bg-herd-sidebar-hover/50 rounded-lg">
      <TabButton
        label="Fleet"
        isActive={sidebarTab === "fleet"}
        onClick={() => handleTabChange("fleet")}
      />
      <TabButton
        label="Chats"
        isActive={sidebarTab === "recent"}
        onClick={() => handleTabChange("recent")}
      />
    </div>
  );
}
