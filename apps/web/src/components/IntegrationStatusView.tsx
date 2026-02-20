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

type IntegrationId = "canvas" | "gemini" | "ical" | "github" | "youtube" | "gmail" | "twitter" | "twitch";

interface IntegrationDef {
  id: IntegrationId;
  name: string;
  description: string;
  icon: string;
  status: "connected" | "configured" | "not-configured" | "syncing";
  detail?: string;
  action?: { label: string; handler: () => void; disabled?: boolean };
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
    setCanvasMessage(result.success ? "Synced successfully" : result.error ?? "Sync failed");

    const nextStatus = await getCanvasStatus();
    setCanvasStatus(nextStatus);
    saveCanvasStatus(nextStatus);
    setCanvasSyncing(false);
    setTimeout(() => setCanvasMessage(""), 3000);
  };

  const integrations: IntegrationDef[] = [
    {
      id: "canvas",
      name: "Canvas LMS",
      description: "Courses, assignments, deadlines, grades",
      icon: "🎓",
      status: canvasSyncing ? "syncing" : canvasStatus.lastSyncedAt ? "connected" : "not-configured",
      detail: canvasStatus.lastSyncedAt
        ? `${canvasStatus.courses.length} courses · Synced ${formatRelative(canvasStatus.lastSyncedAt)}`
        : "Add CANVAS_API_TOKEN to connect",
      action: {
        label: canvasSyncing ? "Syncing…" : "Sync",
        handler: () => void handleCanvasSync(),
        disabled: canvasSyncing
      }
    },
    {
      id: "gemini",
      name: "Gemini AI",
      description: "Conversational AI, summaries, coaching",
      icon: "✨",
      status: geminiStatus.apiConfigured ? "connected" : "not-configured",
      detail: geminiStatus.apiConfigured
        ? `${geminiStatus.model} · Last used ${formatRelative(geminiStatus.lastRequestAt)}`
        : "Add GEMINI_API_KEY to connect"
    },
    {
      id: "ical",
      name: "TP EduCloud (iCal)",
      description: "Lecture schedule from UiS timetable",
      icon: "📅",
      status: "configured",
      detail: "DAT520, DAT560, DAT600 · Syncs weekly"
    },
    {
      id: "github",
      name: "GitHub Course Repos",
      description: "Lab assignments, deadlines from repos",
      icon: "🐙",
      status: "not-configured",
      detail: "Add COURSE_GITHUB_PAT to connect"
    },
    {
      id: "youtube",
      name: "YouTube",
      description: "Subscriptions, video summaries for digest",
      icon: "📺",
      status: "not-configured",
      detail: "Add YOUTUBE_API_KEY to connect"
    },
    {
      id: "gmail",
      name: "Gmail",
      description: "Inbox summary, email digest",
      icon: "📧",
      status: "not-configured",
      detail: "Add Gmail OAuth credentials to connect"
    },
    {
      id: "twitter",
      name: "X (Twitter)",
      description: "Timeline digest, trending in tech",
      icon: "𝕏",
      status: "not-configured",
      detail: "Add X_BEARER_TOKEN to connect"
    },
    {
      id: "twitch",
      name: "Twitch",
      description: "Live stream alerts for followed channels",
      icon: "🎮",
      status: "not-configured",
      detail: "Add Twitch client credentials to connect"
    }
  ];

  const statusBadge = (status: IntegrationDef["status"]): JSX.Element => {
    const classes: Record<IntegrationDef["status"], string> = {
      connected: "intg-badge intg-badge-connected",
      configured: "intg-badge intg-badge-configured",
      "not-configured": "intg-badge intg-badge-inactive",
      syncing: "intg-badge intg-badge-syncing"
    };
    const labels: Record<IntegrationDef["status"], string> = {
      connected: "Connected",
      configured: "Configured",
      "not-configured": "Not connected",
      syncing: "Syncing…"
    };
    return <span className={classes[status]}>{labels[status]}</span>;
  };

  return (
    <section className="intg-hub">
      {canvasMessage && <p className="intg-toast">{canvasMessage}</p>}

      <div className="intg-grid">
        {integrations.map((intg) => (
          <div key={intg.id} className={`intg-card ${intg.status === "not-configured" ? "intg-card-inactive" : ""}`}>
            <div className="intg-card-header">
              <span className="intg-card-icon">{intg.icon}</span>
              <div className="intg-card-title">
                <h4>{intg.name}</h4>
                {statusBadge(intg.status)}
              </div>
            </div>
            <p className="intg-card-desc">{intg.description}</p>
            <p className="intg-card-detail">{intg.detail}</p>
            {intg.action && (
              <button
                type="button"
                className="intg-card-action"
                onClick={intg.action.handler}
                disabled={intg.action.disabled}
              >
                {intg.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
