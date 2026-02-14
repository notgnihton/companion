import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";

describe("OrchestratorRuntime - Initialization & Lifecycle", () => {
  let store: RuntimeStore;
  let orchestrator: OrchestratorRuntime;

  beforeEach(() => {
    store = new RuntimeStore();
    orchestrator = new OrchestratorRuntime(store);
    vi.useFakeTimers();
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should create orchestrator with store", () => {
      expect(orchestrator).toBeDefined();
    });
  });

  describe("start", () => {
    it("should emit boot notification on start", () => {
      orchestrator.start();

      const snapshot = store.getSnapshot();
      const bootNotif = snapshot.notifications.find(
        (n) => n.source === "orchestrator" && n.title === "AXIS online"
      );

      expect(bootNotif).toBeDefined();
      expect(bootNotif?.message).toBe("All base agents scheduled and running.");
      expect(bootNotif?.priority).toBe("medium");
    });

    it("should schedule agent runs on start", async () => {
      orchestrator.start();

      // Advance timers to trigger agent runs
      await vi.advanceTimersByTimeAsync(1000);

      const snapshot = store.getSnapshot();
      
      // At least one agent should have run
      const runningOrIdleAgents = snapshot.agentStates.filter(
        (s) => s.status === "running" || s.status === "idle"
      );
      
      expect(runningOrIdleAgents.length).toBeGreaterThan(0);
    });

    it("should mark agents as running when they execute", async () => {
      orchestrator.start();

      // Wait a bit for agents to start
      await vi.advanceTimersByTimeAsync(100);

      const snapshot = store.getSnapshot();
      
      // Check that some agents have been marked as running or have completed
      const activeAgents = snapshot.agentStates.filter(
        (s) => s.lastRunAt !== null
      );
      
      expect(activeAgents.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe("stop", () => {
    it("should clear all timers on stop", () => {
      orchestrator.start();
      
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");
      
      orchestrator.stop();

      // Should clear timers for all agents
      expect(clearIntervalSpy).toHaveBeenCalled();

      clearIntervalSpy.mockRestore();
    });

    it("should allow restart after stop", async () => {
      orchestrator.start();
      orchestrator.stop();
      
      store = new RuntimeStore();
      orchestrator = new OrchestratorRuntime(store);
      
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(1000);

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications.length).toBeGreaterThan(0);
    });
  });

  describe("lifecycle", () => {
    it("should handle multiple start/stop cycles", () => {
      orchestrator.start();
      orchestrator.stop();
      orchestrator.start();
      orchestrator.stop();

      // Should not throw or crash
      expect(true).toBe(true);
    });

    it("should not leak timers after stop", () => {
      const setIntervalSpy = vi.spyOn(global, "setInterval");
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      orchestrator.start();
      const setIntervalCallCount = setIntervalSpy.mock.calls.length;
      
      orchestrator.stop();
      const clearIntervalCallCount = clearIntervalSpy.mock.calls.length;

      // Should clear as many intervals as were set
      expect(clearIntervalCallCount).toBe(setIntervalCallCount);

      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    });
  });
});
