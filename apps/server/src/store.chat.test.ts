import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Chat", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("records chat messages with metadata and paginates history", () => {
    store.recordChatMessage(userId, "user", "Hi there");
    store.recordChatMessage(userId, "assistant", "Hello!", {
      finishReason: "stop",
      usage: {
        totalTokens: 5
      }
    });

    const history = store.getChatHistory(userId, { page: 1, pageSize: 10 });

    expect(history.total).toBe(2);
    expect(history.page).toBe(1);
    expect(history.hasMore).toBe(false);
    expect(history.messages[0].role).toBe("assistant");
    expect(history.messages[1].role).toBe("user");
    expect(history.messages[0].metadata?.finishReason).toBe("stop");
    expect(history.messages[0].metadata?.usage?.totalTokens).toBe(5);
  });

  it("returns recent chat messages in chronological order", () => {
    store.recordChatMessage(userId, "user", "First");
    store.recordChatMessage(userId, "assistant", "Second");
    store.recordChatMessage(userId, "user", "Third");

    const recent = store.getRecentChatMessages(userId, 2);

    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("Second");
    expect(recent[1].content).toBe("Third");
  });

  it("trims chat history beyond max capacity", () => {
    for (let i = 0; i < 505; i += 1) {
      store.recordChatMessage(userId, "user", `message-${i}`);
    }

    const history = store.getChatHistory(userId, { page: 1, pageSize: 50 });

    expect(history.total).toBe(505);
    expect(history.messages[0].content).toBe("message-504");
    expect(history.hasMore).toBe(true);
  });

  it("upserts structured reflection entries keyed by source message id", () => {
    const first = store.upsertReflectionEntry(userId, {
      event: "Deadline planning",
      feelingStress: "negative (stress: high)",
      intent: "Get guidance or action help",
      commitment: "Finish assignment 2",
      outcome: "Provided next steps",
      timestamp: "2026-02-19T10:00:00.000Z",
      evidenceSnippet: "I need help finishing assignment 2 today.",
      sourceMessageId: "chat-1"
    });

    const updated = store.upsertReflectionEntry(userId, {
      event: "Deadline planning",
      feelingStress: "positive (stress: low)",
      intent: "Report progress",
      commitment: "Finish assignment 2",
      outcome: "Marked as complete",
      timestamp: "2026-02-19T10:05:00.000Z",
      evidenceSnippet: "I finished assignment 2.",
      sourceMessageId: "chat-1"
    });

    const reflections = store.getRecentReflectionEntries(userId, 10);
    expect(reflections).toHaveLength(1);
    expect(reflections[0]?.id).toBe(first.id);
    expect(updated.id).toBe(first.id);
    expect(reflections[0]?.outcome).toBe("Marked as complete");
    expect(reflections[0]?.evidenceSnippet).toContain("finished assignment 2");
  });

  it("returns structured reflections within a timestamp window", () => {
    store.upsertReflectionEntry(userId, {
      event: "General reflection",
      feelingStress: "neutral (stress: medium)",
      intent: "Share context",
      commitment: "none",
      outcome: "Captured context",
      timestamp: "2026-02-18T08:00:00.000Z",
      evidenceSnippet: "Morning update.",
      sourceMessageId: "chat-a"
    });
    store.upsertReflectionEntry(userId, {
      event: "Schedule adjustment",
      feelingStress: "neutral (stress: medium)",
      intent: "Get guidance or action help",
      commitment: "Go gym at 07:00",
      outcome: "Routine applied",
      timestamp: "2026-02-19T08:00:00.000Z",
      evidenceSnippet: "I go gym every day at 7.",
      sourceMessageId: "chat-b"
    });

    const inRange = store.getReflectionEntriesInRange(userId,
      "2026-02-19T00:00:00.000Z",
      "2026-02-19T23:59:59.999Z",
      20
    );

    expect(inRange).toHaveLength(1);
    expect(inRange[0]?.sourceMessageId).toBe("chat-b");
  });
});
