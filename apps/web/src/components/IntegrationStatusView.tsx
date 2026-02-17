import { useEffect, useState } from "react";
import {
  getCanvasStatus,
  getGeminiStatus,
  getTPStatus,
  triggerCanvasSync,
  triggerTPSync
} from "../lib/api";
import { loadCanvasSettings, saveCanvasStatus } from "../lib/storage";
import type { CanvasStatus, TPStatus, GeminiStatus } from "../types";

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
  const [tpStatus, setTPStatus] = useState<TPStatus>({
    lastSyncedAt: null,
    eventsCount: 0,
    isSyncing: false
  });
  const [geminiStatus, setGeminiStatus] = useState<GeminiStatus>({
    apiConfigured: false,
    model: "unknown",
    rateLimitRemaining: 0,
    lastRequestAt: null
  });

  const [canvasSyncing, setCanvasSyncing] = useState(false);
  const [tpSyncing, setTPSyncing] = useState(false);
  const [canvasMessage, setCanvasMessage] = useState("");
  const [tpMessage, setTPMessage] = useState("");

  useEffect(() => {
    const loadStatuses = async (): Promise<void> => {
      const [canvas, tp, gemini] = await Promise.all([
        getCanvasStatus(),
        getTPStatus(),
        getGeminiStatus()
      ]);
      setCanvasStatus(canvas);
      setTPStatus(tp);
      setGeminiStatus(gemini);
    };

    void loadStatuses();
  }, []);

  const handleCanvasSync = async (): Promise<void> => {
    setCanvasSyncing(true);
    setCanvasMessage("");

    const settings = loadCanvasSettings();
    const result = await triggerCanvasSync(settings);
    setCanvasMessage(result.success ? "Canvas synced successfully." : result.error ?? "Canvas sync failed.");

    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);
  };

  const handleTPSync = async (): Promise<void> => {
    setTPSyncing(true);
    setTPMessage("");

    const result = await triggerTPSync();
    setTPMessage(result.success ? "TP schedule synced successfully." : result.error ?? "TP sync failed.");

    const nextStatus = await getTPStatus();
    setTPStatus(nextStatus);
    setTPSyncing(false);
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

  const tpStatusLabel = tpSyncing || tpStatus.isSyncing
    ? "Syncing..." 
    : tpStatus.lastSyncedAt 
      ? "Connected" 
      : "Not synced yet";
  const tpStatusClass = tpSyncing || tpStatus.isSyncing
    ? "status-running" 
    : tpStatus.lastSyncedAt 
      ? "status-running" 
      : "status-idle";

  const geminiStatusLabel = geminiStatus.apiConfigured ? "Configured" : "Not configured";
  const geminiStatusClass = geminiStatus.apiConfigured ? "status-running" : "status-idle";

  return (
    <section className="panel">
      <header className="panel-header">
        <h2>Integrations</h2>
      </header>

      <div className="settings-stack">
        {/* Canvas LMS */}
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
            <button 
              type="button" 
              onClick={() => void handleCanvasSync()} 
              disabled={canvasSyncing}
            >
              {canvasSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          {canvasMessage && <p>{canvasMessage}</p>}

          <div>
            <p className="muted">Synced courses: {canvasStatus.courses.length}</p>
          </div>
        </div>

        {/* TP EduCloud */}
        <div className="panel">
          <header className="panel-header">
            <h3>TP EduCloud Schedule</h3>
            <span className={`status ${tpStatusClass}`}>{tpStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Last synced</p>
              <strong>{formatRelative(tpStatus.lastSyncedAt)}</strong>
            </div>
            <button 
              type="button" 
              onClick={() => void handleTPSync()} 
              disabled={tpSyncing || tpStatus.isSyncing}
            >
              {tpSyncing || tpStatus.isSyncing ? "Syncing..." : "Sync now"}
            </button>
          </div>

          {tpMessage && <p>{tpMessage}</p>}

          {tpStatus.error && (
            <p className="error">{tpStatus.error}</p>
          )}

          <div>
            <p className="muted">Schedule events: {tpStatus.eventsCount}</p>
          </div>
        </div>

        {/* Gemini AI */}
        <div className="panel">
          <header className="panel-header">
            <h3>Gemini AI</h3>
            <span className={`status ${geminiStatusClass}`}>{geminiStatusLabel}</span>
          </header>

          <div className="panel-header">
            <div>
              <p className="muted">Model</p>
              <strong>{geminiStatus.model}</strong>
            </div>
          </div>

          <div className="panel-header">
            <div>
              <p className="muted">Last request</p>
              <strong>{formatRelative(geminiStatus.lastRequestAt)}</strong>
            </div>
            <div>
              <p className="muted">Rate limit remaining</p>
              <strong>{geminiStatus.rateLimitRemaining}</strong>
            </div>
          </div>

          {geminiStatus.error && (
            <p className="error">{geminiStatus.error}</p>
          )}
        </div>
      </div>
    </section>
  );
}
