import { describe, expect, it } from "vitest";
import { generateWeeklyStudyPlan } from "./study-plan.js";
import { Deadline, LectureEvent } from "./types.js";

function makeDeadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: overrides.id ?? "deadline-1",
    course: overrides.course ?? "DAT560",
    task: overrides.task ?? "Assignment",
    dueDate: overrides.dueDate ?? "2026-02-20T23:59:00.000Z",
    priority: overrides.priority ?? "medium",
    completed: overrides.completed ?? false,
    canvasAssignmentId: overrides.canvasAssignmentId,
    effortHoursRemaining: overrides.effortHoursRemaining,
    effortConfidence: overrides.effortConfidence
  };
}

function makeLecture(overrides: Partial<LectureEvent>): LectureEvent {
  return {
    id: overrides.id ?? "lecture-1",
    title: overrides.title ?? "Lecture",
    startTime: overrides.startTime ?? "2026-02-17T09:00:00.000Z",
    durationMinutes: overrides.durationMinutes ?? 90,
    workload: overrides.workload ?? "medium",
    recurrence: overrides.recurrence,
    recurrenceParentId: overrides.recurrenceParentId
  };
}

describe("generateWeeklyStudyPlan", () => {
  it("prioritizes urgent and high-priority deadlines first", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");
    const deadlines: Deadline[] = [
      makeDeadline({
        id: "urgent-high",
        task: "Urgent assignment",
        priority: "high",
        dueDate: "2026-02-18T12:00:00.000Z"
      }),
      makeDeadline({
        id: "later-medium",
        task: "Later assignment",
        priority: "medium",
        dueDate: "2026-02-22T20:00:00.000Z"
      })
    ];

    const plan = generateWeeklyStudyPlan(deadlines, [], { now, horizonDays: 7 });

    expect(plan.sessions.length).toBeGreaterThan(0);
    expect(plan.sessions[0]?.deadlineId).toBe("urgent-high");
  });

  it("respects schedule gaps for generated sessions", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");
    const deadlines: Deadline[] = [
      makeDeadline({
        id: "dat520-lab",
        course: "DAT520",
        task: "Assignment 1",
        priority: "high",
        dueDate: "2026-02-18T18:00:00.000Z"
      })
    ];
    const schedule: LectureEvent[] = [
      makeLecture({
        id: "morning-lecture",
        startTime: "2026-02-17T09:00:00.000Z",
        durationMinutes: 120
      }),
      makeLecture({
        id: "afternoon-lecture",
        startTime: "2026-02-17T14:00:00.000Z",
        durationMinutes: 120
      })
    ];

    const plan = generateWeeklyStudyPlan(deadlines, schedule, {
      now,
      horizonDays: 2,
      minSessionMinutes: 45,
      maxSessionMinutes: 120
    });

    expect(plan.sessions.length).toBeGreaterThan(0);

    for (const session of plan.sessions) {
      const sessionStart = new Date(session.startTime).getTime();
      const sessionEnd = new Date(session.endTime).getTime();

      for (const lecture of schedule) {
        const lectureStart = new Date(lecture.startTime).getTime();
        const lectureEnd = lectureStart + lecture.durationMinutes * 60 * 1000;
        const overlapsLecture = sessionStart < lectureEnd && sessionEnd > lectureStart;
        expect(overlapsLecture).toBe(false);
      }
    }
  });

  it("ignores custom effort metadata and uses priority defaults", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");
    const dueDate = "2026-02-19T20:00:00.000Z";

    const withEffortMetadata = generateWeeklyStudyPlan(
      [
        makeDeadline({
          id: "effort-input",
          task: "Uniform assignment estimate",
          priority: "medium",
          dueDate,
          effortHoursRemaining: 2,
          effortConfidence: "low"
        })
      ],
      [],
      {
        now,
        horizonDays: 3,
        minSessionMinutes: 30,
        maxSessionMinutes: 60
      }
    );

    const withoutEffortMetadata = generateWeeklyStudyPlan(
      [
        makeDeadline({
          id: "no-effort-input",
          task: "Uniform assignment estimate",
          priority: "medium",
          dueDate
        })
      ],
      [],
      {
        now,
        horizonDays: 3,
        minSessionMinutes: 30,
        maxSessionMinutes: 60
      }
    );

    expect(withEffortMetadata.summary.totalPlannedMinutes).toBe(withoutEffortMetadata.summary.totalPlannedMinutes);
    expect(withEffortMetadata.summary.totalPlannedMinutes).toBe(150);
  });

  it("ignores non-assignment and non-exam deadlines", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");

    const plan = generateWeeklyStudyPlan(
      [
        makeDeadline({
          id: "non-eligible",
          task: "LLM foundations - part 1",
          dueDate: "2026-02-19T20:00:00.000Z",
          priority: "high"
        }),
        makeDeadline({
          id: "eligible-assignment",
          task: "Assignment 2",
          dueDate: "2026-02-19T20:00:00.000Z",
          priority: "high"
        })
      ],
      [],
      {
        now,
        horizonDays: 7
      }
    );

    expect(plan.summary.deadlinesConsidered).toBe(1);
    expect(plan.sessions.every((session) => session.deadlineId === "eligible-assignment")).toBe(true);
    expect(plan.unallocated.every((item) => item.deadlineId === "eligible-assignment")).toBe(true);
  });

  it("handles no gaps and no deadlines edge cases", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");

    const noDeadlinesPlan = generateWeeklyStudyPlan([], [], { now, horizonDays: 7 });
    expect(noDeadlinesPlan.sessions).toHaveLength(0);
    expect(noDeadlinesPlan.unallocated).toHaveLength(0);

    const fullDayLecture: LectureEvent[] = [
      makeLecture({
        id: "all-day",
        startTime: "2026-02-17T08:00:00.000Z",
        durationMinutes: 24 * 60
      })
    ];
    const deadlines = [
      makeDeadline({
        id: "blocked-deadline",
        priority: "critical",
        dueDate: "2026-02-17T22:00:00.000Z"
      })
    ];

    const blockedPlan = generateWeeklyStudyPlan(deadlines, fullDayLecture, {
      now,
      horizonDays: 1,
      minSessionMinutes: 45
    });

    expect(blockedPlan.sessions).toHaveLength(0);
    expect(blockedPlan.unallocated.length).toBeGreaterThan(0);
    expect(blockedPlan.unallocated[0]?.deadlineId).toBe("blocked-deadline");
  });

  it("is deterministic for identical inputs and options", () => {
    const now = new Date("2026-02-17T08:00:00.000Z");
    const deadlines: Deadline[] = [
      makeDeadline({
        id: "dat560-assignment",
        course: "DAT560",
        task: "Assignment 3",
        priority: "critical",
        dueDate: "2026-02-19T20:00:00.000Z"
      })
    ];
    const schedule: LectureEvent[] = [
      makeLecture({
        id: "dat560-lecture",
        title: "DAT560 Lecture",
        startTime: "2026-02-17T10:00:00.000Z",
        durationMinutes: 120
      })
    ];

    const options = {
      now,
      horizonDays: 3,
      minSessionMinutes: 45,
      maxSessionMinutes: 90
    };

    const firstPlan = generateWeeklyStudyPlan(deadlines, schedule, options);
    const secondPlan = generateWeeklyStudyPlan(deadlines, schedule, options);

    expect(secondPlan).toEqual(firstPlan);
  });
});
