import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { sendChatMessage } from "./chat.js";
import type { GeminiClient } from "./gemini.js";

describe("chat service", () => {
  let store: RuntimeStore;
  let fakeGemini: GeminiClient;
  let generateChatResponse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    generateChatResponse = vi.fn(async () => ({
      text: "Here's a quick plan for your day.",
      finishReason: "stop",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 6,
        totalTokenCount: 18
      }
    }));
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;
  });

  it("builds chat context and stores conversation history", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    store.createLectureEvent({
      title: "DAT520 Lecture",
      startTime: "2026-02-16T10:15:00.000Z",
      durationMinutes: 90,
      workload: "medium"
    });

    store.createDeadline({
      course: "DAT560",
      task: "Assignment 1",
      dueDate: "2026-02-18T23:59:00.000Z",
      priority: "high",
      completed: false
    });

    store.recordJournalEntry("Reflected on yesterday's study session.");

    const result = await sendChatMessage(store, "What should I focus on today?", {
      geminiClient: fakeGemini,
      now
    });

    expect(generateChatResponse).toHaveBeenCalled();
    expect(result.reply).toContain("quick plan");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Canvas data");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("DAT520 Lecture");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Assignment 1");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Reflected on yesterday's study session.");
    expect(result.assistantMessage.metadata?.usage?.totalTokens).toBe(18);

    const history = store.getChatHistory({ page: 1, pageSize: 5 });
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].role).toBe("assistant");
    expect(history.messages[1].role).toBe("user");
  });
});
