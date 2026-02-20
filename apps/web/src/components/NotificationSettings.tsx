import { useEffect, useState } from "react";
import { getNotificationPreferences, updateNotificationPreferences } from "../lib/api";
import { NotificationPreferences } from "../types";

const categoryLabels: Record<string, { label: string; emoji: string; description: string }> = {
  notes: { label: "Notes Agent", emoji: "📝", description: "Journal reflections and capture prompts" },
  "lecture-plan": { label: "Lecture Planner", emoji: "📅", description: "Upcoming lectures and schedule changes" },
  "assignment-tracker": { label: "Assignments", emoji: "📚", description: "Lab deadlines and progress alerts" },
  orchestrator: { label: "Smart Nudges", emoji: "🧠", description: "Proactive reminders and check-ins" }
};

const categoryOrder: Array<keyof NotificationPreferences["categoryToggles"]> = [
  "orchestrator",
  "assignment-tracker",
  "lecture-plan",
  "notes"
];

const priorityLabels: Record<string, string> = {
  low: "All notifications",
  medium: "Medium and above",
  high: "High and critical only",
  critical: "Critical only"
};

const defaultPreferences: NotificationPreferences = {
  quietHours: {
    enabled: false,
    startHour: 22,
    endHour: 7
  },
  minimumPriority: "low",
  allowCriticalInQuietHours: true,
  categoryToggles: {
    notes: true,
    "lecture-plan": true,
    "assignment-tracker": true,
    orchestrator: true
  }
};

function ToggleSwitch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`noti-toggle-switch ${checked ? "noti-toggle-on" : ""}`}
      onClick={() => onChange(!checked)}
      disabled={disabled}
    >
      <span className="noti-toggle-thumb" />
    </button>
  );
}

export function NotificationSettings(): JSX.Element {
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultPreferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const load = async (): Promise<void> => {
      const next = await getNotificationPreferences();
      setPreferences(next);
    };

    void load();
  }, []);

  const save = async (next: Partial<NotificationPreferences>): Promise<void> => {
    setBusy(true);
    setMessage("");
    try {
      const updated = await updateNotificationPreferences(next);
      setPreferences(updated);
      setMessage("Saved");
      setTimeout(() => setMessage(""), 1500);
    } finally {
      setBusy(false);
    }
  };

  const formatHour = (h: number): string => {
    const period = h >= 12 ? "PM" : "AM";
    const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${display}:00 ${period}`;
  };

  return (
    <section className="noti-settings">
      {message && <span className="noti-settings-saved">{message}</span>}

      {/* Quiet Hours */}
      <div className="noti-settings-card">
        <div className="noti-settings-row">
          <div className="noti-settings-row-text">
            <span className="noti-settings-label">🌙 Quiet Hours</span>
            <span className="noti-settings-desc">
              {preferences.quietHours.enabled
                ? `Silent ${formatHour(preferences.quietHours.startHour)} – ${formatHour(preferences.quietHours.endHour)}`
                : "Notifications can arrive anytime"}
            </span>
          </div>
          <ToggleSwitch
            checked={preferences.quietHours.enabled}
            onChange={(checked) =>
              void save({ quietHours: { ...preferences.quietHours, enabled: checked } })
            }
            disabled={busy}
          />
        </div>

        {preferences.quietHours.enabled && (
          <>
            <div className="noti-settings-time-row">
              <label className="noti-settings-time-label">
                From
                <select
                  className="noti-settings-time-select"
                  value={preferences.quietHours.startHour}
                  onChange={(e) => {
                    const startHour = Number(e.target.value);
                    setPreferences((prev) => ({
                      ...prev,
                      quietHours: { ...prev.quietHours, startHour }
                    }));
                    void save({ quietHours: { ...preferences.quietHours, startHour } });
                  }}
                  disabled={busy}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatHour(i)}</option>
                  ))}
                </select>
              </label>
              <label className="noti-settings-time-label">
                Until
                <select
                  className="noti-settings-time-select"
                  value={preferences.quietHours.endHour}
                  onChange={(e) => {
                    const endHour = Number(e.target.value);
                    setPreferences((prev) => ({
                      ...prev,
                      quietHours: { ...prev.quietHours, endHour }
                    }));
                    void save({ quietHours: { ...preferences.quietHours, endHour } });
                  }}
                  disabled={busy}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>{formatHour(i)}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="noti-settings-row noti-settings-sub-row">
              <div className="noti-settings-row-text">
                <span className="noti-settings-label">🚨 Critical override</span>
                <span className="noti-settings-desc">Allow critical alerts during quiet hours</span>
              </div>
              <ToggleSwitch
                checked={preferences.allowCriticalInQuietHours}
                onChange={(checked) => void save({ allowCriticalInQuietHours: checked })}
                disabled={busy}
              />
            </div>
          </>
        )}
      </div>

      {/* Category Toggles */}
      <div className="noti-settings-card">
        <p className="noti-settings-section-title">Sources</p>
        {categoryOrder.map((category) => {
          const info = categoryLabels[category] ?? { label: category, emoji: "🔔", description: "" };
          return (
            <div key={category} className="noti-settings-row">
              <div className="noti-settings-row-text">
                <span className="noti-settings-label">{info.emoji} {info.label}</span>
                <span className="noti-settings-desc">{info.description}</span>
              </div>
              <ToggleSwitch
                checked={preferences.categoryToggles[category]}
                onChange={(checked) =>
                  void save({
                    categoryToggles: { ...preferences.categoryToggles, [category]: checked }
                  })
                }
                disabled={busy}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
