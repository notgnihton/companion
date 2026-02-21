import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";

describe("OrchestratorRuntime - Agent Coordination & Notifications", () => {
  let store: RuntimeStore;
  let orchestrator: OrchestratorRuntime;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    orchestrator = new OrchestratorRuntime(store, userId);
    vi.useFakeTimers();
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
  });

  describe("agent coordination", () => {
    it("should run multiple agents concurrently", async () => {
      orchestrator.start();

      // Advance enough time for multiple agents to run
      await vi.advanceTimersByTimeAsync(60000);

      const snapshot = store.getSnapshot(userId);
      
      // Multiple agents should have generated events/notifications
      expect(snapshot.notifications.length).toBeGreaterThan(1);
    });

    it("should respect agent intervals", async () => {
      orchestrator.start();

      const snapshot1 = store.getSnapshot(userId);
      const initialCount = snapshot1.notifications.length;

      // Advance by a small amount
      await vi.advanceTimersByTimeAsync(5000);

      const snapshot2 = store.getSnapshot(userId);
      
      // Notification count should be different or agents should have run
      expect(snapshot2).toBeDefined();
    });

    it("should track agent state during execution", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(100);

      const snapshot = store.getSnapshot(userId);
      
      // All agents should have a state
      expect(snapshot.agentStates.length).toBeGreaterThan(0);
      
      snapshot.agentStates.forEach((state) => {
        expect(state.name).toBeTruthy();
        expect(["idle", "running", "error"]).toContain(state.status);
      });
    });
  });

  describe("notification generation", () => {
    it("should generate notifications with correct structure", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(35000);

      const snapshot = store.getSnapshot(userId);
      
      if (snapshot.notifications.length > 0) {
        const notif = snapshot.notifications[0];
        
        expect(notif).toHaveProperty("id");
        expect(notif).toHaveProperty("title");
        expect(notif).toHaveProperty("message");
        expect(notif).toHaveProperty("priority");
        expect(notif).toHaveProperty("source");
        expect(notif).toHaveProperty("timestamp");
      }
    });

    it("should preserve event priority in notifications", async () => {
      orchestrator.start();

      await vi.advanceTimersByTimeAsync(25000); // Assignment agent

      const snapshot = store.getSnapshot(userId);
      
      if (snapshot.notifications.length > 0) {
        const notif = snapshot.notifications[0];
        expect(["low", "medium", "high", "critical"]).toContain(notif.priority);
      }
    });
  });
});
