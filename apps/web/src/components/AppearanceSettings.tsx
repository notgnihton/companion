import { ThemePreference } from "../types";

interface AppearanceSettingsProps {
  preference: ThemePreference;
  onChange: (preference: ThemePreference) => void;
}

export function AppearanceSettings({ preference, onChange }: AppearanceSettingsProps): JSX.Element {
  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Appearance</h2>
      </header>
      <div className="settings-stack">
        <label>
          Theme
          <select
            value={preference}
            onChange={(event) => onChange(event.target.value as ThemePreference)}
          >
            <option value="system">Match device</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: "0.9rem" }}>
          Preference is saved on this device for nighttime use.
        </p>
      </div>
    </section>
  );
}
