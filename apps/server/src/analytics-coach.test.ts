import { describe, expect, it, vi } from "vitest";
import { GeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { generateAnalyticsCoachInsight } from "./analytics-coach.js";

function seedAnalyticsData(store: RuntimeStore, userId: string, referenceNow: Date): void {
  const nowIso = referenceNow.toISOString();

  const dueSoon = new Date(referenceNow.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const dueYesterday = new Date(referenceNow.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
  const goalDue = new Date(referenceNow.getTime() + 9 * 24 * 60 * 60 * 1000).toISOString();

  store.createDeadline(userId, {
    course: "DAT600",
    task: "Assignment 2",
    dueDate: dueSoon,
    priority: "high",
    completed: false
  });

  store.createDeadline(userId, {
    course: "DAT520",
    task: "Assignment lab report",
    dueDate: dueYesterday,
    priority: "medium",
    completed: true
  });

  const habit = store.createHabit(userId, {
    name: "Study sprint",
    cadence: "daily",
    targetPerWeek: 6
  });
  store.toggleHabitCheckIn(userId, habit.id, { completed: true, date: nowIso });

  const goal = store.createGoal(userId, {
    title: "Finish project report",
    cadence: "weekly",
    targetCount: 5,
    dueDate: goalDue
  });
  store.toggleGoalCheckIn(userId, goal.id, { completed: true, date: nowIso });

  store.recordJournalEntry(userId, "Focused well on distributed systems reading.");
  const reflectionMessage = store.recordChatMessage(userId, "user", "I should prioritize DAT600 before the weekend.");
  store.upsertReflectionEntry(userId, {
    event: "Deadline planning",
    feelingStress: "neutral (stress: medium)",
    intent: "Set an intention",
    commitment: "Prioritize DAT600 before the weekend",
    outcome: "Captured planning intent",
    timestamp: reflectionMessage.timestamp,
    evidenceSnippet: reflectionMessage.content,
    sourceMessageId: reflectionMessage.id
  });
}

describe("analytics-coach", () => {
  it("returns deterministic fallback insight when Gemini is unavailable", async () => {
    const store = new RuntimeStore(":memory:");
    const userId = "test-user";
    const now = new Date("2026-02-17T14:00:00.000Z");
    seedAnalyticsData(store, userId, now);

    const fakeGemini = {
      isConfigured: () => false,
      generateChatResponse: vi.fn()
    } as unknown as GeminiClient;

    const insight = await generateAnalyticsCoachInsight(store, userId, {
      periodDays: 7,
      now,
      geminiClient: fakeGemini
    });

    expect(insight.source).toBe("fallback");
    expect(insight.periodDays).toBe(7);
    expect(insight.summary.length).toBeGreaterThan(0);
    expect(insight.recommendations.length).toBeGreaterThanOrEqual(3);
    expect(insight.recommendations.length).toBeLessThanOrEqual(5);
    expect(insight.metrics.deadlinesDue).toBeGreaterThan(0);
    expect(insight.metrics.habitsTracked).toBeGreaterThan(0);
    expect(insight.metrics.goalsTracked).toBeGreaterThan(0);
  });

  it("uses Gemini narrative output when strict JSON is returned", async () => {
    const store = new RuntimeStore(":memory:");
    const userId = "test-user";
    const now = new Date("2026-02-17T14:00:00.000Z");
    seedAnalyticsData(store, userId, now);

    const fakeGemini = {
      isConfigured: () => true,
      generateChatResponse: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: "Your follow-through improved this week, but deadline concentration remains risky.",
          strengths: ["You are checking in on habits consistently."],
          risks: ["A high-priority assignment is due soon."],
          recommendations: [
            "Block 90 minutes tonight for DAT600.",
            "Do one end-of-day reflection.",
            "Complete one goal check-in before bed."
          ]
        })
      })
    } as unknown as GeminiClient;

    const insight = await generateAnalyticsCoachInsight(store, userId, {
      periodDays: 14,
      now,
      geminiClient: fakeGemini
    });

    expect(insight.source).toBe("gemini");
    expect(insight.periodDays).toBe(14);
    expect(insight.summary).toContain("follow-through improved");
    expect(insight.strengths[0]).toContain("habits");
    expect(insight.risks[0]).toContain("high-priority");
    expect(insight.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  it("falls back when Gemini returns non-JSON text", async () => {
    const store = new RuntimeStore(":memory:");
    const userId = "test-user";
    const now = new Date("2026-02-17T14:00:00.000Z");
    seedAnalyticsData(store, userId, now);

    const fakeGemini = {
      isConfigured: () => true,
      generateChatResponse: vi.fn().mockResolvedValue({
        text: "I think you're doing great overall."
      })
    } as unknown as GeminiClient;

    const insight = await generateAnalyticsCoachInsight(store, userId, {
      periodDays: 30,
      now,
      geminiClient: fakeGemini
    });

    expect(insight.source).toBe("fallback");
    expect(insight.periodDays).toBe(30);
    expect(insight.recommendations.length).toBeGreaterThanOrEqual(3);
  });

  it("normalizes third-person references to second-person voice", async () => {
    const store = new RuntimeStore(":memory:");
    const userId = "test-user";
    const now = new Date("2026-02-17T14:00:00.000Z");
    seedAnalyticsData(store, userId, now);

    const fakeGemini = {
      isConfigured: () => true,
      generateChatResponse: vi.fn().mockResolvedValue({
        text: JSON.stringify({
          summary: "The student is doing well, but the user should protect focus blocks.",
          strengths: ["The user maintains streaks."],
          risks: ["The student may miss deadlines without planning."],
          recommendations: ["The user should lock one deep-work block tonight."]
        })
      })
    } as unknown as GeminiClient;

    const insight = await generateAnalyticsCoachInsight(store, userId, {
      periodDays: 7,
      now,
      geminiClient: fakeGemini
    });

    expect(insight.summary.toLowerCase()).not.toContain("the student");
    expect(insight.summary.toLowerCase()).not.toContain("the user");
    expect(insight.strengths.join(" ").toLowerCase()).not.toContain("the user");
    expect(insight.risks.join(" ").toLowerCase()).not.toContain("the student");
    expect(insight.recommendations.join(" ").toLowerCase()).not.toContain("the user");
  });
});
