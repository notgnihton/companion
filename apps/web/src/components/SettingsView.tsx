import { NotificationSettings } from "./NotificationSettings";
import { CalendarImportView } from "./CalendarImportView";
import { IntegrationScopeSettings } from "./IntegrationScopeSettings";
import { ConnectorsView } from "./ConnectorsView";
import type { UserPlanInfo } from "../types";

interface SettingsViewProps {
  onCalendarImported: () => void;
  planInfo: UserPlanInfo | null;
  onUpgrade: () => void;
  /** Currently signed-in user email (null if auth not required) */
  userEmail: string | null;
  /** Whether auth is required (shows account section) */
  authRequired: boolean;
  /** Sign out handler */
  onSignOut: () => void;
  /** Whether sign out is in progress */
  signingOut: boolean;
  /** Push notification state */
  pushState: "checking" | "enabled" | "idle" | "unsupported" | "ready" | "denied" | "error";
  /** Handler to enable push notifications */
  onEnablePush: () => void;
  /** Push status message */
  pushMessage: string;
}

export function SettingsView({
  onCalendarImported,
  planInfo,
  onUpgrade,
  userEmail,
  authRequired,
  onSignOut,
  signingOut,
  pushState,
  onEnablePush,
  pushMessage,
}: SettingsViewProps): JSX.Element {
  const pushButtonDisabled =
    pushState === "checking" || pushState === "enabled" || pushState === "unsupported" || pushState === "denied" || pushState === "error";

  return (
    <div className="settings-container">
      {/* Account section */}
      {authRequired && (
        <div className="settings-account-bar">
          <div className="settings-account-info">
            {userEmail && (
              <p className="settings-account-email">Signed in as <strong>{userEmail}</strong></p>
            )}
          </div>
          <button
            type="button"
            className="settings-sign-out-btn"
            onClick={onSignOut}
            disabled={signingOut}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}

      <div className="settings-header">
        <span className="settings-header-icon">⚙️</span>
        <h2>Settings</h2>
      </div>

      {/* Plan & Usage section */}
      {planInfo && (
        <div className="settings-section">
          <h3 className="settings-section-title">💎 Your Plan</h3>
          <div className="plan-info-card">
            <div className="plan-info-row">
              <span className={`plan-badge plan-badge-${planInfo.plan}`}>{planInfo.badge}</span>
              <span className="plan-info-name">{planInfo.planName}</span>
              {planInfo.isTrial && planInfo.trialEndsAt && (
                <span className="plan-trial-badge">
                  Trial · ends {new Date(planInfo.trialEndsAt).toLocaleDateString()}
                </span>
              )}
            </div>
            <div className="plan-usage-row">
              <span className="plan-usage-label">AI messages today</span>
              <span className="plan-usage-value">
                {planInfo.chatUsedToday} / {planInfo.chatLimitToday === 0 ? "∞" : planInfo.chatLimitToday}
              </span>
            </div>
            {planInfo.chatLimitToday > 0 && (
              <div className="plan-usage-bar-track">
                <div
                  className="plan-usage-bar-fill"
                  style={{ width: `${Math.min(100, (planInfo.chatUsedToday / planInfo.chatLimitToday) * 100)}%` }}
                />
              </div>
            )}
            {planInfo.plan === "free" && (
              <button className="plan-upgrade-btn" onClick={onUpgrade}>
                ✨ Upgrade plan
              </button>
            )}
          </div>
        </div>
      )}

      <div className="settings-section">
        <h3 className="settings-section-title">🔗 Integrations</h3>
        <ConnectorsView />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🎯 Data Scope</h3>
        <IntegrationScopeSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">🔔 Notifications</h3>

        {/* Push notification toggle */}
        <div className="settings-push-card">
          <div className="settings-push-row">
            <div className="settings-push-info">
              <span className="settings-push-label">Push Notifications</span>
              <span className="settings-push-desc">
                {pushState === "enabled"
                  ? "Receiving push notifications"
                  : pushState === "unsupported"
                    ? "Not supported in this browser"
                    : pushState === "denied"
                      ? "Permission denied — enable in browser settings"
                      : pushState === "error"
                        ? "Something went wrong — try again later"
                        : "Get notified about deadlines, reminders, and updates"}
              </span>
            </div>
            {pushState === "enabled" ? (
              <span className="settings-push-badge">✓ Enabled</span>
            ) : (
              <button
                type="button"
                className="settings-push-btn"
                onClick={onEnablePush}
                disabled={pushButtonDisabled}
              >
                {pushState === "checking" ? "Connecting…" : "Enable"}
              </button>
            )}
          </div>
          {pushMessage && <p className="settings-push-message">{pushMessage}</p>}
        </div>

        <NotificationSettings />
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">📅 Calendar Import</h3>
        <CalendarImportView onImported={onCalendarImported} />
      </div>
    </div>
  );
}
