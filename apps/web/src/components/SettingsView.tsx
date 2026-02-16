import { NotificationSettings } from "./NotificationSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { ContextControls } from "./ContextControls";
import { CanvasSettings } from "./CanvasSettings";
import { CalendarImportView } from "./CalendarImportView";
import { WeeklyReviewView } from "./WeeklyReviewView";
import { NotificationHistoryView } from "./NotificationHistoryView";
import { ThemePreference } from "../types";

interface SettingsViewProps {
  themePreference: ThemePreference;
  onThemeChange: (preference: ThemePreference) => void;
  onUpdated: () => Promise<void>;
  onCalendarImported: () => void;
}

export function SettingsView({
  themePreference,
  onThemeChange,
  onUpdated,
  onCalendarImported
}: SettingsViewProps): JSX.Element {
  return (
    <div className="settings-container">
      <h2>Settings</h2>
      <ContextControls onUpdated={onUpdated} />
      <NotificationSettings />
      <AppearanceSettings preference={themePreference} onChange={onThemeChange} />
      <CanvasSettings />
      <CalendarImportView onImported={onCalendarImported} />
      <WeeklyReviewView />
      <NotificationHistoryView />
    </div>
  );
}
