import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Chat", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("records chat messages with metadata and paginates history", () => {
    store.recordChatMessage("user", "Hi there");
    store.recordChatMessage("assistant", "Hello!", {
      finishReason: "stop",
      usage: {
        totalTokens: 5
      }
    });

    const history = store.getChatHistory({ page: 1, pageSize: 10 });

    expect(history.total).toBe(2);
    expect(history.page).toBe(1);
    expect(history.hasMore).toBe(false);
    expect(history.messages[0].role).toBe("assistant");
    expect(history.messages[1].role).toBe("user");
    expect(history.messages[0].metadata?.finishReason).toBe("stop");
    expect(history.messages[0].metadata?.usage?.totalTokens).toBe(5);
  });

  it("returns recent chat messages in chronological order", () => {
    store.recordChatMessage("user", "First");
    store.recordChatMessage("assistant", "Second");
    store.recordChatMessage("user", "Third");

    const recent = store.getRecentChatMessages(2);

    expect(recent).toHaveLength(2);
    expect(recent[0].content).toBe("Second");
    expect(recent[1].content).toBe("Third");
  });

  it("trims chat history beyond max capacity", () => {
    for (let i = 0; i < 505; i += 1) {
      store.recordChatMessage("user", `message-${i}`);
    }

    const history = store.getChatHistory({ page: 1, pageSize: 50 });

    expect(history.total).toBe(500);
    expect(history.messages[0].content).toBe("message-504");
    expect(history.hasMore).toBe(true);
  });
});
