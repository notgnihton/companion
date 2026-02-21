import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - weekly summary", () => {
  const userId = "test-user";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-19T20:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds summary from recent deadlines and reflections", () => {
    const store = new RuntimeStore(":memory:");

    store.createDeadline(userId, {
      course: "Algorithms",
      task: "Problem Set",
      dueDate: "2026-02-18T09:00:00.000Z",
      priority: "high",
      completed: true
    });

    store.createDeadline(userId, {
      course: "Systems",
      task: "Lab report",
      dueDate: "2026-02-19T09:00:00.000Z",
      priority: "medium",
      completed: false
    });

    const firstReflection = store.recordChatMessage(userId, "user", "Finished review session");
    store.upsertReflectionEntry(userId, {
      event: "General reflection",
      feelingStress: "neutral (stress: medium)",
      intent: "Report progress",
      commitment: "none",
      outcome: "Captured daily progress",
      timestamp: firstReflection.timestamp,
      evidenceSnippet: firstReflection.content,
      sourceMessageId: firstReflection.id
    });
    vi.setSystemTime(new Date("2026-02-17T20:00:00.000Z"));
    const secondReflection = store.recordChatMessage(userId, "user", "Had a productive deep work block");
    store.upsertReflectionEntry(userId, {
      event: "General reflection",
      feelingStress: "positive (stress: low)",
      intent: "Report progress",
      commitment: "none",
      outcome: "Captured daily progress",
      timestamp: secondReflection.timestamp,
      evidenceSnippet: secondReflection.content,
      sourceMessageId: secondReflection.id
    });

    const summary = store.getWeeklySummary(userId, "2026-02-20T22:00:00.000Z");

    expect(summary.deadlinesDue).toBe(2);
    expect(summary.deadlinesCompleted).toBe(1);
    expect(summary.completionRate).toBe(50);
    expect(summary.reflectionHighlights).toHaveLength(2);
  });
});
