import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  checkInStudyPlanSession,
  generateStudyPlan,
  getStudyPlanAdherence,
  getStudyPlanSessions
} from "../lib/api";

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

interface SessionCheckInDraft {
  sessionId: string;
  status: Exclude<StudyPlanSessionStatus, "pending">;
  energyLevel?: number;
  focusLevel?: number;
  checkInNote: string;
}

const CHECK_IN_SCALE_VALUES = [1, 2, 3, 4, 5] as const;

const defaultControls: Required<StudyPlanGeneratePayload> = {
  horizonDays: 7,
  minSessionMinutes: 45,
  maxSessionMinutes: 120
};

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatDayLabel(value: string): string {
  return new Date(value).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function formatHoursFromMinutes(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
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
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(() => navigator.onLine);
  const [sessionLookup, setSessionLookup] = useState<Record<string, StudyPlanSessionRecord>>({});
  const [adherence, setAdherence] = useState<StudyPlanAdherenceMetrics | null>(null);
  const [controls, setControls] = useState(defaultControls);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [updatingSessionId, setUpdatingSessionId] = useState<string | null>(null);
  const [activeCheckIn, setActiveCheckIn] = useState<SessionCheckInDraft | null>(null);
  const [sessionMessage, setSessionMessage] = useState("");
  const [error, setError] = useState("");

  const loadPlan = async (nextControls: Required<StudyPlanGeneratePayload>): Promise<void> => {
    setError("");

    try {
      const nextPlan = await generateStudyPlan(nextControls);
      setPlan(nextPlan);
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
    options?: {
      silent?: boolean;
      successMessage?: string;
      payload?: {
        energyLevel?: number;
        focusLevel?: number;
        checkInNote?: string;
      };
    }
  ): Promise<StudyPlanSessionRecord | null> => {
    if (!isOnline || !plan) {
      setSessionMessage("Reconnect to update session status.");
      return null;
    }

    setUpdatingSessionId(session.id);
    const updated = await checkInStudyPlanSession(session.id, status, options?.payload);

    if (!updated) {
      setSessionMessage("Could not save session status right now.");
      setUpdatingSessionId(null);
      return null;
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
      setSessionMessage(options?.successMessage ?? (status === "done" ? "Session marked done." : "Session skipped."));
    }

    setUpdatingSessionId(null);
    return updated;
  };

  const openCheckInPanel = (
    session: StudyPlanSession,
    status: Exclude<StudyPlanSessionStatus, "pending">,
    record?: StudyPlanSessionRecord
  ): void => {
    const source = record ?? sessionLookup[session.id];
    setActiveCheckIn({
      sessionId: session.id,
      status,
      energyLevel: source?.energyLevel ?? undefined,
      focusLevel: source?.focusLevel ?? undefined,
      checkInNote: source?.checkInNote ?? ""
    });
  };

  const handleStatusWithQuickCheckIn = async (
    session: StudyPlanSession,
    status: Exclude<StudyPlanSessionStatus, "pending">
  ): Promise<void> => {
    const updated = await updateSessionStatus(session, status, { silent: true });
    if (!updated) {
      return;
    }

    openCheckInPanel(session, status, updated);
    setSessionMessage(status === "done" ? "Session marked done. Optional check-in below." : "Session skipped. Optional check-in below.");
  };

  const saveActiveCheckIn = async (): Promise<void> => {
    if (!activeCheckIn || !plan) {
      return;
    }

    const session = plan.sessions.find((candidate) => candidate.id === activeCheckIn.sessionId);
    if (!session) {
      setActiveCheckIn(null);
      return;
    }

    const trimmedNote = activeCheckIn.checkInNote.trim();
    const updated = await updateSessionStatus(session, activeCheckIn.status, {
      payload: {
        energyLevel: activeCheckIn.energyLevel,
        focusLevel: activeCheckIn.focusLevel,
        checkInNote: trimmedNote.length > 0 ? trimmedNote : undefined
      },
      successMessage: "Session check-in saved."
    });

    if (updated) {
      setActiveCheckIn(null);
    }
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

  const unallocatedMinutes = plan ? plan.unallocated.reduce((sum, item) => sum + item.remainingMinutes, 0) : 0;
  const totalEstimatedMinutes = plan ? plan.summary.totalPlannedMinutes + unallocatedMinutes : 0;

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
        {loading && <span className="cache-status-chip">Loading...</span>}
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
          <p className="study-plan-workload-context">
            Estimated workload: ~{formatHoursFromMinutes(totalEstimatedMinutes)}h total •{" "}
            {unallocatedMinutes > 0
              ? `~${formatHoursFromMinutes(unallocatedMinutes)}h still unscheduled`
              : "all estimated work is scheduled"}
          </p>
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
                  const sessionRecord = sessionLookup[session.id];
                  const checkedAt = sessionRecord?.checkedAt;
                  const isUpdating = updatingSessionId === session.id;
                  const hasCheckInStats =
                    typeof sessionRecord?.energyLevel === "number" || typeof sessionRecord?.focusLevel === "number";
                  const showCheckInPanel = activeCheckIn?.sessionId === session.id;

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
                          Updated {new Date(checkedAt).toLocaleString(undefined, {
                            year: "numeric",
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                            hour12: false
                          })}
                        </p>
                      )}
                      {hasCheckInStats && (
                        <p className="study-plan-session-checkin-summary">
                          {sessionRecord?.energyLevel !== null ? `Energy ${sessionRecord?.energyLevel}/5` : "Energy -"} •{" "}
                          {sessionRecord?.focusLevel !== null ? `Focus ${sessionRecord?.focusLevel}/5` : "Focus -"}
                        </p>
                      )}
                      {sessionRecord?.checkInNote && <p className="study-plan-session-checkin-note">"{sessionRecord.checkInNote}"</p>}
                      <div className="study-plan-session-actions">
                        <button
                          type="button"
                          className="study-plan-action-done"
                          onClick={() => void handleStatusWithQuickCheckIn(session, "done")}
                          disabled={!isOnline || isUpdating || status === "done"}
                        >
                          Done
                        </button>
                        <button
                          type="button"
                          className="study-plan-action-skip"
                          onClick={() => void handleStatusWithQuickCheckIn(session, "skipped")}
                          disabled={!isOnline || isUpdating || status === "skipped"}
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          className="study-plan-action-checkin"
                          onClick={() => openCheckInPanel(session, status === "pending" ? "done" : status)}
                          disabled={!isOnline || isUpdating}
                        >
                          Check-in
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
                      {showCheckInPanel && activeCheckIn && (
                        <div className="study-plan-checkin-panel">
                          <div className="study-plan-checkin-header">
                            <strong>Post-session check-in</strong>
                            <button type="button" onClick={() => setActiveCheckIn(null)}>
                              Not now
                            </button>
                          </div>
                          <div className="study-plan-checkin-status-toggle">
                            <button
                              type="button"
                              className={activeCheckIn.status === "done" ? "is-active" : ""}
                              onClick={() =>
                                setActiveCheckIn((prev) => (prev ? { ...prev, status: "done" } : prev))
                              }
                            >
                              Done
                            </button>
                            <button
                              type="button"
                              className={activeCheckIn.status === "skipped" ? "is-active" : ""}
                              onClick={() =>
                                setActiveCheckIn((prev) => (prev ? { ...prev, status: "skipped" } : prev))
                              }
                            >
                              Skipped
                            </button>
                          </div>
                          <div className="study-plan-checkin-scale">
                            <p>Energy</p>
                            <div className="study-plan-checkin-scale-buttons">
                              {CHECK_IN_SCALE_VALUES.map((value) => (
                                <button
                                  key={`energy-${session.id}-${value}`}
                                  type="button"
                                  className={activeCheckIn.energyLevel === value ? "is-active" : ""}
                                  onClick={() =>
                                    setActiveCheckIn((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            energyLevel: prev.energyLevel === value ? undefined : value
                                          }
                                        : prev
                                    )
                                  }
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="study-plan-checkin-scale">
                            <p>Focus</p>
                            <div className="study-plan-checkin-scale-buttons">
                              {CHECK_IN_SCALE_VALUES.map((value) => (
                                <button
                                  key={`focus-${session.id}-${value}`}
                                  type="button"
                                  className={activeCheckIn.focusLevel === value ? "is-active" : ""}
                                  onClick={() =>
                                    setActiveCheckIn((prev) =>
                                      prev
                                        ? {
                                            ...prev,
                                            focusLevel: prev.focusLevel === value ? undefined : value
                                          }
                                        : prev
                                    )
                                  }
                                >
                                  {value}
                                </button>
                              ))}
                            </div>
                          </div>
                          <label className="study-plan-checkin-note-field">
                            <span>Note (optional)</span>
                            <textarea
                              value={activeCheckIn.checkInNote}
                              onChange={(event) =>
                                setActiveCheckIn((prev) =>
                                  prev ? { ...prev, checkInNote: event.target.value } : prev
                                )
                              }
                              rows={2}
                              maxLength={500}
                              placeholder="What helped? What got in the way?"
                            />
                          </label>
                          <button
                            type="button"
                            className="study-plan-checkin-save"
                            onClick={() => void saveActiveCheckIn()}
                            disabled={!isOnline || isUpdating}
                          >
                            Save check-in
                          </button>
                        </div>
                      )}
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
                    <strong>{item.course}: {item.task}</strong> ({item.remainingMinutes} min left • ~{formatHoursFromMinutes(item.remainingMinutes)}h)
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
