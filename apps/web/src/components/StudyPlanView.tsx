import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  checkInStudyPlanSession,
  generateStudyPlan,
  getStudyPlanAdherence,
  getStudyPlanSessions
} from "../lib/api";
import { loadStudyPlanCache, loadStudyPlanCachedAt } from "../lib/storage";
import {
  StudyPlan,
  StudyPlanAdherenceMetrics,
  StudyPlanGeneratePayload,
  StudyPlanSession,
  StudyPlanSessionRecord,
  StudyPlanSessionStatus
} from "../types";

interface SessionDayGroup {
  key: string;
  label: string;
  sessions: StudyPlanSession[];
  totalMinutes: number;
  doneCount: number;
  skippedCount: number;
  pendingCount: number;
  completionRate: number;
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

function formatSessionStatus(status: StudyPlanSessionStatus): string {
  switch (status) {
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    default:
      return "Pending";
  }
}

function buildSessionLookup(sessions: StudyPlanSessionRecord[]): Record<string, StudyPlanSessionRecord> {
  const lookup: Record<string, StudyPlanSessionRecord> = {};
  sessions.forEach((session) => {
    lookup[session.id] = session;
  });
  return lookup;
}

export function StudyPlanView(): JSX.Element {
  const [plan, setPlan] = useState<StudyPlan | null>(() => loadStudyPlanCache());
  const [cachedAt, setCachedAt] = useState<string | null>(() => loadStudyPlanCachedAt());
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [sessionLookup, setSessionLookup] = useState<Record<string, StudyPlanSessionRecord>>({});
  const [adherence, setAdherence] = useState<StudyPlanAdherenceMetrics | null>(null);
  const [controls, setControls] = useState(defaultControls);
  const [loading, setLoading] = useState<boolean>(() => loadStudyPlanCache() === null);
  const [generating, setGenerating] = useState(false);
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState("");
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

  useEffect(() => {
    if (!plan) {
      setSessionLookup({});
      setAdherence(null);
      return;
    }

    let disposed = false;

    const syncSessionData = async (): Promise<void> => {
      const [sessions, adherenceMetrics] = await Promise.all([
        getStudyPlanSessions({
          windowStart: plan.windowStart,
          windowEnd: plan.windowEnd,
          limit: 500
        }),
        getStudyPlanAdherence({
          windowStart: plan.windowStart,
          windowEnd: plan.windowEnd
        })
      ]);

      if (disposed) {
        return;
      }

      setSessionLookup(buildSessionLookup(sessions));
      setAdherence(adherenceMetrics);
    };

    void syncSessionData();

    return () => {
      disposed = true;
    };
  }, [plan?.windowStart, plan?.windowEnd, plan?.generatedAt]);

  const resolveSessionStatus = (session: StudyPlanSession): StudyPlanSessionStatus => {
    return sessionLookup[session.id]?.status ?? "pending";
  };

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
      .map(([key, sessions]) => {
        const doneCount = sessions.filter((session) => resolveSessionStatus(session) === "done").length;
        const skippedCount = sessions.filter((session) => resolveSessionStatus(session) === "skipped").length;
        const pendingCount = sessions.filter((session) => resolveSessionStatus(session) === "pending").length;
        const completionRate = sessions.length === 0 ? 0 : Math.round((doneCount / sessions.length) * 100);

        return {
          key,
          label: formatDayLabel(sessions[0]?.startTime ?? key),
          sessions,
          totalMinutes: sessions.reduce((sum, session) => sum + session.durationMinutes, 0),
          doneCount,
          skippedCount,
          pendingCount,
          completionRate
        };
      });
  }, [plan, sessionLookup]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setGenerating(true);
    await loadPlan(controls);
  };

  const updateSessionStatus = async (
    session: StudyPlanSession,
    status: Exclude<StudyPlanSessionStatus, "pending">,
    options?: { silent?: boolean }
  ): Promise<boolean> => {
    if (!isOnline || !plan) {
      setSessionMessage("Reconnect to update session status.");
      return false;
    }

    setUpdatingSessionId(session.id);
    const updated = await checkInStudyPlanSession(session.id, status);

    if (!updated) {
      setSessionMessage("Could not save session status right now.");
      setUpdatingSessionId(null);
      return false;
    }

    setSessionLookup((prev) => ({
      ...prev,
      [updated.id]: updated
    }));

    const nextMetrics = await getStudyPlanAdherence({
      windowStart: plan.windowStart,
      windowEnd: plan.windowEnd
    });
    if (nextMetrics) {
      setAdherence(nextMetrics);
    }

    if (!options?.silent) {
      setSessionMessage(status === "done" ? "Session marked done." : "Session skipped.");
    }

    setUpdatingSessionId(null);
    return true;
  };

  const handleReschedule = async (session: StudyPlanSession): Promise<void> => {
    const skipped = await updateSessionStatus(session, "skipped", { silent: true });
    if (!skipped) {
      return;
    }

    setGenerating(true);
    await loadPlan(controls);
    setSessionMessage("Session skipped and plan regenerated.");
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
      {sessionMessage && <p className="study-plan-sync-status">{sessionMessage}</p>}

      {plan && (
        <>
          <p className="study-plan-summary">
            {plan.summary.totalSessions} sessions • {plan.summary.totalPlannedMinutes} minutes planned •{" "}
            {plan.summary.deadlinesCovered}/{plan.summary.deadlinesConsidered} deadlines covered
          </p>
          {adherence && (
            <section className="study-plan-adherence">
              <div className="study-plan-adherence-header">
                <h3>Weekly Adherence</h3>
                <span>{adherence.completionRate}% complete</span>
              </div>
              <div className="study-plan-adherence-bar" aria-hidden="true">
                <span
                  className="study-plan-adherence-fill"
                  style={{ width: `${Math.min(Math.max(adherence.completionRate, 0), 100)}%` }}
                />
              </div>
              <p className="study-plan-adherence-meta">
                {adherence.sessionsDone} done • {adherence.sessionsSkipped} skipped • {adherence.sessionsPending} pending
              </p>
            </section>
          )}

          {groupedSessions.length === 0 && <p className="study-plan-empty">No available study blocks in this horizon.</p>}

          {groupedSessions.map((group) => (
            <section key={group.key} className="study-plan-day">
              <header className="study-plan-day-header">
                <h3>{group.label}</h3>
                <span>
                  {group.sessions.length} session{group.sessions.length === 1 ? "" : "s"} • {group.totalMinutes} min
                </span>
              </header>
              <div className="study-plan-day-progress">
                <p>
                  {group.doneCount} done • {group.skippedCount} skipped • {group.pendingCount} pending
                </p>
                <div className="study-plan-day-progress-bar" aria-hidden="true">
                  <span
                    className="study-plan-day-progress-fill"
                    style={{ width: `${Math.min(Math.max(group.completionRate, 0), 100)}%` }}
                  />
                </div>
              </div>

              <ul className="study-plan-session-list">
                {group.sessions.map((session) => {
                  const status = resolveSessionStatus(session);
                  const checkedAt = sessionLookup[session.id]?.checkedAt;
                  const isUpdating = updatingSessionId === session.id;

                  return (
                    <li
                      key={session.id}
                      className={`study-plan-session priority-${session.priority} study-plan-session-${status}`}
                    >
                      <div className="study-plan-session-header">
                        <p className="study-plan-session-time">
                          {formatTime(session.startTime)} - {formatTime(session.endTime)}
                        </p>
                        <span className={`study-plan-session-status study-plan-session-status-${status}`}>
                          {formatSessionStatus(status)}
                        </span>
                      </div>
                      <p className="study-plan-session-title">{session.course}: {session.task}</p>
                      <p className="study-plan-session-rationale">{session.rationale}</p>
                      {checkedAt && (
                        <p className="study-plan-session-checked">
                          Updated {new Date(checkedAt).toLocaleString()}
                        </p>
                      )}
                      <div className="study-plan-session-actions">
                        <button
                          type="button"
                          className="study-plan-action-done"
                          onClick={() => void updateSessionStatus(session, "done")}
                          disabled={!isOnline || isUpdating || status === "done"}
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          className="study-plan-action-skip"
                          onClick={() => void updateSessionStatus(session, "skipped")}
                          disabled={!isOnline || isUpdating || status === "skipped"}
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          className="study-plan-action-reschedule"
                          onClick={() => void handleReschedule(session)}
                          disabled={!isOnline || isUpdating || status !== "pending" || generating}
                        >
                          Reschedule
                        </button>
                      </div>
                    </li>
                  );
                })}
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
