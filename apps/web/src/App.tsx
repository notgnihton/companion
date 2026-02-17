import { useCallback, useEffect, useRef, useState } from "react";
import { ChatTab } from "./components/ChatTab";
import { LoginView } from "./components/LoginView";
import { ScheduleTab } from "./components/ScheduleTab";
import { InstallPrompt } from "./components/InstallPrompt";
import { OnboardingFlow } from "./components/OnboardingFlow";
import { SettingsView } from "./components/SettingsView";
import { HabitsGoalsView } from "./components/HabitsGoalsView";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { NutritionView } from "./components/NutritionView";
import { TabBar, TabId } from "./components/TabBar";
import { useDashboard } from "./hooks/useDashboard";
import { getAuthMe, getAuthStatus, login, logout } from "./lib/api";
import { enablePushNotifications, isPushEnabled, supportsPushNotifications } from "./lib/push";
import { setupSyncListeners } from "./lib/sync";
import { applyTheme } from "./lib/theme";
import {
  clearAuthToken,
  clearCompanionSessionData,
  loadAuthToken,
  loadOnboardingProfile,
  saveOnboardingProfile
} from "./lib/storage";
import { hapticCriticalAlert } from "./lib/haptics";
import { parseDeepLink } from "./lib/deepLink";
import { OnboardingProfile } from "./types";

type PushState = "checking" | "ready" | "enabled" | "unsupported" | "denied" | "error";
type AuthState = "checking" | "required-login" | "ready";

function parseApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const raw = error.message?.trim();
  if (!raw) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(raw) as { error?: string };
    if (parsed.error && parsed.error.trim().length > 0) {
      return parsed.error.trim();
    }
  } catch {
    return raw;
  }

  return raw;
}

export default function App(): JSX.Element {
  const initialDeepLink = parseDeepLink(typeof window === "undefined" ? "" : window.location.search);
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [authRequired, setAuthRequired] = useState(false);
  const [authUserEmail, setAuthUserEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const { data, loading, error } = useDashboard(authState === "ready");
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");
  const [profile, setProfile] = useState<OnboardingProfile | null>(loadOnboardingProfile());
  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>(initialDeepLink.tab ?? "chat");
  const [focusDeadlineId, setFocusDeadlineId] = useState<string | null>(initialDeepLink.deadlineId);
  const [focusLectureId, setFocusLectureId] = useState<string | null>(initialDeepLink.lectureId);
  const [settingsSection, setSettingsSection] = useState<string | null>(initialDeepLink.section);
  const seenCriticalNotifications = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;

    const initializeAuth = async (): Promise<void> => {
      setAuthState("checking");
      setAuthError(null);

      try {
        const status = await getAuthStatus();
        if (disposed) {
          return;
        }

        setAuthRequired(status.required);
        if (!status.required) {
          setAuthState("ready");
          return;
        }

        if (!loadAuthToken()) {
          setAuthState("required-login");
          return;
        }

        const me = await getAuthMe();
        if (disposed) {
          return;
        }

        setAuthUserEmail(me.user.email);
        setAuthState("ready");
      } catch (error) {
        if (disposed) {
          return;
        }

        clearAuthToken();
        setAuthUserEmail(null);
        const message = parseApiErrorMessage(error, "");
        if (message.includes("404")) {
          // Backward-compatible fallback for older server versions without auth endpoints.
          setAuthRequired(false);
          setAuthState("ready");
          return;
        }

        setAuthState("required-login");
      }
    };

    void initializeAuth();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    applyTheme("dark");
  }, []);

  // Set up background sync listeners
  useEffect(() => {
    setupSyncListeners();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const KEYBOARD_GAP_THRESHOLD_PX = 80;
    const VIEWPORT_DROP_THRESHOLD_PX = 110;
    let baselineViewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
    const isCoarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
    const isIOS =
      /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

    const hasEditableFocus = (): boolean => {
      const active = document.activeElement;
      if (!active) {
        return false;
      }
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return true;
      }
      return (active as HTMLElement).isContentEditable;
    };

    const updateViewportVars = (): void => {
      const viewport = window.visualViewport;
      const viewportHeight = Math.round(viewport?.height ?? window.innerHeight);
      const viewportOffsetTop = Math.round(viewport?.offsetTop ?? 0);
      root.style.setProperty("--app-viewport-height", `${viewportHeight}px`);
      root.style.setProperty("--app-viewport-offset-top", `${viewportOffsetTop}px`);

      const editableFocused = hasEditableFocus();
      const chatTabActive = document.body.classList.contains("chat-tab-active");
      if (!editableFocused) {
        baselineViewportHeight = Math.max(baselineViewportHeight, viewportHeight);
      }

      // iOS Safari can keep innerHeight and visualViewport in sync while the keyboard is open.
      // Detect keyboard-open via either direct gap or a significant viewport height drop while focused.
      const keyboardGap = Math.max(0, Math.round(window.innerHeight - viewportHeight - viewportOffsetTop));
      const viewportDrop = Math.max(0, baselineViewportHeight - viewportHeight);
      const mobileChatInputFocused = editableFocused && chatTabActive && (isIOS || isCoarsePointer);
      const keyboardOpen =
        editableFocused &&
        (mobileChatInputFocused || keyboardGap > KEYBOARD_GAP_THRESHOLD_PX || viewportDrop > VIEWPORT_DROP_THRESHOLD_PX);
      document.body.classList.toggle("keyboard-open", keyboardOpen);
    };

    const handleFocusEvent = (): void => {
      window.setTimeout(updateViewportVars, 40);
    };
    const handleOrientationChange = (): void => {
      baselineViewportHeight = Math.round(window.visualViewport?.height ?? window.innerHeight);
      window.setTimeout(updateViewportVars, 80);
    };

    updateViewportVars();

    window.addEventListener("resize", updateViewportVars);
    window.addEventListener("orientationchange", handleOrientationChange);
    window.addEventListener("focusin", handleFocusEvent);
    window.addEventListener("focusout", handleFocusEvent);
    window.visualViewport?.addEventListener("resize", updateViewportVars);
    window.visualViewport?.addEventListener("scroll", updateViewportVars);

    return () => {
      window.removeEventListener("resize", updateViewportVars);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.removeEventListener("focusin", handleFocusEvent);
      window.removeEventListener("focusout", handleFocusEvent);
      window.visualViewport?.removeEventListener("resize", updateViewportVars);
      window.visualViewport?.removeEventListener("scroll", updateViewportVars);
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-offset-top");
      document.body.classList.remove("keyboard-open");
    };
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

  const applyDeepLinkFromUrl = useCallback((): void => {
    const next = parseDeepLink(window.location.search);
    if (next.tab) {
      setActiveTab(next.tab);
    }
    setFocusDeadlineId(next.deadlineId);
    setFocusLectureId(next.lectureId);
    setSettingsSection(next.section);
  }, []);

  useEffect(() => {
    if (!profile) {
      document.body.classList.remove("chat-tab-active");
      return;
    }

    const isChatActive = activeTab === "chat";
    document.body.classList.toggle("chat-tab-active", isChatActive);

    return () => {
      document.body.classList.remove("chat-tab-active");
    };
  }, [activeTab, profile]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleNavigation = (): void => {
      applyDeepLinkFromUrl();
    };

    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);
    applyDeepLinkFromUrl();

    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
    };
  }, [applyDeepLinkFromUrl]);

  useEffect(() => {
    if (activeTab !== "settings" || !settingsSection) {
      return;
    }

    const targetBySection: Record<string, string> = {
      integrations: "integration-status-panel"
    };
    const targetId = targetBySection[settingsSection];
    if (!targetId) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTab, settingsSection]);

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

  const handleTabChange = (tab: TabId): void => {
    setActiveTab(tab);

    if (tab !== "schedule") {
      setFocusDeadlineId(null);
      setFocusLectureId(null);
    }
    if (tab !== "settings") {
      setSettingsSection(null);
    }
  };

  const pushButtonLabel =
    pushState === "enabled"
      ? "Push Enabled"
      : pushState === "checking"
        ? "Connecting..."
        : "Enable Push";

  const pushButtonDisabled =
    pushState === "checking" || pushState === "enabled" || pushState === "unsupported";

  const handleLogin = async (email: string, password: string): Promise<void> => {
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const session = await login(email, password);
      setAuthUserEmail(session.user.email);
      setAuthState("ready");
    } catch (error) {
      setAuthError(parseApiErrorMessage(error, "Sign in failed"));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async (): Promise<void> => {
    setAuthSubmitting(true);
    try {
      await logout();
    } catch {
      // Local session clear still guarantees sign-out even when network is unavailable.
    } finally {
      clearCompanionSessionData({ keepTheme: true });
      setProfile(null);
      setAuthUserEmail(null);
      setAuthError(null);
      setAuthState(authRequired ? "required-login" : "ready");
      setAuthSubmitting(false);
    }
  };

  if (authState === "checking") {
    return (
      <main className="app-shell">
        <section className="panel auth-panel">
          <p>Checking authentication...</p>
        </section>
      </main>
    );
  }

  if (authState === "required-login") {
    return (
      <main className="app-shell">
        <LoginView loading={authSubmitting} error={authError} onLogin={handleLogin} />
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="app-shell">
        <OnboardingFlow onComplete={handleOnboardingComplete} />
      </main>
    );
  }

  return (
    <main className={`app-shell ${activeTab === "chat" ? "app-shell-chat-active" : ""}`}>
      <InstallPrompt />

      {/* Push setup messaging stays in Settings to avoid squashing chat layout */}
      {activeTab === "settings" && (
        <header className="hero-compact">
          {authRequired && authUserEmail && <p className="muted auth-session-label">Signed in as {authUserEmail}</p>}
          <div className="hero-actions">
            {pushState !== "enabled" && (
              <button type="button" onClick={() => void handleEnablePush()} disabled={pushButtonDisabled}>
                {pushButtonLabel}
              </button>
            )}
            {authRequired && (
              <button type="button" onClick={() => void handleLogout()} disabled={authSubmitting}>
                {authSubmitting ? "Signing out..." : "Sign out"}
              </button>
            )}
          </div>
        </header>
      )}
      {activeTab === "settings" && pushMessage && <p className="push-message">{pushMessage}</p>}

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          {/* Tab content area */}
          <div className="tab-content-area">
            {activeTab === "chat" && (
              <ChatTab />
            )}
            {activeTab === "schedule" && (
              <ScheduleTab
                scheduleKey={`schedule-${scheduleRevision}`}
                focusDeadlineId={focusDeadlineId ?? undefined}
                focusLectureId={focusLectureId ?? undefined}
              />
            )}
            {activeTab === "nutrition" && (
              <NutritionView />
            )}
            {activeTab === "habits" && (
              <div className="habits-tab-container habits-analytics-stack">
                <HabitsGoalsView />
                <AnalyticsDashboard />
              </div>
            )}
            {activeTab === "settings" && (
              <SettingsView
                onCalendarImported={() => setScheduleRevision((revision) => revision + 1)}
              />
            )}
          </div>

          {/* Bottom tab bar */}
          <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
        </>
      )}
    </main>
  );
}
