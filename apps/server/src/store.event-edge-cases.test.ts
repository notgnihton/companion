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
        priority: "medium",
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
      priority: "low",
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
      priority: "high",
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

  it("should handle all priority levels", () => {
    const priorities: Array<"low" | "medium" | "high" | "critical"> = [
      "low",
      "medium",
      "high",
      "critical",
    ];

    priorities.forEach((priority, index) => {
      const event: AgentEvent = {
        id: `evt-${index}`,
        source: "notes",
        eventType: "assignment.deadline",
        priority,
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(4);
    expect(snapshot.events[0].priority).toBe("critical");
    expect(snapshot.events[3].priority).toBe("low");
  });

  it("should handle different event types", () => {
    const eventTypes = [
      "assignment.deadline",
      "food.nudge",
      "video.digest-ready",
      "lecture.reminder",
    ];

    eventTypes.forEach((eventType, index) => {
      const event: AgentEvent = {
        id: `evt-${index}`,
        source: "notes",
        eventType,
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(4);
    expect(snapshot.events.map((e) => e.eventType)).toEqual([
      "lecture.reminder",
      "video.digest-ready",
      "food.nudge",
      "assignment.deadline",
    ]);
  });

  it("should preserve event metadata through recording", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const event: AgentEvent = {
      id: "custom-id-123",
      source: "assignment-tracker",
      eventType: "assignment.deadline",
      priority: "critical",
      timestamp: now.toISOString(),
      payload: { assignmentId: "hw-001", dueDate: "2024-01-20" },
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    const recorded = snapshot.events[0];
    
    expect(recorded.id).toBe("custom-id-123");
    expect(recorded.source).toBe("assignment-tracker");
    expect(recorded.priority).toBe("critical");
    expect(recorded.payload).toEqual({ assignmentId: "hw-001", dueDate: "2024-01-20" });
  });
});
