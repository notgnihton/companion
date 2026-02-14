import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Agent State Management", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with all agents in idle state", () => {
    const snapshot = store.getSnapshot();
    expect(snapshot.agentStates).toHaveLength(7);
    snapshot.agentStates.forEach((state) => {
      expect(state.status).toBe("idle");
      expect(state.lastRunAt).toBeNull();
    });
  });

  it("should mark agent as running", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    store.markAgentRunning("notes");

    const snapshot = store.getSnapshot();
    const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

    expect(notesAgent?.status).toBe("running");
    expect(notesAgent?.lastRunAt).toBe(now.toISOString());
  });

  it("should mark agent as error", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    store.markAgentError("orchestrator");

    const snapshot = store.getSnapshot();
    const orchestratorAgent = snapshot.agentStates.find((s) => s.name === "orchestrator");

    expect(orchestratorAgent?.status).toBe("error");
    expect(orchestratorAgent?.lastRunAt).toBe(now.toISOString());
  });

  it("should handle multiple agent state changes", () => {
    store.markAgentRunning("notes");
    store.markAgentRunning("lecture-plan");
    store.markAgentError("video-editor");

    const snapshot = store.getSnapshot();

    const notes = snapshot.agentStates.find((s) => s.name === "notes");
    const lecturePlan = snapshot.agentStates.find((s) => s.name === "lecture-plan");
    const videoEditor = snapshot.agentStates.find((s) => s.name === "video-editor");

    expect(notes?.status).toBe("running");
    expect(lecturePlan?.status).toBe("running");
    expect(videoEditor?.status).toBe("error");
  });
});
