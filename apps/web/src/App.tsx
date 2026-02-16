import { useEffect, useRef, useState } from "react";
import { ChatTab } from "./components/ChatTab";
import { ScheduleTab } from "./components/ScheduleTab";
import { FocusTimer } from "./components/FocusTimer";
import { InstallPrompt } from "./components/InstallPrompt";
import { JournalView } from "./components/JournalView";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { SettingsView } from "./components/SettingsView";
import { HabitsGoalsView } from "./components/HabitsGoalsView";
import { FloatingQuickCapture } from "./components/FloatingQuickCapture";
import { SyncStatusBadge } from "./components/SyncStatusBadge";
import { TabBar, TabId } from "./components/TabBar";
import { useDashboard } from "./hooks/useDashboard";
import { enablePushNotifications, isPushEnabled, supportsPushNotifications } from "./lib/push";
import { setupSyncListeners } from "./lib/sync";
import { applyTheme } from "./lib/theme";
import { loadOnboardingProfile, loadThemePreference, saveOnboardingProfile, saveThemePreference } from "./lib/storage";
import { hapticCriticalAlert } from "./lib/haptics";
import { OnboardingProfile, ThemePreference } from "./types";

type PushState = "checking" | "ready" | "enabled" | "unsupported" | "denied" | "error";

export default function App(): JSX.Element {
  const { data, loading, error, refresh } = useDashboard();
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");
  const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() => loadThemePreference());
  const [activeTab, setActiveTab] = useState<TabId>("chat");
  const seenCriticalNotifications = useRef<Set<string>>(new Set());

  useEffect(() => {
    saveThemePreference(themePreference);
    applyTheme(themePreference);

    if (themePreference !== "system") {
      return;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (): void => {
      applyTheme("system");
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [themePreference]);

  // Set up background sync listeners
  useEffect(() => {
    setupSyncListeners();
  }, []);

  useEffect(() => {
    let disposed = false;

    const syncPushState = async (): Promise<void> => {
      if (!supportsPushNotifications()) {
        if (!disposed) {
          setPushState("unsupported");
        }
        return;
      }

      if (Notification.permission === "denied") {
        if (!disposed) {
          setPushState("denied");
          setPushMessage("Notification permission is blocked in browser settings.");
        }
        return;
      }

      const enabled = await isPushEnabled();
      if (!disposed) {
        setPushState(enabled ? "enabled" : "ready");
      }
    };

    void syncPushState();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!data?.notifications) return;

    let triggered = false;
    const seen = seenCriticalNotifications.current;

    for (const notification of data.notifications) {
      if (notification.priority !== "critical") continue;
      if (!seen.has(notification.id)) {
        seen.add(notification.id);
        triggered = true;
      }
    }

    if (triggered) {
      hapticCriticalAlert();
    }
  }, [data?.notifications]);

  const handleEnablePush = async (): Promise<void> => {
    setPushState("checking");
    const result = await enablePushNotifications();
    setPushState(result.status === "enabled" ? "enabled" : result.status);
    setPushMessage(result.message ?? "");
  };

  const handleOnboardingComplete = (nextProfile: OnboardingProfile): void => {
    saveOnboardingProfile(nextProfile);
    setProfile(nextProfile);
  };

  const handleThemeChange = (next: ThemePreference): void => {
    setThemePreference(next);
  };

  const pushButtonLabel =
    pushState === "enabled"
      ? "Push Enabled"
      : pushState === "checking"
        ? "Connecting..."
        : "Enable Push";

  const pushButtonDisabled =
    pushState === "checking" || pushState === "enabled" || pushState === "unsupported";

  if (!profile) {
    return (
      <main className="app-shell">
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </main>
    );
  }

  return (
    <main className="app-shell">
      <InstallPrompt />
      <FloatingQuickCapture onUpdated={refresh} />
      <SyncStatusBadge />

      {/* Header shown only for push notifications setup */}
      {pushState !== "enabled" && (
        <header className="hero-compact">
          <div className="hero-actions">
            <button type="button" onClick={() => void handleEnablePush()} disabled={pushButtonDisabled}>
              {pushButtonLabel}
            </button>
          </div>
        </header>
      )}
      {pushMessage && <p className="push-message">{pushMessage}</p>}

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          {/* Tab content area */}
          <div className="tab-content-area">
            {activeTab === "chat" && (
              <ChatTab
                todayFocus={data.summary.todayFocus}
                pendingDeadlines={data.summary.pendingDeadlines}
                activeAgents={data.summary.activeAgents}
                journalStreak={data.summary.journalStreak}
              />
            )}
            {activeTab === "schedule" && (
              <ScheduleTab scheduleKey={`schedule-${scheduleRevision}`} />
            )}
            {activeTab === "journal" && (
              <div className="journal-tab-container">
                <JournalView />
                <HabitsGoalsView />
                <FocusTimer onUpdated={refresh} />
              </div>
            )}
            {activeTab === "settings" && (
              <SettingsView
                themePreference={themePreference}
                onThemeChange={handleThemeChange}
                onUpdated={refresh}
                onCalendarImported={() => setScheduleRevision((revision) => revision + 1)}
              />
            )}
          </div>

          {/* Bottom tab bar */}
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
        </>
      )}
    </main>
  );
}
