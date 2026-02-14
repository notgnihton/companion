import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

describe("RuntimeStore - Snapshot Summary", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should calculate pending deadlines from assignment events", () => {
    const event1: AgentEvent = {
      id: "evt-1",
      source: "notes",
      eventType: "assignment.deadline",
      priority: "high",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    const event2: AgentEvent = {
      id: "evt-2",
      source: "assignment-tracker",
      eventType: "assignment.deadline",
      priority: "critical",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    store.recordEvent(event1);
    store.recordEvent(event2);

    const snapshot = store.getSnapshot();
    expect(snapshot.summary.pendingDeadlines).toBe(2);
  });

  it("should calculate meal compliance from food nudge events", () => {
    let snapshot = store.getSnapshot();
    expect(snapshot.summary.mealCompliance).toBe(100);

    const event1: AgentEvent = {
      id: "evt-1",
      source: "food-tracking",
      eventType: "food.nudge",
      priority: "medium",
      timestamp: new Date().toISOString(),
      payload: {},
    };
    store.recordEvent(event1);

    snapshot = store.getSnapshot();
    expect(snapshot.summary.mealCompliance).toBe(92);

    for (let i = 2; i <= 5; i++) {
      const event: AgentEvent = {
        id: `evt-${i}`,
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    }

    snapshot = store.getSnapshot();
    expect(snapshot.summary.mealCompliance).toBe(60);
  });

  it("should ensure meal compliance has a floor of 10", () => {
    for (let i = 0; i < 20; i++) {
      const event: AgentEvent = {
        id: `evt-${i}`,
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {},
      };
      store.recordEvent(event);
    }

    const snapshot = store.getSnapshot();
    expect(snapshot.summary.mealCompliance).toBe(10);
  });

  it("should detect when video digest is ready", () => {
    const event: AgentEvent = {
      id: "evt-1",
      source: "video-editor",
      eventType: "video.digest-ready",
      priority: "low",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    store.recordEvent(event);

    const snapshot = store.getSnapshot();
    expect(snapshot.summary.digestReady).toBe(true);
  });

  it("should return false for digestReady when no video events", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.summary.digestReady).toBe(false);
  });

  describe("todayFocus computation", () => {
    it("should return focus mode message when mode is focus", () => {
      store.setUserContext({ mode: "focus" });

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Deep work + assignment completion");
    });

    it("should return recovery mode message when mode is recovery", () => {
      store.setUserContext({ mode: "recovery" });

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Light planning + recovery tasks");
    });

    it("should return balanced mode message when mode is balanced", () => {
      store.setUserContext({ mode: "balanced" });

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
    });

    it("should default to balanced message for default context", () => {
      const snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
    });
  });
});
