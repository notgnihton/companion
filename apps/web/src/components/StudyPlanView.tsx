import { FormEvent, useEffect, useMemo, useState } from "react";
import { generateStudyPlan } from "../lib/api";
import { loadStudyPlanCache, loadStudyPlanCachedAt } from "../lib/storage";
import { StudyPlan, StudyPlanGeneratePayload, StudyPlanSession } from "../types";

interface SessionDayGroup {
  key: string;
  label: string;
  sessions: StudyPlanSession[];
  totalMinutes: number;
}

const defaultControls: Required<StudyPlanGeneratePayload> = {
  horizonDays: 7,
  minSessionMinutes: 45,
  maxSessionMinutes: 120
};
const STUDY_PLAN_STALE_MS = 24 * 60 * 60 * 1000;

function formatCachedLabel(cachedAt: string | null): string {
  if (!cachedAt) {
    return "No cached snapshot yet";
  }

  const timestamp = new Date(cachedAt);
  if (Number.isNaN(timestamp.getTime())) {
    return "Cached snapshot time unavailable";
  }

  return `Cached ${timestamp.toLocaleString()}`;
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDayLabel(value: string): string {
  return new Date(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function toDayKey(value: string): string {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function StudyPlanView(): JSX.Element {
  const [plan, setPlan] = useState<StudyPlan | null>(() => loadStudyPlanCache());
  const [cachedAt, setCachedAt] = useState<string | null>(() => loadStudyPlanCachedAt());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [controls, setControls] = useState(defaultControls);
  const [loading, setLoading] = useState<boolean>(() => loadStudyPlanCache() === null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const loadPlan = async (nextControls: Required<StudyPlanGeneratePayload>): Promise<void> => {
    setError("");

    try {
      const nextPlan = await generateStudyPlan(nextControls);
      setPlan(nextPlan);
      setCachedAt(loadStudyPlanCachedAt());
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Failed to generate study plan.";
      setError(message);
    } finally {
      setLoading(false);
      setGenerating(false);
    }
  };

  useEffect(() => {
    void loadPlan(defaultControls);
  }, []);

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const groupedSessions = useMemo<SessionDayGroup[]>(() => {
    if (!plan) {
      return [];
    }

    const groups = new Map<string, StudyPlanSession[]>();

    plan.sessions.forEach((session) => {
      const key = toDayKey(session.startTime);
      const existing = groups.get(key) ?? [];
      existing.push(session);
      groups.set(key, existing);
    });

    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, sessions]) => ({
        key,
        label: formatDayLabel(sessions[0]?.startTime ?? key),
        sessions,
        totalMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0)
      }));
  }, [plan]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setGenerating(true);
    await loadPlan(controls);
  };

  const cacheAgeMs = cachedAt ? Date.now() - new Date(cachedAt).getTime() : Number.POSITIVE_INFINITY;
  const isStale = Number.isFinite(cacheAgeMs) && cacheAgeMs > STUDY_PLAN_STALE_MS;

  return (
    <section className="panel study-plan-panel">
      <header className="panel-header">
        <h2>Study Plan</h2>
        <button type="submit" form="study-plan-controls" disabled={generating || !isOnline}>
          {generating ? "Regenerating..." : "Regenerate"}
        </button>
      </header>
      <div className="cache-status-row" role="status" aria-live="polite">
        <span className={`cache-status-chip ${isOnline ? "cache-status-chip-online" : "cache-status-chip-offline"}`}>
          {isOnline ? "Online" : "Offline"}
        </span>
        <span className="cache-status-chip">{formatCachedLabel(cachedAt)}</span>
        {isStale && <span className="cache-status-chip cache-status-chip-stale">Stale snapshot</span>}
      </div>

      <form id="study-plan-controls" className="study-plan-controls" onSubmit={(event) => void handleSubmit(event)}>
        <label>
          Horizon
          <select
            value={controls.horizonDays}
            onChange={(event) =>
              setControls((prev) => ({
                ...prev,
                horizonDays: Number(event.target.value)
              }))
            }
          >
            <option value={3}>3 days</option>
            <option value={5}>5 days</option>
            <option value={7}>7 days</option>
            <option value={10}>10 days</option>
            <option value={14}>14 days</option>
          </select>
        </label>

        <label>
          Min session
          <select
            value={controls.minSessionMinutes}
            onChange={(event) => {
              const minSessionMinutes = Number(event.target.value);
              setControls((prev) => ({
                ...prev,
                minSessionMinutes,
                maxSessionMinutes: Math.max(prev.maxSessionMinutes, minSessionMinutes)
              }));
            }}
          >
            <option value={30}>30 min</option>
            <option value={45}>45 min</option>
            <option value={60}>60 min</option>
            <option value={75}>75 min</option>
          </select>
        </label>

        <label>
          Max session
          <select
            value={controls.maxSessionMinutes}
            onChange={(event) => {
              const maxSessionMinutes = Number(event.target.value);
              setControls((prev) => ({
                ...prev,
                maxSessionMinutes: Math.max(maxSessionMinutes, prev.minSessionMinutes)
              }));
            }}
          >
            <option value={90}>90 min</option>
            <option value={120}>120 min</option>
            <option value={150}>150 min</option>
            <option value={180}>180 min</option>
          </select>
        </label>
      </form>

      {loading && <p className="study-plan-empty">Generating initial study plan...</p>}
      {error && <p className="study-plan-error">{error}</p>}

      {plan && (
        <>
          <p className="study-plan-summary">
            {plan.summary.totalSessions} sessions • {plan.summary.totalPlannedMinutes} minutes planned •{" "}
            {plan.summary.deadlinesCovered}/{plan.summary.deadlinesConsidered} deadlines covered
          </p>

          {groupedSessions.length === 0 && <p className="study-plan-empty">No available study blocks in this horizon.</p>}

          {groupedSessions.map((group) => (
            <section key={group.key} className="study-plan-day">
              <header className="study-plan-day-header">
                <h3>{group.label}</h3>
                <span>
                  {group.sessions.length} session{group.sessions.length === 1 ? "" : "s"} • {group.totalMinutes} min
                </span>
              </header>

              <ul className="study-plan-session-list">
                {group.sessions.map((session) => (
                  <li key={session.id} className={`study-plan-session priority-${session.priority}`}>
                    <p className="study-plan-session-time">
                      {formatTime(session.startTime)} - {formatTime(session.endTime)}
                    </p>
                    <p className="study-plan-session-title">{session.course}: {session.task}</p>
                    <p className="study-plan-session-rationale">{session.rationale}</p>
                  </li>
                ))}
              </ul>
            </section>
          ))}

          {plan.unallocated.length > 0 && (
            <section className="study-plan-unallocated">
              <h3>Needs Manual Scheduling</h3>
              <ul>
                {plan.unallocated.map((item) => (
                  <li key={item.deadlineId}>
                    <strong>{item.course}: {item.task}</strong> ({item.remainingMinutes} min left)
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </section>
  );
}
