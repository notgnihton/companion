import { useEffect, useState } from "react";
import { AgentStatusList } from "./components/AgentStatusList";
import { CalendarImportView } from "./components/CalendarImportView";
import { ContextControls } from "./components/ContextControls";
import { DeadlineList } from "./components/DeadlineList";
import { JournalView } from "./components/JournalView";
import { NotificationFeed } from "./components/NotificationFeed";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { NotificationSettings } from "./components/NotificationSettings";
import { ScheduleView } from "./components/ScheduleView";
import { SummaryTiles } from "./components/SummaryTiles";
import { WeeklyReviewView } from "./components/WeeklyReviewView";
import { useDashboard } from "./hooks/useDashboard";
import { enablePushNotifications, isPushEnabled, supportsPushNotifications } from "./lib/push";
import { loadOnboardingProfile, saveOnboardingProfile } from "./lib/storage";
import { OnboardingProfile } from "./types";

type PushState = "checking" | "ready" | "enabled" | "unsupported" | "denied" | "error";

export default function App(): JSX.Element {
  const { data, loading, error, refresh } = useDashboard();
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");
  const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());
  const [scheduleRevision, setScheduleRevision] = useState(0);

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
      <header className="hero">
        <div>
          <p className="eyebrow">Companion</p>
          <h1>Personal AI Assistant</h1>
          <p>Welcome back, {profile.name}.</p>
        </div>
        <div className="hero-actions">
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
          <button type="button" onClick={() => void handleEnablePush()} disabled={pushButtonDisabled}>
            {pushButtonLabel}
          </button>
        </div>
      </header>
      {pushMessage && <p>{pushMessage}</p>}

      {loading && <p>Loading dashboard...</p>}
      {error && <p className="error">{error}</p>}
      {data && (
        <>
          <SummaryTiles
            todayFocus={data.summary.todayFocus}
            pendingDeadlines={data.summary.pendingDeadlines}
            activeAgents={data.summary.activeAgents}
            journalStreak={data.summary.journalStreak}
          />
          <JournalView />
          <WeeklyReviewView />
          <CalendarImportView onImported={() => setScheduleRevision((revision) => revision + 1)} />
          <div className="grid-two">
            <ScheduleView key={`schedule-${scheduleRevision}`} />
            <DeadlineList key={`deadline-${scheduleRevision}`} />
          </div>
          <div className="grid-two">
            <AgentStatusList states={data.agentStates} />
            <NotificationFeed notifications={data.notifications} />
          </div>
          <ContextControls onUpdated={refresh} />
          <NotificationSettings />
        </>
      )}
    </main>
  );
}
