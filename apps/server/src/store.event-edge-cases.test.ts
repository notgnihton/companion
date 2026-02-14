import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent, AgentName } from "./types.js";

describe("RuntimeStore - Event Edge Cases", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should handle recording events for all agent types", () => {
    const agentNames: AgentName[] = [
      "notes",
      "lecture-plan",
      "assignment-tracker",
      "food-tracking",
      "social-highlights",
      "video-editor",
      "orchestrator",
    ];

    agentNames.forEach((name, index) => {
      const event: AgentEvent = {
        id: `evt-${index}`,
        source: name,
        eventType: "assignment.deadline",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(7);
  });

  it("should handle empty payload in events", () => {
    const event: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    expect(snapshot.events[0].payload).toEqual({});
  });

  it("should handle complex payload in events", () => {
    const event: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      timestamp: new Date().toISOString(),
      payload: {
        nested: { data: "value" },
        array: [1, 2, 3],
        boolean: true,
      },
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    expect(snapshot.events[0].payload).toEqual(event.payload);
  });
});
