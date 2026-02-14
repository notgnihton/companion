import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

describe("RuntimeStore - Snapshot Basic", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should generate a snapshot with current timestamp", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const snapshot = store.getSnapshot();
    expect(snapshot.generatedAt).toBe(now.toISOString());
  });

  it("should include agent states in snapshot", () => {
    store.markAgentRunning("notes");

    const snapshot = store.getSnapshot();
    expect(snapshot.agentStates).toHaveLength(7);

    const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");
    expect(notesAgent?.status).toBe("running");
  });

  it("should include events and notifications in snapshot", () => {
    const event: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    store.recordEvent(event);
    store.pushNotification({
      type: "info",
      title: "Test",
      message: "Test",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.notifications).toHaveLength(1);
  });
});
