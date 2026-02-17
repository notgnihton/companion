import { describe, expect, it } from "vitest";
import { buildStableStudyPlanEventUid, buildStudyPlanCalendarIcs } from "./study-plan-export.js";
import type { StudyPlan } from "./types.js";

function makePlan(): StudyPlan {
  return {
    generatedAt: "2026-02-17T10:00:00.000Z",
    windowStart: "2026-02-17T10:00:00.000Z",
    windowEnd: "2026-02-24T10:00:00.000Z",
    summary: {
      horizonDays: 7,
      deadlinesConsidered: 1,
      deadlinesCovered: 1,
      totalSessions: 1,
      totalPlannedMinutes: 90
    },
    sessions: [
      {
        id: "study-session-1",
        deadlineId: "deadline-abc-1",
        course: "DAT560",
        task: "Assignment 3",
        priority: "high",
        startTime: "2026-02-18T11:00:00.000Z",
        endTime: "2026-02-18T12:30:00.000Z",
        durationMinutes: 90,
        score: 640,
        rationale: "Due soon (32h). This block is prioritized."
      }
    ],
    unallocated: []
  };
}

describe("study-plan-export", () => {
  it("builds deterministic and stable event UID", () => {
    const session = makePlan().sessions[0]!;

    const first = buildStableStudyPlanEventUid(session);
    const second = buildStableStudyPlanEventUid(session);

    expect(first).toBe(second);
    expect(first).toContain("study-plan-deadline-abc-1-20260218T110000Z-90");
  });

  it("generates valid ICS output for study plan sessions", () => {
    const plan = makePlan();
    const ics = buildStudyPlanCalendarIcs(plan);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("SUMMARY:DAT560 Study: Assignment 3");
    expect(ics).toContain("DTSTART:20260218T110000Z");
    expect(ics).toContain("DTEND:20260218T123000Z");
    expect(ics).toContain("UID:study-plan-deadline-abc-1-20260218T110000Z-90@companion.local");
  });
});
