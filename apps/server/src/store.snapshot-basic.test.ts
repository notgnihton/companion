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
      priority: "high",
      timestamp: new Date().toISOString(),
      payload: {},
    };

    store.recordEvent(event);
    store.pushNotification({
      title: "Test",
      message: "Test",
      priority: "medium",
      source: "notes",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.notifications).toHaveLength(1);
  });

  it("should handle empty snapshot", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.notifications).toHaveLength(0);
    expect(snapshot.agentStates).toHaveLength(7);
  });

  it("should include summary statistics in snapshot", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.summary).toBeDefined();
    expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
    expect(snapshot.summary.pendingDeadlines).toBe(0);
    expect(snapshot.summary.mealCompliance).toBeGreaterThanOrEqual(0);
    expect(snapshot.summary.digestReady).toBe(false);
  });

  it("should preserve agent state history in snapshot", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    store.markAgentRunning("notes");
    store.markAgentError("video-editor");

    const snapshot = store.getSnapshot();
    
    const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");
    const videoAgent = snapshot.agentStates.find((s) => s.name === "video-editor");
    const idleAgent = snapshot.agentStates.find((s) => s.name === "orchestrator");

    expect(notesAgent?.status).toBe("running");
    expect(notesAgent?.lastRunAt).toBe(now.toISOString());
    expect(videoAgent?.status).toBe("error");
    expect(idleAgent?.status).toBe("idle");
  });
});
