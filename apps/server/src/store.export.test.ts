import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - export data", () => {
  const userId = "test-user";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports all user data including journals, schedule, deadlines, context, and preferences", () => {
    const store = new RuntimeStore(":memory:");

    const focusTag = store.createTag(userId, "focus");
    const lectureTag = store.createTag(userId, "lecture");

    // Create test data
    store.recordJournalEntry(userId, "Finished algorithms homework", [lectureTag.id]);
    store.recordJournalEntry(userId, "Had a productive study session", [focusTag.id]);

    store.createLectureEvent(userId, {
      title: "Algorithms Lecture",
      startTime: "2026-02-16T10:00:00.000Z",
      durationMinutes: 90,
      workload: "high"
    });

    store.createDeadline(userId, {
      course: "Systems",
      task: "Lab Report",
      dueDate: "2026-02-20T23:59:00.000Z",
      priority: "high",
      completed: false
    });

    const habit = store.createHabit(userId, {
      name: "Evening review",
      cadence: "daily",
      targetPerWeek: 6,
      motivation: "Close the loop on the day"
    });
    store.toggleHabitCheckIn(userId, habit.id, { date: "2026-02-15T09:00:00.000Z", completed: true });

    const goal = store.createGoal(userId, {
      title: "Ship portfolio draft",
      cadence: "daily",
      targetCount: 4,
      dueDate: "2026-02-25T00:00:00.000Z"
    });
    store.toggleGoalCheckIn(userId, goal.id, { date: "2026-02-15T10:00:00.000Z", completed: true });

    store.setUserContext(userId, {
      stressLevel: "medium",
      energyLevel: "high",
      mode: "focus"
    });

    store.setNotificationPreferences(userId, {
      quietHours: { enabled: true, startHour: 22, endHour: 7 },
      minimumPriority: "medium",
      allowCriticalInQuietHours: true
    });

    // Get export data
    const exportData = store.getExportData(userId);

    // Verify structure
    expect(exportData).toHaveProperty("exportedAt");
    expect(exportData).toHaveProperty("version");
    expect(exportData).toHaveProperty("journals");
    expect(exportData).toHaveProperty("tags");
    expect(exportData).toHaveProperty("schedule");
    expect(exportData).toHaveProperty("deadlines");
    expect(exportData).toHaveProperty("habits");
    expect(exportData).toHaveProperty("goals");
    expect(exportData).toHaveProperty("userContext");
    expect(exportData).toHaveProperty("notificationPreferences");

    // Verify version
    expect(exportData.version).toBe("1.0");

    // Verify timestamp
    expect(exportData.exportedAt).toBe("2026-02-15T15:00:00.000Z");

    // Verify journals (ordered by timestamp DESC)
    expect(exportData.journals).toHaveLength(2);
    expect(exportData.journals[0].content).toBe("Finished algorithms homework");
    expect(exportData.journals[1].content).toBe("Had a productive study session");
    expect(exportData.journals[0].tags).toContain("lecture");

    // Verify schedule
    expect(exportData.schedule).toHaveLength(1);
    expect(exportData.schedule[0].title).toBe("Algorithms Lecture");
    expect(exportData.schedule[0].workload).toBe("high");

    // Verify deadlines
    expect(exportData.deadlines).toHaveLength(1);
    expect(exportData.deadlines[0].course).toBe("Systems");
    expect(exportData.deadlines[0].completed).toBe(false);

    expect(exportData.habits.length).toBeGreaterThan(0);
    expect(exportData.habits[0]).toHaveProperty("recentCheckIns");
    expect(exportData.goals.length).toBeGreaterThan(0);
    expect(exportData.goals[0]).toHaveProperty("progressCount");

    // Verify user context
    expect(exportData.userContext.stressLevel).toBe("medium");
    expect(exportData.userContext.energyLevel).toBe("high");
    expect(exportData.userContext.mode).toBe("focus");

    // Verify notification preferences
    expect(exportData.notificationPreferences.quietHours.enabled).toBe(true);
    expect(exportData.notificationPreferences.minimumPriority).toBe("medium");
  });

  it("exports empty arrays when no data exists", () => {
    const store = new RuntimeStore(":memory:");
    const exportData = store.getExportData(userId);

    expect(exportData.journals).toEqual([]);
    expect(exportData.schedule).toEqual([]);
    expect(exportData.deadlines).toEqual([]);
    expect(exportData.habits).toEqual([]);
    expect(exportData.goals).toEqual([]);
    expect(exportData.userContext).toBeDefined();
    expect(exportData.notificationPreferences).toBeDefined();
  });
});
