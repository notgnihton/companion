import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - deadline completion reminders", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns overdue incomplete deadlines and respects reminder cooldown", () => {
    const overdue = store.createDeadline({
      course: "Algorithms",
      task: "Problem Set 8",
      dueDate: "2026-03-10T09:00:00.000Z",
      priority: "high",
      completed: false
    });
    store.createDeadline({
      course: "Systems",
      task: "Lab 5",
      dueDate: "2026-03-10T16:00:00.000Z",
      priority: "medium",
      completed: false
    });

    expect(store.getOverdueDeadlinesRequiringReminder()).toEqual([overdue]);

    const reminder = store.recordDeadlineReminder(overdue.id);
    expect(reminder?.reminderCount).toBe(1);
    expect(store.getOverdueDeadlinesRequiringReminder()).toHaveLength(0);

    vi.advanceTimersByTime(3 * 60 * 60 * 1000);
    expect(store.getOverdueDeadlinesRequiringReminder()).toEqual([overdue]);
  });

  it("records completion confirmations and updates the deadline state", () => {
    const overdue = store.createDeadline({
      course: "Databases",
      task: "Schema report",
      dueDate: "2026-03-10T08:00:00.000Z",
      priority: "critical",
      completed: false
    });

    store.recordDeadlineReminder(overdue.id);
    const confirmation = store.confirmDeadlineStatus(overdue.id, true);

    expect(confirmation).not.toBeNull();
    expect(confirmation?.deadline.completed).toBe(true);
    expect(confirmation?.reminder.lastConfirmationAt).not.toBeNull();
    expect(confirmation?.reminder.lastConfirmedCompleted).toBe(true);
    expect(store.getOverdueDeadlinesRequiringReminder()).toHaveLength(0);
  });
});
