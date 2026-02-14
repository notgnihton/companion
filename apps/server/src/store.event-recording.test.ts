import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

describe("RuntimeStore - Event Recording", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should record an event", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const event: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      priority: "medium",
      timestamp: now.toISOString(),
      payload: { test: "data" },
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]).toEqual(event);
  });

  it("should update agent status to idle after recording event", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    store.markAgentRunning("notes");

    const event: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      priority: "high",
      timestamp: now.toISOString(),
      payload: {},
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

    expect(notesAgent?.status).toBe("idle");
    expect(notesAgent?.lastEvent).toEqual(event);
  });

  it("should keep events in reverse chronological order", () => {
    const event1: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      priority: "low",
      timestamp: "2024-01-15T10:00:00Z",
      payload: {},
    };

    const event2: AgentEvent = {
      id: "evt-2",
      source: "lecture-plan",
      eventType: "food.nudge",
      priority: "medium",
      timestamp: "2024-01-15T11:00:00Z",
      payload: {},
    };

    store.recordEvent(event1);
    store.recordEvent(event2);

    const snapshot = store.getSnapshot();
    expect(snapshot.events[0]).toEqual(event2);
    expect(snapshot.events[1]).toEqual(event1);
  });

  it("should limit events to maximum of 100", () => {
    for (let i = 0; i < 150; i++) {
      const event: AgentEvent = {
        id: `evt-${i}`,
        source: "notes",
        eventType: "assignment.deadline",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    }

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(100);
    expect(snapshot.events[0].id).toBe("evt-149");
    expect(snapshot.events[99].id).toBe("evt-50");
  });
});
