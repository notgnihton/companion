export type TabId = "chat" | "schedule" | "nutrition" | "habits" | "settings";

interface TabBarProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

export function TabBar({ activeTab, onTabChange }: TabBarProps): JSX.Element {
  const tabs: Array<{ id: TabId; label: string; icon: string }> = [
    { id: "chat", label: "Chat", icon: "💬" },
    { id: "schedule", label: "Schedule", icon: "🗓️" },
    { id: "nutrition", label: "Nutrition", icon: "🍽️" },
    { id: "habits", label: "Growth", icon: "✅" },
    { id: "settings", label: "Settings", icon: "⚙️" }
  ];

  return (
    <nav className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={`tab-item ${activeTab === tab.id ? "tab-item-active" : ""}`}
          onClick={() => onTabChange(tab.id)}
          aria-current={activeTab === tab.id ? "page" : undefined}
        >
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
