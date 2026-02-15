import { useEffect, useState } from "react";
import { getNotificationPreferences, updateNotificationPreferences } from "../lib/api";
import { NotificationPreferences } from "../types";

const categoryOrder: Array<keyof NotificationPreferences["categoryToggles"]> = [
  "notes",
  "lecture-plan",
  "assignment-tracker",
  "orchestrator"
];

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
    try {
      const updated = await updateNotificationPreferences(next);
      setPreferences(updated);
      setMessage("Notification preferences saved.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Notification settings</h2>
      </header>
      {message && <p>{message}</p>}

      <div className="settings-stack">
        <label>
          <input
            type="checkbox"
            checked={preferences.quietHours.enabled}
            onChange={(event) =>
              void save({
                quietHours: {
                  ...preferences.quietHours,
                  enabled: event.target.checked
                }
              })
            }
            disabled={busy}
          />
          Enable quiet hours
        </label>

        <div className="grid-two">
          <label>
            Quiet hours start
            <input
              type="number"
              min={0}
              max={23}
              value={preferences.quietHours.startHour}
              onChange={(event) =>
                setPreferences((prev) => ({
                  ...prev,
                  quietHours: {
                    ...prev.quietHours,
                    startHour: Number(event.target.value)
                  }
                }))
              }
              onBlur={() => void save({ quietHours: preferences.quietHours })}
            />
          </label>

          <label>
            Quiet hours end
            <input
              type="number"
              min={0}
              max={23}
              value={preferences.quietHours.endHour}
              onChange={(event) =>
                setPreferences((prev) => ({
                  ...prev,
                  quietHours: {
                    ...prev.quietHours,
                    endHour: Number(event.target.value)
                  }
                }))
              }
              onBlur={() => void save({ quietHours: preferences.quietHours })}
            />
          </label>
        </div>

        <label>
          Minimum priority
          <select
            value={preferences.minimumPriority}
            onChange={(event) =>
              void save({
                minimumPriority: event.target.value as NotificationPreferences["minimumPriority"]
              })
            }
            disabled={busy}
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={preferences.allowCriticalInQuietHours}
            onChange={(event) => void save({ allowCriticalInQuietHours: event.target.checked })}
            disabled={busy}
          />
          Allow critical notifications in quiet hours
        </label>

        <div>
          <p>Category toggles</p>
          {categoryOrder.map((category) => (
            <label key={category}>
              <input
                type="checkbox"
                checked={preferences.categoryToggles[category]}
                onChange={(event) =>
                  void save({
                    categoryToggles: {
                      ...preferences.categoryToggles,
                      [category]: event.target.checked
                    }
                  })
                }
                disabled={busy}
              />
              {category}
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
