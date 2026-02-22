import { useCallback, useEffect, useState } from "react";
import { ConnectorService, UserConnection, CanvasStatus, GeminiStatus } from "../types";
import {
  connectService,
  disconnectService,
  getCanvasStatus,
  getConnectors,
  getGeminiStatus,
  triggerCanvasSync
} from "../lib/api";
import { saveCanvasStatus } from "../lib/storage";

interface ConnectorMeta {
  service: ConnectorService;
  label: string;
  icon: string;
  description: string;
  type: "token" | "oauth" | "config" | "url";
  placeholder?: string;
  configFields?: { key: string; label: string; placeholder: string }[];
}

/** Gemini is server-configured, not a user connector — shown as a status-only card. */
interface GeminiCard {
  service: "gemini";
  label: string;
  icon: string;
  description: string;
}

const CONNECTORS: ConnectorMeta[] = [
  {
    service: "canvas",
    label: "Canvas LMS",
    icon: "🎓",
    description: "Courses, assignments, deadlines, and grades from your Canvas instance.",
    type: "token",
    placeholder: "Paste your Canvas access token"
  },
  {
    service: "gmail",
    label: "Gmail",
    icon: "📧",
    description: "Inbox summaries and email digests for the AI context.",
    type: "oauth"
  },
  {
    service: "github_course",
    label: "GitHub (Course Orgs)",
    icon: "🐙",
    description: "Lab assignments and repos from course organizations.",
    type: "token",
    placeholder: "Paste your GitHub personal access token"
  },
  {
    service: "withings",
    label: "Withings Health",
    icon: "💪",
    description: "Sleep, weight, and health data from Withings devices.",
    type: "oauth"
  },
  {
    service: "tp_schedule",
    label: "TP EduCloud Schedule",
    icon: "📅",
    description: "Lecture schedule via iCal subscription from TP.",
    type: "url",
    placeholder: "Paste your TP iCal URL here"
  }
];

const GEMINI_CARD: GeminiCard = {
  service: "gemini",
  label: "Gemini AI",
  icon: "✨",
  description: "Conversational AI, summaries, coaching"
};

function formatRelative(timestamp: string | null): string {
  if (!timestamp) return "Never";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  return `${diffDay}d ago`;
}

export function ConnectorsView(): JSX.Element {
  const [connections, setConnections] = useState<UserConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedService, setExpandedService] = useState<ConnectorService | null>(null);
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<ConnectorService | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live integration status
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({ baseUrl: "", lastSyncedAt: null, courses: [] });
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({
    apiConfigured: false, model: "unknown", rateLimitRemaining: null, lastRequestAt: null
  });
  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");

  const fetchConnections = useCallback(async () => {
    try {
      const data = await getConnectors();
      setConnections(data);
    } catch {
      // Silently fail — user may not have any connections yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchConnections();
    // Also load integration statuses
    void (async () => {
      try {
        const [canvas, gemini] = await Promise.all([getCanvasStatus(), getGeminiStatus()]);
        setCanvasStatus(canvas);
        setGeminiStatus(gemini);
      } catch { /* ignore */ }
    })();
  }, [fetchConnections]);

  const handleCanvasSync = async (): Promise<void> => {
    setCanvasSyncing(true);
    setCanvasMessage("");
    const result = await triggerCanvasSync(undefined);
    setCanvasMessage(result.success ? "Synced successfully" : result.error ?? "Sync failed");
    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);
    setTimeout(() => setCanvasMessage(""), 3000);
  };

  /** Get live status detail text for a connector service. */
  const getStatusDetail = (service: ConnectorService): string | null => {
    if (service === "canvas" && canvasStatus.lastSyncedAt) {
      return `${canvasStatus.courses.length} courses · Synced ${formatRelative(canvasStatus.lastSyncedAt)}`;
    }
    return null;
  };

  const isConnected = (service: ConnectorService): boolean =>
    connections.some((c) => c.service === service);

  const getConnection = (service: ConnectorService): UserConnection | undefined =>
    connections.find((c) => c.service === service);

  const handleToggleExpand = (service: ConnectorService): void => {
    if (isConnected(service)) return; // Don't expand if already connected
    setExpandedService((prev) => (prev === service ? null : service));
    setError(null);
  };

  const handleInputChange = (key: string, value: string): void => {
    setInputValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleConnect = async (connector: ConnectorMeta): Promise<void> => {
    setSubmitting(connector.service);
    setError(null);

    try {
      if (connector.type === "oauth") {
        // For OAuth connectors, redirect to the connect endpoint to get the OAuth URL
        const result = await connectService(connector.service, {});
        if (result.redirectUrl) {
          window.location.href = result.redirectUrl;
          return;
        }
      } else if (connector.type === "token") {
        const token = inputValues[connector.service]?.trim();
        if (!token) {
          setError("Please enter a token");
          setSubmitting(null);
          return;
        }
        await connectService(connector.service, { token });
      } else if (connector.type === "config") {
        const body: Record<string, string> = {};
        for (const field of connector.configFields ?? []) {
          const val = inputValues[`${connector.service}_${field.key}`]?.trim();
          if (!val) {
            setError(`Please fill in ${field.label}`);
            setSubmitting(null);
            return;
          }
          body[field.key] = val;
        }
        await connectService(connector.service, body);
      } else if (connector.type === "url") {
        const url = inputValues[connector.service]?.trim();
        if (!url || !url.startsWith("http")) {
          setError("Please enter a valid URL");
          setSubmitting(null);
          return;
        }
        await connectService(connector.service, { icalUrl: url });
      }

      // Refresh connections list
      await fetchConnections();
      setExpandedService(null);
      setInputValues({});
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Connection failed";
      try {
        const parsed = JSON.parse(msg) as { error?: string };
        setError(parsed.error ?? msg);
      } catch {
        setError(msg);
      }
    } finally {
      setSubmitting(null);
    }
  };

  const handleDisconnect = async (service: ConnectorService): Promise<void> => {
    setSubmitting(service);
    setError(null);

    try {
      await disconnectService(service);
      await fetchConnections();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Disconnect failed");
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div className="connectors-loading">
        <div className="skeleton-text skeleton-text-lg" />
        <div className="skeleton-text skeleton-text-lg" />
        <div className="skeleton-text skeleton-text-lg" />
      </div>
    );
  }

  return (
    <div className="connectors-list">
      {/* Gemini AI — server-configured status card */}
      <div className={`connector-card ${geminiStatus.apiConfigured ? "connector-connected" : ""}`}>
        <div className="connector-header">
          <span className="connector-icon">{GEMINI_CARD.icon}</span>
          <div className="connector-info">
            <span className="connector-label">{GEMINI_CARD.label}</span>
            {geminiStatus.apiConfigured ? (
              <span className="connector-display-label">
                {geminiStatus.model} · Last used {formatRelative(geminiStatus.lastRequestAt)}
              </span>
            ) : (
              <span className="connector-desc">{GEMINI_CARD.description}</span>
            )}
          </div>
          <div className="connector-status">
            {geminiStatus.apiConfigured ? (
              <span className="connector-badge connector-badge-connected">Connected</span>
            ) : (
              <span className="connector-badge connector-badge-disconnected">Not configured</span>
            )}
          </div>
        </div>
      </div>

      {/* User-connectable services */}
      {CONNECTORS.map((connector) => {
        const connected = isConnected(connector.service);
        const connection = getConnection(connector.service);
        const expanded = expandedService === connector.service && !connected;
        const busy = submitting === connector.service;
        const statusDetail = connected ? getStatusDetail(connector.service) : null;

        return (
          <div
            key={connector.service}
            className={`connector-card ${connected ? "connector-connected" : ""} ${expanded ? "connector-expanded" : ""}`}
          >
            <div
              className="connector-header"
              onClick={() => handleToggleExpand(connector.service)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && handleToggleExpand(connector.service)}
            >
              <span className="connector-icon">{connector.icon}</span>
              <div className="connector-info">
                <span className="connector-label">{connector.label}</span>
                {connected && statusDetail && (
                  <span className="connector-display-label">{statusDetail}</span>
                )}
                {connected && !statusDetail && connection?.displayLabel && (
                  <span className="connector-display-label">{connection.displayLabel}</span>
                )}
                {!connected && (
                  <span className="connector-desc">{connector.description}</span>
                )}
              </div>
              <div className="connector-status">
                {connected ? (
                  <span className="connector-badge connector-badge-connected">Connected</span>
                ) : (
                  <span className="connector-badge connector-badge-disconnected">Not connected</span>
                )}
              </div>
            </div>

            {connected && (
              <div className="connector-actions">
                <span className="connector-connected-since">
                  Connected {new Date(connection!.connectedAt).toLocaleDateString()}
                </span>
                {connector.service === "canvas" && (
                  <button
                    className="connector-sync-btn"
                    onClick={() => void handleCanvasSync()}
                    disabled={canvasSyncing}
                  >
                    {canvasSyncing ? "Syncing…" : "Sync"}
                  </button>
                )}
                <button
                  className="connector-disconnect-btn"
                  onClick={() => void handleDisconnect(connector.service)}
                  disabled={busy}
                >
                  {busy ? "Disconnecting..." : "Disconnect"}
                </button>
              </div>
            )}
            {connected && canvasMessage && connector.service === "canvas" && (
              <p className="connector-sync-message">{canvasMessage}</p>
            )}

            {expanded && (
              <div className="connector-setup">
                {connector.type === "token" && (
                  <div className="connector-token-input">
                    <input
                      type="password"
                      placeholder={connector.placeholder}
                      value={inputValues[connector.service] ?? ""}
                      onChange={(e) => handleInputChange(connector.service, e.target.value)}
                      disabled={busy}
                    />
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy || !inputValues[connector.service]?.trim()}
                    >
                      {busy ? "Connecting..." : "Connect"}
                    </button>
                  </div>
                )}

                {connector.type === "oauth" && (
                  <div className="connector-oauth-setup">
                    <p className="connector-oauth-hint">
                      You&apos;ll be redirected to {connector.label} to authorize access.
                    </p>
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy}
                    >
                      {busy ? "Redirecting..." : `Connect ${connector.label}`}
                    </button>
                  </div>
                )}

                {connector.type === "config" && connector.configFields && (
                  <div className="connector-config-fields">
                    {connector.configFields.map((field) => (
                      <div key={field.key} className="connector-config-field">
                        <label>{field.label}</label>
                        <input
                          type="text"
                          placeholder={field.placeholder}
                          value={inputValues[`${connector.service}_${field.key}`] ?? ""}
                          onChange={(e) =>
                            handleInputChange(`${connector.service}_${field.key}`, e.target.value)
                          }
                          disabled={busy}
                        />
                      </div>
                    ))}
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy}
                    >
                      {busy ? "Saving..." : "Save & Connect"}
                    </button>
                  </div>
                )}

                {connector.type === "url" && (
                  <div className="connector-url-input">
                    <input
                      type="url"
                      placeholder={connector.placeholder}
                      value={inputValues[connector.service] ?? ""}
                      onChange={(e) => handleInputChange(connector.service, e.target.value)}
                      disabled={busy}
                    />
                    <button
                      className="connector-connect-btn"
                      onClick={() => void handleConnect(connector)}
                      disabled={busy || !inputValues[connector.service]?.trim()}
                    >
                      {busy ? "Saving..." : "Save"}
                    </button>
                  </div>
                )}

                {error && expandedService === connector.service && (
                  <p className="connector-error">{error}</p>
                )}

                {connector.service === "canvas" && (
                  <p className="connector-help-text">
                    Go to <strong>Canvas</strong> → click your profile picture → <strong>Settings</strong> → scroll to <strong>Approved Integrations</strong> → <strong>+ New Access Token</strong>. Give it a name and copy the token.
                  </p>
                )}
                {connector.service === "github_course" && (
                  <p className="connector-help-text">
                    Go to <strong>GitHub</strong> → <strong>Settings</strong> → <strong>Developer settings</strong> → <strong>Personal access tokens</strong> → <strong>Fine-grained tokens</strong>. Select the course organizations and grant read access to repositories.
                  </p>
                )}
                {connector.service === "tp_schedule" && (
                  <p className="connector-help-text">
                    Go to <strong>tp.educloud.no</strong> → find your courses → click <strong>Verktøy</strong> → <strong>Kopier abonnementlenken til timeplanen</strong>. Paste the iCal URL here (starts with https://tp.educloud.no/...).
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
