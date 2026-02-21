import { describe, it, expect } from "vitest";
import { RuntimeStore } from "./store.js";
import { GeminiClient } from "./gemini.js";
import {
  buildWeeklyGrowthSundayPushSummary,
  generateWeeklyGrowthReview,
  isSundayInOslo
} from "./weekly-growth-review.js";

describe("weekly-growth-review", () => {
  it("generates a weekly review with explicit commitments", async () => {
    const store = new RuntimeStore(":memory:");
    const userId = "test-user";
    store.createDeadline(userId, {
      course: "DAT560",
      task: "Assignment 2",
      dueDate: "2026-02-20T22:59:00.000Z",
      priority: "high",
      completed: false
    });
    store.createHabit(userId, {
      name: "Study sprint",
      cadence: "daily",
      targetPerWeek: 5,
      motivation: "Focus block"
    });

    const geminiStub = { isConfigured: () => false } as unknown as GeminiClient;
    const review = await generateWeeklyGrowthReview(store, userId, {
      now: new Date("2026-02-17T12:00:00.000Z"),
      geminiClient: geminiStub
    });

    expect(review.periodDays).toBe(7);
    expect(review.summary.length).toBeGreaterThan(0);
    expect(review.commitments.length).toBeGreaterThanOrEqual(1);
    expect(review.commitments.length).toBeLessThanOrEqual(3);
    expect(review.momentum.scheduleAdherence).toBeGreaterThanOrEqual(0);
    expect(review.momentum.deadlineCompletionRate).toBeGreaterThanOrEqual(0);
    expect(review.momentum.habitCompletionRate).toBeGreaterThanOrEqual(0);
  });

  it("builds a concise sunday push summary", () => {
    const summary = buildWeeklyGrowthSundayPushSummary({
      periodDays: 7,
      windowStart: "2026-02-10T00:00:00.000Z",
      windowEnd: "2026-02-17T00:00:00.000Z",
      generatedAt: "2026-02-17T00:00:00.000Z",
      source: "fallback",
      summary: "You kept steady momentum this week and stayed responsive to deadlines.",
      strengths: [],
      risks: [],
      commitments: ["Finalize DAT560 assignment plan", "Review weekly priorities Sunday evening"],
      momentum: {
        scheduleAdherence: 50,
        deadlineCompletionRate: 60,
        habitCompletionRate: 55
      }
    });

    expect(summary).toContain("Next week:");
    expect(summary).toContain("Finalize DAT560 assignment plan");
  });

  it("detects sunday in Oslo timezone", () => {
    expect(isSundayInOslo(new Date("2026-02-22T10:00:00.000Z"))).toBe(true);
    expect(isSundayInOslo(new Date("2026-02-23T10:00:00.000Z"))).toBe(false);
  });
});
