import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Agent Lifecycle", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("markAgentRunning", () => {
    it("should mark agent as running with timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentRunning("notes");

      const snapshot = store.getSnapshot();
      const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

      expect(notesAgent?.status).toBe("running");
      expect(notesAgent?.lastRunAt).toBe(now.toISOString());
    });

    it("should only update the specified agent", () => {
      store.markAgentRunning("notes");

      const snapshot = store.getSnapshot();
      const otherAgents = snapshot.agentStates.filter((s) => s.name !== "notes");

      otherAgents.forEach((agent) => {
        expect(agent.status).toBe("idle");
        expect(agent.lastRunAt).toBeNull();
      });
    });
  });

  describe("markAgentError", () => {
    it("should mark agent as error with timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentError("orchestrator");

      const snapshot = store.getSnapshot();
      const orchestratorAgent = snapshot.agentStates.find((s) => s.name === "orchestrator");

      expect(orchestratorAgent?.status).toBe("error");
      expect(orchestratorAgent?.lastRunAt).toBe(now.toISOString());
    });
  });
});
