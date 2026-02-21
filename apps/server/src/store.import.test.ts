import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { ImportData } from "./types.js";

describe("RuntimeStore - import data", () => {
  const userId = "test-user";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-15T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("imports complete dataset with journals, schedule, deadlines, habits, goals, context, and preferences", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {
      version: "1.0",
      journals: [
        {
          id: "journal-1",
          content: "Finished algorithms homework",
          timestamp: "2026-02-15T10:00:00.000Z",
          updatedAt: "2026-02-15T10:00:00.000Z",
          version: 1,
          tags: []
        },
        {
          id: "journal-2",
          content: "Had a productive study session",
          timestamp: "2026-02-15T14:00:00.000Z",
          updatedAt: "2026-02-15T14:00:00.000Z",
          version: 1,
          tags: []
        }
      ],
      schedule: [
        {
          id: "lecture-1",
          title: "Algorithms Lecture",
          startTime: "2026-02-16T10:00:00.000Z",
          durationMinutes: 90,
          workload: "high"
        }
      ],
      deadlines: [
        {
          id: "deadline-1",
          course: "Systems",
          task: "Lab Report",
          dueDate: "2026-02-20T23:59:00.000Z",
          priority: "high",
          completed: false
        }
      ],
      habits: [
        {
          id: "habit-1",
          name: "Evening review",
          cadence: "daily",
          targetPerWeek: 6,
          motivation: "Close the loop on the day",
          createdAt: "2026-02-10T00:00:00.000Z"
        }
      ],
      goals: [
        {
          id: "goal-1",
          title: "Ship portfolio draft",
          cadence: "daily",
          targetCount: 4,
          dueDate: "2026-02-25T00:00:00.000Z",
          createdAt: "2026-02-10T00:00:00.000Z"
        }
      ],
      userContext: {
        stressLevel: "medium",
        energyLevel: "high",
        mode: "focus"
      },
      notificationPreferences: {
        quietHours: { enabled: true, startHour: 22, endHour: 7 },
        minimumPriority: "medium",
        allowCriticalInQuietHours: true
      }
    };

    const result = store.importData(userId, importData);

    // Verify import counts
    expect(result.imported.journals).toBe(2);
    expect(result.imported.schedule).toBe(1);
    expect(result.imported.deadlines).toBe(1);
    expect(result.imported.habits).toBe(1);
    expect(result.imported.goals).toBe(1);
    expect(result.conflicts.journals).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);

    // Verify data was actually imported
    const journals = store.getJournalEntries(userId);
    expect(journals).toHaveLength(2);
    // Journals are ordered by timestamp DESC, so the later one comes first
    expect(journals[0].content).toBe("Had a productive study session");
    expect(journals[1].content).toBe("Finished algorithms homework");

    const schedule = store.getScheduleEvents(userId);
    expect(schedule).toHaveLength(1);
    expect(schedule[0].title).toBe("Algorithms Lecture");

    const deadlines = store.getDeadlines(userId);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].course).toBe("Systems");

    const habits = store.getHabitsWithStatus(userId);
    const importedHabit = habits.find((h) => h.id === "habit-1");
    expect(importedHabit).toBeDefined();
    expect(importedHabit?.name).toBe("Evening review");

    const goals = store.getGoalsWithStatus(userId);
    const importedGoal = goals.find((g) => g.id === "goal-1");
    expect(importedGoal).toBeDefined();
    expect(importedGoal?.title).toBe("Ship portfolio draft");

    const context = store.getUserContext(userId);
    expect(context.stressLevel).toBe("medium");
    expect(context.energyLevel).toBe("high");
    expect(context.mode).toBe("focus");

    const prefs = store.getNotificationPreferences(userId);
    expect(prefs.quietHours.enabled).toBe(true);
    expect(prefs.minimumPriority).toBe("medium");
  });

  it("imports partial dataset with only journals", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {
      journals: [
        {
          id: "journal-1",
          content: "Test journal entry",
          timestamp: "2026-02-15T10:00:00.000Z",
          updatedAt: "2026-02-15T10:00:00.000Z",
          version: 1,
          tags: []
        }
      ]
    };

    const result = store.importData(userId, importData);

    expect(result.imported.journals).toBe(1);
    expect(result.imported.schedule).toBe(0);
    expect(result.imported.deadlines).toBe(0);
    expect(result.imported.habits).toBe(0);
    expect(result.imported.goals).toBe(0);

    const journals = store.getJournalEntries(userId);
    expect(journals).toHaveLength(1);
    expect(journals[0].content).toBe("Test journal entry");
  });

  it("updates existing records when importing with same IDs", () => {
    const store = new RuntimeStore(":memory:");

    // Create initial data
    store.createLectureEvent(userId, {
      title: "Original Title",
      startTime: "2026-02-16T10:00:00.000Z",
      durationMinutes: 60,
      workload: "low"
    });

    const scheduleEvents = store.getScheduleEvents(userId);
    const originalId = scheduleEvents[0].id;

    // Import with same ID but different data
    const importData: ImportData = {
      schedule: [
        {
          id: originalId,
          title: "Updated Title",
          startTime: "2026-02-16T11:00:00.000Z",
          durationMinutes: 90,
          workload: "high"
        }
      ]
    };

    const result = store.importData(userId, importData);

    expect(result.imported.schedule).toBe(1);
    expect(result.warnings).toHaveLength(0);

    // Verify the record was updated
    const updatedSchedule = store.getScheduleEvents(userId);
    expect(updatedSchedule).toHaveLength(1);
    expect(updatedSchedule[0].id).toBe(originalId);
    expect(updatedSchedule[0].title).toBe("Updated Title");
    expect(updatedSchedule[0].durationMinutes).toBe(90);
    expect(updatedSchedule[0].workload).toBe("high");
  });

  it("handles journal conflicts when importing with same ID but different content", () => {
    const store = new RuntimeStore(":memory:");

    // Create initial journal entry
    const initial = store.recordJournalEntry(userId, "Original content");

    // Import with same ID but different content (simulates conflict)
    const importData: ImportData = {
      journals: [
        {
          id: initial.id,
          content: "Different content",
          timestamp: "2026-02-15T10:00:00.000Z",
          updatedAt: "2026-02-15T10:00:00.000Z",
          version: 1,
          clientEntryId: "client-1",
          tags: []
        }
      ]
    };

    const result = store.importData(userId, importData);

    // Since we don't provide baseVersion, it should update the existing entry
    expect(result.imported.journals).toBe(1);
    expect(result.conflicts.journals).toHaveLength(0);

    const journals = store.getJournalEntries(userId);
    expect(journals).toHaveLength(1);
    expect(journals[0].content).toBe("Different content");
    expect(journals[0].version).toBe(2); // Version incremented
  });

  it("imports data with null/optional fields correctly", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {
      habits: [
        {
          id: "habit-1",
          name: "Test habit",
          cadence: "daily",
          targetPerWeek: 5,
          createdAt: "2026-02-10T00:00:00.000Z"
          // motivation is optional and not provided
        }
      ],
      goals: [
        {
          id: "goal-1",
          title: "Test goal",
          cadence: "weekly",
          targetCount: 3,
          dueDate: null, // null dueDate
          createdAt: "2026-02-10T00:00:00.000Z"
        }
      ]
    };

    const result = store.importData(userId, importData);

    expect(result.imported.habits).toBe(1);
    expect(result.imported.goals).toBe(1);
    expect(result.warnings).toHaveLength(0);

    const habits = store.getHabitsWithStatus(userId);
    const habit = habits.find((h) => h.id === "habit-1");
    expect(habit).toBeDefined();
    expect(habit?.motivation).toBeUndefined();

    const goals = store.getGoalsWithStatus(userId);
    const goal = goals.find((g) => g.id === "goal-1");
    expect(goal).toBeDefined();
    expect(goal?.dueDate).toBeNull();
  });

  it("handles empty import data gracefully", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {};

    const result = store.importData(userId, importData);

    expect(result.imported.journals).toBe(0);
    expect(result.imported.schedule).toBe(0);
    expect(result.imported.deadlines).toBe(0);
    expect(result.imported.habits).toBe(0);
    expect(result.imported.goals).toBe(0);
    expect(result.conflicts.journals).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("imports empty arrays without errors", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {
      journals: [],
      schedule: [],
      deadlines: [],
      habits: [],
      goals: []
    };

    const result = store.importData(userId, importData);

    expect(result.imported.journals).toBe(0);
    expect(result.imported.schedule).toBe(0);
    expect(result.imported.deadlines).toBe(0);
    expect(result.imported.habits).toBe(0);
    expect(result.imported.goals).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns about version incompatibility", () => {
    const store = new RuntimeStore(":memory:");

    const importData: ImportData = {
      version: "2.0",
      journals: []
    };

    const result = store.importData(userId, importData);

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("version");
    expect(result.warnings[0]).toContain("2.0");
  });

  it("preserves IDs and timestamps from imported data", () => {
    const store = new RuntimeStore(":memory:");

    const specificId = "custom-journal-12345";
    const specificTimestamp = "2026-01-01T12:00:00.000Z";

    const importData: ImportData = {
      journals: [
        {
          id: specificId,
          content: "Test with specific ID",
          timestamp: specificTimestamp,
          updatedAt: "2026-01-01T12:00:00.000Z",
          version: 1,
          tags: []
        }
      ]
    };

    const result = store.importData(userId, importData);

    expect(result.imported.journals).toBe(1);

    const journals = store.getJournalEntries(userId);
    expect(journals[0].id).toBe(specificId);
    expect(journals[0].timestamp).toBe(specificTimestamp);
  });

  it("can import data exported from another store (round-trip test)", () => {
    const store1 = new RuntimeStore(":memory:");

    // Create data in store1
    store1.recordJournalEntry(userId, "Test journal");
    store1.createLectureEvent(userId, {
      title: "Test Lecture",
      startTime: "2026-02-16T10:00:00.000Z",
      durationMinutes: 60,
      workload: "medium"
    });
    store1.createDeadline(userId, {
      course: "CS101",
      task: "Homework 1",
      dueDate: "2026-02-20T23:59:00.000Z",
      priority: "high",
      completed: false
    });
    store1.setUserContext(userId, { stressLevel: "low", energyLevel: "high", mode: "focus" });

    // Export from store1
    const exportData = store1.getExportData(userId);

    // Create new store and import
    const store2 = new RuntimeStore(":memory:");
    const result = store2.importData(userId, {
      journals: exportData.journals,
      schedule: exportData.schedule,
      deadlines: exportData.deadlines,
      habits: exportData.habits.map((h) => ({
        id: h.id,
        name: h.name,
        cadence: h.cadence,
        targetPerWeek: h.targetPerWeek,
        motivation: h.motivation,
        createdAt: h.createdAt
      })),
      goals: exportData.goals.map((g) => ({
        id: g.id,
        title: g.title,
        cadence: g.cadence,
        targetCount: g.targetCount,
        dueDate: g.dueDate,
        motivation: g.motivation,
        createdAt: g.createdAt
      })),
      userContext: exportData.userContext,
      notificationPreferences: exportData.notificationPreferences
    });

    // Verify import was successful
    expect(result.imported.journals).toBe(1);
    expect(result.imported.schedule).toBe(1);
    expect(result.imported.deadlines).toBe(1);

    // Verify data matches
    const journals2 = store2.getJournalEntries(userId);
    const journals1 = store1.getJournalEntries(userId);
    expect(journals2[0].content).toBe(journals1[0].content);

    const schedule2 = store2.getScheduleEvents(userId);
    const schedule1 = store1.getScheduleEvents(userId);
    expect(schedule2[0].title).toBe(schedule1[0].title);

    const deadlines2 = store2.getDeadlines(userId);
    const deadlines1 = store1.getDeadlines(userId);
    expect(deadlines2[0].task).toBe(deadlines1[0].task);

    const context2 = store2.getUserContext(userId);
    const context1 = store1.getUserContext(userId);
    expect(context2.stressLevel).toBe(context1.stressLevel);
  });

  it("merges user context and notification preferences with existing data", () => {
    const store = new RuntimeStore(":memory:");

    // Set initial context and preferences
    store.setUserContext(userId, { stressLevel: "high", energyLevel: "low", mode: "recovery" });
    store.setNotificationPreferences(userId, {
      quietHours: { enabled: false, startHour: 0, endHour: 0 },
      minimumPriority: "low"
    });

    // Import partial updates
    const importData: ImportData = {
      userContext: {
        stressLevel: "medium" // Only update stress level
      },
      notificationPreferences: {
        quietHours: { enabled: true, startHour: 22 } // Only update quiet hours
      }
    };

    store.importData(userId, importData);

    const context = store.getUserContext(userId);
    expect(context.stressLevel).toBe("medium"); // Updated
    expect(context.energyLevel).toBe("low"); // Preserved
    expect(context.mode).toBe("recovery"); // Preserved

    const prefs = store.getNotificationPreferences(userId);
    expect(prefs.quietHours.enabled).toBe(true); // Updated
    expect(prefs.quietHours.startHour).toBe(22); // Updated
    expect(prefs.minimumPriority).toBe("low"); // Preserved
  });
});
