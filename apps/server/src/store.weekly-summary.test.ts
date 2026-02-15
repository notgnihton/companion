import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - weekly summary", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T20:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds summary from recent deadlines and journals", () => {
    const store = new RuntimeStore(":memory:");

    store.createDeadline({
      course: "Algorithms",
      task: "Problem Set",
      dueDate: "2026-02-18T09:00:00.000Z",
      priority: "high",
      completed: true
    });

    store.createDeadline({
      course: "Systems",
      task: "Lab report",
      dueDate: "2026-02-19T09:00:00.000Z",
      priority: "medium",
      completed: false
    });

    store.recordJournalEntry("Finished review session");
    vi.setSystemTime(new Date("2026-02-17T20:00:00.000Z"));
    store.recordJournalEntry("Had a productive deep work block");

    const summary = store.getWeeklySummary("2026-02-20T22:00:00.000Z");

    expect(summary.deadlinesDue).toBe(2);
    expect(summary.deadlinesCompleted).toBe(1);
    expect(summary.completionRate).toBe(50);
    expect(summary.journalHighlights).toHaveLength(2);
  });
});
