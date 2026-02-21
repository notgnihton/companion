import { beforeEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";
import type { StudyPlanSession } from "./types.js";

function makeSession(overrides: Partial<StudyPlanSession>): StudyPlanSession {
  return {
    id: overrides.id ?? "study-session-deadline-1-20260217100000",
    deadlineId: overrides.deadlineId ?? "deadline-1",
    course: overrides.course ?? "DAT560",
    task: overrides.task ?? "Assignment 3",
    priority: overrides.priority ?? "high",
    startTime: overrides.startTime ?? "2026-02-17T10:00:00.000Z",
    endTime: overrides.endTime ?? "2026-02-17T11:30:00.000Z",
    durationMinutes: overrides.durationMinutes ?? 90,
    score: overrides.score ?? 640,
    rationale: overrides.rationale ?? "Due soon."
  };
}

describe("RuntimeStore - study plan session check-ins", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("stores generated study-plan sessions with pending status by default", () => {
    const generatedAt = "2026-02-17T08:00:00.000Z";
    const windowStart = "2026-02-17T00:00:00.000Z";
    const windowEnd = "2026-02-24T00:00:00.000Z";
    const session = makeSession({});

    store.upsertStudyPlanSessions(userId, [session], generatedAt, { windowStart, windowEnd });

    const stored = store.getStudyPlanSessions(userId);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: session.id,
      generatedAt,
      status: "pending",
      checkedAt: null,
      energyLevel: null,
      focusLevel: null,
      checkInNote: null
    });
  });

  it("updates session status and preserves checkedAt timestamps", () => {
    const generatedAt = "2026-02-17T08:00:00.000Z";
    const session = makeSession({});
    store.upsertStudyPlanSessions(userId, [session], generatedAt, {
      windowStart: "2026-02-17T00:00:00.000Z",
      windowEnd: "2026-02-24T00:00:00.000Z"
    });

    const doneAt = "2026-02-17T12:00:00.000Z";
    const done = store.setStudyPlanSessionStatus(userId, session.id, "done", doneAt, {
      energyLevel: 4,
      focusLevel: 5,
      checkInNote: "Strong focus once I started."
    });
    expect(done).not.toBeNull();
    expect(done?.status).toBe("done");
    expect(done?.checkedAt).toBe(doneAt);
    expect(done?.energyLevel).toBe(4);
    expect(done?.focusLevel).toBe(5);
    expect(done?.checkInNote).toBe("Strong focus once I started.");

    const skippedAt = "2026-02-17T12:10:00.000Z";
    const skipped = store.setStudyPlanSessionStatus(userId, session.id, "skipped", skippedAt);
    expect(skipped).not.toBeNull();
    expect(skipped?.status).toBe("skipped");
    expect(skipped?.checkedAt).toBe(skippedAt);
    expect(skipped?.energyLevel).toBe(4);
    expect(skipped?.focusLevel).toBe(5);
    expect(skipped?.checkInNote).toBe("Strong focus once I started.");

    const missing = store.setStudyPlanSessionStatus(userId, "missing-session-id", "done", doneAt);
    expect(missing).toBeNull();
  });

  it("keeps completed sessions when replacing pending sessions in a planning window", () => {
    const generatedAt = "2026-02-17T08:00:00.000Z";
    const windowStart = "2026-02-17T00:00:00.000Z";
    const windowEnd = "2026-02-24T00:00:00.000Z";

    const first = makeSession({
      id: "study-session-deadline-1-20260217100000",
      startTime: "2026-02-17T10:00:00.000Z",
      endTime: "2026-02-17T11:00:00.000Z",
      durationMinutes: 60
    });
    const second = makeSession({
      id: "study-session-deadline-2-20260217130000",
      deadlineId: "deadline-2",
      startTime: "2026-02-17T13:00:00.000Z",
      endTime: "2026-02-17T14:00:00.000Z",
      durationMinutes: 60
    });

    store.upsertStudyPlanSessions(userId, [first, second], generatedAt, { windowStart, windowEnd });
    store.setStudyPlanSessionStatus(userId, first.id, "done", "2026-02-17T11:05:00.000Z");

    const replacement = makeSession({
      id: second.id,
      deadlineId: second.deadlineId,
      startTime: second.startTime,
      endTime: second.endTime,
      durationMinutes: second.durationMinutes,
      rationale: "Updated rationale"
    });

    store.upsertStudyPlanSessions(userId, [replacement], "2026-02-17T09:00:00.000Z", { windowStart, windowEnd });

    const sessions = store.getStudyPlanSessions(userId, { windowStart, windowEnd });
    expect(sessions).toHaveLength(2);
    expect(sessions.find((session) => session.id === first.id)?.status).toBe("done");
    expect(sessions.find((session) => session.id === replacement.id)?.status).toBe("pending");
  });

  it("calculates weekly adherence metrics from planned sessions", () => {
    const generatedAt = "2026-02-17T08:00:00.000Z";
    const windowStart = "2026-02-17T00:00:00.000Z";
    const windowEnd = "2026-02-24T00:00:00.000Z";

    const sessions = [
      makeSession({
        id: "study-session-a",
        startTime: "2026-02-17T10:00:00.000Z",
        endTime: "2026-02-17T11:30:00.000Z",
        durationMinutes: 90
      }),
      makeSession({
        id: "study-session-b",
        deadlineId: "deadline-2",
        startTime: "2026-02-18T10:00:00.000Z",
        endTime: "2026-02-18T11:00:00.000Z",
        durationMinutes: 60
      }),
      makeSession({
        id: "study-session-c",
        deadlineId: "deadline-3",
        startTime: "2026-02-19T10:00:00.000Z",
        endTime: "2026-02-19T10:45:00.000Z",
        durationMinutes: 45
      })
    ];

    store.upsertStudyPlanSessions(userId, sessions, generatedAt, { windowStart, windowEnd });
    store.setStudyPlanSessionStatus(userId, "study-session-a", "done", "2026-02-17T11:40:00.000Z", {
      energyLevel: 4,
      focusLevel: 3,
      checkInNote: "Good progress."
    });
    store.setStudyPlanSessionStatus(userId, "study-session-b", "skipped", "2026-02-18T09:55:00.000Z", {
      energyLevel: 2,
      focusLevel: 1,
      checkInNote: "Too tired after lectures."
    });

    const metrics = store.getStudyPlanAdherenceMetrics(userId, { windowStart, windowEnd });

    expect(metrics.sessionsPlanned).toBe(3);
    expect(metrics.sessionsDone).toBe(1);
    expect(metrics.sessionsSkipped).toBe(1);
    expect(metrics.sessionsPending).toBe(1);
    expect(metrics.totalPlannedMinutes).toBe(195);
    expect(metrics.completedMinutes).toBe(90);
    expect(metrics.skippedMinutes).toBe(60);
    expect(metrics.pendingMinutes).toBe(45);
    expect(metrics.completionRate).toBe(33);
    expect(metrics.adherenceRate).toBe(50);
    expect(metrics.checkInTrends.sessionsChecked).toBe(2);
    expect(metrics.checkInTrends.sessionsWithEnergy).toBe(2);
    expect(metrics.checkInTrends.sessionsWithFocus).toBe(2);
    expect(metrics.checkInTrends.sessionsWithNotes).toBe(2);
    expect(metrics.checkInTrends.averageEnergy).toBe(3);
    expect(metrics.checkInTrends.averageFocus).toBe(2);
    expect(metrics.checkInTrends.lowEnergyCount).toBe(1);
    expect(metrics.checkInTrends.highEnergyCount).toBe(1);
    expect(metrics.checkInTrends.lowFocusCount).toBe(1);
    expect(metrics.checkInTrends.highFocusCount).toBe(0);
    expect(metrics.checkInTrends.recentNotes).toHaveLength(2);
    expect(metrics.checkInTrends.recentNotes[0]?.sessionId).toBe("study-session-b");
    expect(metrics.checkInTrends.recentNotes[1]?.sessionId).toBe("study-session-a");
  });
});
