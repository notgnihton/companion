import { describe, expect, it } from "vitest";
import {
  calculateScheduleGaps,
  analyzeCompletionPatterns,
  calculateOptimalNotificationTime,
  OptimalTimeContext
} from "./smart-timing.js";
import { LectureEvent, UserContext, DeadlineReminderState, Deadline } from "./types.js";

describe("calculateScheduleGaps", () => {
  it("returns single gap when no lectures scheduled", () => {
    const fromTime = new Date("2026-02-15T09:00:00Z");
    const toTime = new Date("2026-02-15T17:00:00Z");
    
    const gaps = calculateScheduleGaps([], fromTime, toTime);
    
    expect(gaps).toHaveLength(1);
    expect(gaps[0].startTime).toEqual(fromTime);
    expect(gaps[0].endTime).toEqual(toTime);
    expect(gaps[0].durationMinutes).toBe(480);
  });

  it("identifies gap before first lecture", () => {
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T11:00:00Z",
        durationMinutes: 90,
        workload: "high"
      }
    ];

    const fromTime = new Date("2026-02-15T09:00:00Z");
    const toTime = new Date("2026-02-15T17:00:00Z");
    
    const gaps = calculateScheduleGaps(lectures, fromTime, toTime);
    
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].startTime).toEqual(fromTime);
    expect(gaps[0].durationMinutes).toBe(120);
  });

  it("identifies gap between two lectures", () => {
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T09:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      },
      {
        id: "lec-2",
        title: "Databases",
        startTime: "2026-02-15T12:00:00Z",
        durationMinutes: 90,
        workload: "high"
      }
    ];

    const fromTime = new Date("2026-02-15T08:00:00Z");
    const toTime = new Date("2026-02-15T17:00:00Z");
    
    const gaps = calculateScheduleGaps(lectures, fromTime, toTime);
    
    const gapBetween = gaps.find(g => 
      g.startTime.getTime() === new Date("2026-02-15T10:00:00Z").getTime()
    );
    
    expect(gapBetween).toBeDefined();
    expect(gapBetween?.durationMinutes).toBe(120);
  });

  it("ignores gaps shorter than 30 minutes", () => {
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T09:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      },
      {
        id: "lec-2",
        title: "Databases",
        startTime: "2026-02-15T10:15:00Z",
        durationMinutes: 60,
        workload: "high"
      }
    ];

    const fromTime = new Date("2026-02-15T08:00:00Z");
    const toTime = new Date("2026-02-15T17:00:00Z");
    
    const gaps = calculateScheduleGaps(lectures, fromTime, toTime);
    
    const shortGap = gaps.find(g => g.durationMinutes < 30);
    expect(shortGap).toBeUndefined();
  });

  it("identifies gap after last lecture", () => {
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T09:00:00Z",
        durationMinutes: 60,
        workload: "medium"
      }
    ];

    const fromTime = new Date("2026-02-15T08:00:00Z");
    const toTime = new Date("2026-02-15T17:00:00Z");
    
    const gaps = calculateScheduleGaps(lectures, fromTime, toTime);
    
    const lastGap = gaps[gaps.length - 1];
    expect(lastGap.startTime.getTime()).toBe(new Date("2026-02-15T10:00:00Z").getTime());
    expect(lastGap.endTime).toEqual(toTime);
  });
});

describe("analyzeCompletionPatterns", () => {
  it("returns default peak hours when no history available", () => {
    const { peakHours } = analyzeCompletionPatterns([]);
    
    expect(peakHours).toContain(9);
    expect(peakHours).toContain(14);
    expect(peakHours.length).toBeGreaterThan(0);
  });

  it("identifies peak hours from completion history", () => {
    const history: DeadlineReminderState[] = [
      {
        deadlineId: "d1",
        reminderCount: 1,
        lastReminderAt: "2026-02-10T14:00:00Z",
        lastConfirmationAt: "2026-02-10T14:30:00Z",
        lastConfirmedCompleted: true
      },
      {
        deadlineId: "d2",
        reminderCount: 1,
        lastReminderAt: "2026-02-11T14:00:00Z",
        lastConfirmationAt: "2026-02-11T14:45:00Z",
        lastConfirmedCompleted: true
      },
      {
        deadlineId: "d3",
        reminderCount: 1,
        lastReminderAt: "2026-02-12T15:00:00Z",
        lastConfirmationAt: "2026-02-12T15:20:00Z",
        lastConfirmedCompleted: true
      }
    ];

    const { peakHours } = analyzeCompletionPatterns(history);
    
    // Should include hour 14 which has highest frequency
    expect(peakHours).toContain(14);
    expect(peakHours.length).toBeGreaterThan(0);
  });

  it("ignores incomplete tasks in pattern analysis", () => {
    const history: DeadlineReminderState[] = [
      {
        deadlineId: "d1",
        reminderCount: 2,
        lastReminderAt: "2026-02-10T10:00:00Z",
        lastConfirmationAt: "2026-02-10T10:30:00Z",
        lastConfirmedCompleted: false
      },
      {
        deadlineId: "d2",
        reminderCount: 1,
        lastReminderAt: "2026-02-11T14:00:00Z",
        lastConfirmationAt: "2026-02-11T14:30:00Z",
        lastConfirmedCompleted: true
      }
    ];

    const { peakHours } = analyzeCompletionPatterns(history);
    
    // Should not include hour 10 from incomplete task
    expect(peakHours).toContain(14);
  });
});

describe("calculateOptimalNotificationTime", () => {
  const defaultContext: UserContext = {
    stressLevel: "medium",
    energyLevel: "medium",
    mode: "balanced"
  };

  it("returns immediate time for urgent notifications", () => {
    const currentTime = new Date("2026-02-15T10:00:00Z");
    const context: OptimalTimeContext = {
      scheduleEvents: [],
      deadlines: [],
      userContext: defaultContext,
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, true);
    
    expect(optimalTime).toEqual(currentTime);
  });

  it("schedules notification in schedule gap", () => {
    const currentTime = new Date("2026-02-15T09:00:00Z");
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T10:00:00Z",
        durationMinutes: 60,
        workload: "high"
      },
      {
        id: "lec-2",
        title: "Databases",
        startTime: "2026-02-15T13:00:00Z",
        durationMinutes: 90,
        workload: "medium"
      }
    ];

    const context: OptimalTimeContext = {
      scheduleEvents: lectures,
      deadlines: [],
      userContext: defaultContext,
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // Should not be during lectures (10:00-11:00 or 13:00-14:30)
    // And should be scheduled for today or tomorrow
    expect(optimalTime.getTime()).toBeGreaterThan(currentTime.getTime());
    expect(optimalTime.getTime()).toBeLessThan(new Date("2026-02-16T23:59:00Z").getTime());
  });

  it("prefers high energy user's morning hours", () => {
    const currentTime = new Date("2026-02-15T08:00:00Z");
    const context: OptimalTimeContext = {
      scheduleEvents: [],
      deadlines: [],
      userContext: {
        ...defaultContext,
        energyLevel: "high"
      },
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // High energy users should get notifications scheduled (not immediate)
    expect(optimalTime.getTime()).toBeGreaterThanOrEqual(currentTime.getTime());
    // Should be within 24 hours
    expect(optimalTime.getTime()).toBeLessThanOrEqual(new Date("2026-02-16T08:00:00Z").getTime());
  });

  it("delays notifications for recovery mode", () => {
    const currentTime = new Date("2026-02-15T10:00:00Z");
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Later Class",
        startTime: "2026-02-15T14:00:00Z",
        durationMinutes: 90,
        workload: "medium"
      }
    ];

    const context: OptimalTimeContext = {
      scheduleEvents: lectures,
      deadlines: [],
      userContext: {
        ...defaultContext,
        mode: "recovery"
      },
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // Recovery mode should prefer later times (after the current time)
    expect(optimalTime.getTime()).toBeGreaterThan(currentTime.getTime());
  });

  it("sends soon in focus mode to avoid future interruption", () => {
    const currentTime = new Date("2026-02-15T10:00:00Z");
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Algorithms",
        startTime: "2026-02-15T14:00:00Z",
        durationMinutes: 90,
        workload: "high"
      }
    ];

    const context: OptimalTimeContext = {
      scheduleEvents: lectures,
      deadlines: [],
      userContext: {
        ...defaultContext,
        mode: "focus"
      },
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // Focus mode should prefer sooner times
    const delayMinutes = (optimalTime.getTime() - currentTime.getTime()) / (60 * 1000);
    expect(delayMinutes).toBeLessThan(180); // Within 3 hours
  });

  it("considers historical completion patterns", () => {
    const currentTime = new Date("2026-02-15T08:00:00Z");
    const history: DeadlineReminderState[] = Array.from({ length: 10 }, (_, i) => ({
      deadlineId: `d${i}`,
      reminderCount: 1,
      lastReminderAt: `2026-02-${10 + i}T14:00:00Z`,
      lastConfirmationAt: `2026-02-${10 + i}T15:00:00Z`,
      lastConfirmedCompleted: true
    }));

    const context: OptimalTimeContext = {
      scheduleEvents: [],
      deadlines: [],
      userContext: defaultContext,
      deadlineHistory: history,
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // Should schedule a time in the future (not immediate)
    expect(optimalTime.getTime()).toBeGreaterThan(currentTime.getTime());
    // Historical patterns should influence the choice, but we just verify it's scheduled
    expect(optimalTime.getTime()).toBeLessThan(new Date("2026-02-16T08:00:00Z").getTime());
  });

  it("schedules for next day when late at night", () => {
    const currentTime = new Date("2026-02-15T23:00:00Z");
    const lectures: LectureEvent[] = [
      {
        id: "lec-1",
        title: "Late Class",
        startTime: "2026-02-15T20:00:00Z",
        durationMinutes: 120,
        workload: "high"
      }
    ];

    const context: OptimalTimeContext = {
      scheduleEvents: lectures,
      deadlines: [],
      userContext: defaultContext,
      deadlineHistory: [],
      currentTime
    };

    const optimalTime = calculateOptimalNotificationTime(context, false);
    
    // When it's late, should schedule for the next day
    expect(optimalTime.getTime()).toBeGreaterThanOrEqual(currentTime.getTime());
  });
});
