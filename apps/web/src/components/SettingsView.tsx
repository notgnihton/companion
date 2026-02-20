import { NotificationSettings } from "./NotificationSettings";
import { CalendarImportView } from "./CalendarImportView";
import { IntegrationStatusView } from "./IntegrationStatusView";
import { IntegrationScopeSettings } from "./IntegrationScopeSettings";

interface SettingsViewProps {
  onCalendarImported: () => void;
}

export function SettingsView({
  onCalendarImported
}: SettingsViewProps): JSX.Element {
  return (
    <div className="settings-container">
      <div className="settings-header">
        <span className="settings-header-icon">⚙️</span>
        <h2>Settings</h2>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🔌 Integrations</h3>
        <IntegrationStatusView />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🎯 Data Scope</h3>
        <IntegrationScopeSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🔔 Notifications</h3>
        <NotificationSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">📅 Calendar Import</h3>
        <CalendarImportView onImported={onCalendarImported} />
      </div>
    </div>
  );
}
