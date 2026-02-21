import { useCallback, useEffect, useRef, useState } from "react";
import { ChatTab } from "./components/ChatTab";
import { LoginView } from "./components/LoginView";
import { ScheduleTab } from "./components/ScheduleTab";
import { InstallPrompt } from "./components/InstallPrompt";
import { SettingsView } from "./components/SettingsView";
import { HabitsGoalsView } from "./components/HabitsGoalsView";
import { AnalyticsDashboard } from "./components/AnalyticsDashboard";
import { NutritionView } from "./components/NutritionView";
import { TabBar, TabId } from "./components/TabBar";
import { LockedFeatureOverlay, UpgradePrompt } from "./components/UpgradePrompt";
import { useDashboard } from "./hooks/useDashboard";
import { usePlan } from "./hooks/usePlan";
import { getAuthMe, getAuthStatus, logout } from "./lib/api";
import { enablePushNotifications, isPushEnabled, supportsPushNotifications } from "./lib/push";
import { setupSyncListeners } from "./lib/sync";
import { applyTheme } from "./lib/theme";
import {
  clearAuthToken,
  clearCompanionSessionData,
  loadAuthToken,
  loadChatMood,
  saveAuthToken,
  saveChatMood
} from "./lib/storage";
import { hapticCriticalAlert } from "./lib/haptics";
import { parseDeepLink } from "./lib/deepLink";
import { ChatMood, FeatureId } from "./types";

type PushState = "checking" | "ready" | "enabled" | "unsupported" | "denied" | "error";
type AuthState = "checking" | "required-login" | "ready";

/** Map tab IDs to the feature gate that controls access. */
const TAB_FEATURE_MAP: Record<TabId, FeatureId> = {
  chat: "chat",
  schedule: "schedule",
  nutrition: "nutrition",
  habits: "habits",
  settings: "chat" // settings is always accessible (same gate as chat)
};

const TAB_DISPLAY_NAMES: Record<TabId, string> = {
  chat: "Chat",
  schedule: "Schedule",
  nutrition: "Nutrition",
  habits: "Growth",
  settings: "Settings"
};

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
  const [authProviders, setAuthProviders] = useState<{ local: boolean; google: boolean; github: boolean }>({
    local: true, google: false, github: false
  });
  const { data, loading, error } = useDashboard(authState === "ready");
  const [pushState, setPushState] = useState<PushState>("checking");
  const [pushMessage, setPushMessage] = useState("");

  const [scheduleRevision, setScheduleRevision] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>(initialDeepLink.tab ?? "chat");
  const [focusDeadlineId, setFocusDeadlineId] = useState<string | null>(initialDeepLink.deadlineId);
  const [focusLectureId, setFocusLectureId] = useState<string | null>(initialDeepLink.lectureId);
  const [settingsSection, setSettingsSection] = useState<string | null>(initialDeepLink.section);
  const [chatMood, setChatMood] = useState<ChatMood>(loadChatMood);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeFeatureLabel, setUpgradeFeatureLabel] = useState<string | undefined>(undefined);
  const seenCriticalNotifications = useRef<Set<string>>(new Set());
  const { planInfo, hasFeature } = usePlan(authState === "ready");

  useEffect(() => {
    let disposed = false;

    const initializeAuth = async (): Promise<void> => {
      setAuthState("checking");
      setAuthError(null);

      // Handle OAuth redirect: extract token from URL fragment (#auth_token=...)
      const hash = window.location.hash;
      if (hash.startsWith("#auth_token=")) {
        const token = hash.slice("#auth_token=".length);
        if (token) {
          saveAuthToken(token);
        }
        // Clean the URL fragment without triggering navigation
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }

      // Handle OAuth error from redirect
      if (hash.startsWith("#auth_error=")) {
        const errorMsg = decodeURIComponent(hash.slice("#auth_error=".length));
        history.replaceState(null, "", window.location.pathname + window.location.search);
        setAuthError(errorMsg || "OAuth sign-in failed");
        setAuthState("required-login");
        return;
      }

      try {
        const status = await getAuthStatus();
        if (disposed) {
          return;
        }

        setAuthRequired(status.required);
        setAuthProviders(status.providers ?? { local: true, google: false, github: false });
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
    const KEYBOARD_GAP_THRESHOLD_PX = 40;
    const VIEWPORT_DROP_THRESHOLD_PX = 70;
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

      const editableFocused = hasEditableFocus();
      const chatTabActive = document.body.classList.contains("chat-tab-active");
      const mobileChatInputFocused = editableFocused && chatTabActive && (isIOS || isCoarsePointer);
      if (!mobileChatInputFocused) {
        baselineViewportHeight = Math.max(baselineViewportHeight, viewportHeight);
      }

      const effectiveAppViewportHeight = mobileChatInputFocused ? baselineViewportHeight : viewportHeight;
      root.style.setProperty("--app-viewport-height", `${effectiveAppViewportHeight}px`);
      root.style.setProperty("--app-viewport-offset-top", `${viewportOffsetTop}px`);

      const keyboardGap = Math.max(0, Math.round(window.innerHeight - viewportHeight - viewportOffsetTop));
      const viewportDrop = Math.max(0, baselineViewportHeight - viewportHeight);
      const keyboardOpen =
        mobileChatInputFocused &&
        (keyboardGap > KEYBOARD_GAP_THRESHOLD_PX || viewportDrop > VIEWPORT_DROP_THRESHOLD_PX);
      const effectiveKeyboardGap = keyboardOpen ? keyboardGap : 0;
      root.style.setProperty("--keyboard-gap", `${effectiveKeyboardGap}px`);
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
      root.style.removeProperty("--keyboard-gap");
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
    const isChatActive = activeTab === "chat";
    document.body.classList.toggle("chat-tab-active", isChatActive);

    return () => {
      document.body.classList.remove("chat-tab-active");
    };
  }, [activeTab]);

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

  const openUpgradeModal = useCallback((featureLabel?: string) => {
    setUpgradeFeatureLabel(featureLabel);
    setShowUpgradeModal(true);
  }, []);

  const isTabLocked = useCallback((tab: TabId): boolean => {
    if (!planInfo) return false; // still loading, don't lock
    const feature = TAB_FEATURE_MAP[tab];
    return !hasFeature(feature);
  }, [planInfo, hasFeature]);

  const handleMoodChange = useCallback((mood: ChatMood): void => {
    setChatMood(mood);
    saveChatMood(mood);
  }, []);

  const handleLogout = async (): Promise<void> => {
    setAuthSubmitting(true);
    try {
      await logout();
    } catch {
      // Local session clear still guarantees sign-out even when network is unavailable.
    } finally {
      clearCompanionSessionData({ keepTheme: true });
      setAuthUserEmail(null);
      setAuthError(null);
      setAuthState(authRequired ? "required-login" : "ready");
      setAuthSubmitting(false);
    }
  };

  if (authState === "checking") {
    return (
      <main className="app-shell">
        <section className="login-view">
          <div className="login-card">
            <div className="login-brand">
              <div className="login-logo">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <p className="login-subtitle">Connecting...</p>
            </div>
          </div>
        </section>
      </main>
    );
  }

  if (authState === "required-login") {
    return (
      <main className="app-shell">
        <LoginView loading={authSubmitting} error={authError} providers={authProviders} />
      </main>
    );
  }

  return (
    <main className={`app-shell chat-mood-${chatMood} ${activeTab === "chat" ? "app-shell-chat-active" : ""}`}>
      <InstallPrompt />

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}

      {data && (
        <>
          {/* Tab content area */}
          <div className="tab-content-area">
            <div className={`tab-panel ${activeTab === "chat" ? "tab-panel-active" : "tab-panel-hidden"}`}>
              <ChatTab mood={chatMood} onMoodChange={handleMoodChange} />
            </div>
            {activeTab === "schedule" && (
              isTabLocked("schedule")
                ? <LockedFeatureOverlay featureName={TAB_DISPLAY_NAMES.schedule} onUpgradeClick={() => openUpgradeModal(TAB_DISPLAY_NAMES.schedule)} />
                : <ScheduleTab
                    scheduleKey={`schedule-${scheduleRevision}`}
                    focusDeadlineId={focusDeadlineId ?? undefined}
                    focusLectureId={focusLectureId ?? undefined}
                  />
            )}
            {activeTab === "nutrition" && (
              isTabLocked("nutrition")
                ? <LockedFeatureOverlay featureName={TAB_DISPLAY_NAMES.nutrition} onUpgradeClick={() => openUpgradeModal(TAB_DISPLAY_NAMES.nutrition)} />
                : <NutritionView />
            )}
            {activeTab === "habits" && (
              isTabLocked("habits")
                ? <LockedFeatureOverlay featureName={TAB_DISPLAY_NAMES.habits} onUpgradeClick={() => openUpgradeModal(TAB_DISPLAY_NAMES.habits)} />
                : <div className="habits-tab-container habits-analytics-stack">
                    <HabitsGoalsView />
                    <AnalyticsDashboard />
                  </div>
            )}
            {activeTab === "settings" && (
              <SettingsView
                onCalendarImported={() => setScheduleRevision((revision) => revision + 1)}
                planInfo={planInfo}
                onUpgrade={() => openUpgradeModal()}
                userEmail={authUserEmail}
                authRequired={authRequired}
                onSignOut={() => void handleLogout()}
                signingOut={authSubmitting}
                pushState={pushState}
                onEnablePush={() => void handleEnablePush()}
                pushMessage={pushMessage}
              />
            )}
          </div>

          {/* Bottom tab bar */}
          <TabBar activeTab={activeTab} onTabChange={handleTabChange} />
        </>
      )}

      {/* Upgrade modal */}
      {showUpgradeModal && (
        <UpgradePrompt feature={upgradeFeatureLabel} onDismiss={() => setShowUpgradeModal(false)} />
      )}
    </main>
  );
}
