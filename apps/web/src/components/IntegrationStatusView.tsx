import { useEffect, useState } from "react";
import {
  getCanvasStatus,
  getGeminiStatus,
  triggerCanvasSync
} from "../lib/api";
import { saveCanvasStatus } from "../lib/storage";
import type {
  CanvasStatus,
  GeminiStatus
} from "../types";

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

export function IntegrationStatusView(): JSX.Element {
  const [canvasStatus, setCanvasStatus] = useState<CanvasStatus>({
    baseUrl: "",
    lastSyncedAt: null,
    courses: []
  });
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({
    apiConfigured: false,
    model: "unknown",
    rateLimitRemaining: null,
    rateLimitSource: "provider",
    lastRequestAt: null
  });
  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");

  useEffect(() => {
    const loadStatuses = async (): Promise<void> => {
      const [canvas, gemini] = await Promise.all([getCanvasStatus(), getGeminiStatus()]);
      setCanvasStatus(canvas);
      setGeminiStatus(gemini);
    };

    void loadStatuses();
  }, []);

  const handleCanvasSync = async (): Promise<void> => {
    setCanvasSyncing(true);
    setCanvasMessage("");

    const result = await triggerCanvasSync(undefined);
    setCanvasMessage(result.success ? "Canvas synced successfully." : result.error ?? "Canvas sync failed.");

    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);
  };

  const canvasStatusLabel = canvasSyncing
    ? "Syncing..."
    : canvasStatus.lastSyncedAt
      ? "Connected"
      : "Not synced yet";
  const canvasStatusClass = canvasSyncing
    ? "status-running"
    : canvasStatus.lastSyncedAt
      ? "status-running"
      : "status-idle";

  const geminiStatusLabel = geminiStatus.apiConfigured ? "Configured" : "Not configured";
  const geminiStatusClass = geminiStatus.apiConfigured ? "status-running" : "status-idle";
  const geminiRateLimitLabel =
    geminiStatus.rateLimitRemaining === null ? "Provider-managed" : String(geminiStatus.rateLimitRemaining);

  return (
    <section id="integration-status-panel" className="panel">
      <header className="panel-header">
        <h2>Integrations</h2>
      </header>

      <div className="settings-stack">
        <div className="panel">
          <header className="panel-header">
            <h3>Canvas LMS</h3>
            <span className={`status ${canvasStatusClass}`}>{canvasStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Last synced</p>
              <strong>{formatRelative(canvasStatus.lastSyncedAt)}</strong>
            </div>
            <button type="button" onClick={() => void handleCanvasSync()} disabled={canvasSyncing}>
              {canvasSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          {canvasMessage && <p>{canvasMessage}</p>}

          <div>
            <p className="muted">Synced courses: {canvasStatus.courses.length}</p>
          </div>
        </div>

        <div className="panel">
          <header className="panel-header">
            <h3>Gemini AI</h3>
            <span className={`status ${geminiStatusClass}`}>{geminiStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Model</p>
              <strong>{geminiStatus.model}</strong>
              {geminiStatus.growthImageModelResolved && (
                <p className="muted-small">
                  Growth image model: {geminiStatus.growthImageModel} ({geminiStatus.growthImageModelResolved})
                </p>
              )}
            </div>
          </div>

          <div className="panel-header">
            <div>
              <p className="muted">Last request</p>
              <strong>{formatRelative(geminiStatus.lastRequestAt)}</strong>
            </div>
            <div>
              <p className="muted">Rate limit</p>
              <strong>{geminiRateLimitLabel}</strong>
            </div>
          </div>

          {geminiStatus.error && <p className="error">{geminiStatus.error}</p>}
        </div>
      </div>
    </section>
  );
}
