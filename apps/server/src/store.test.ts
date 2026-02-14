import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentEvent, UserContext } from "./types.js";

describe("RuntimeStore", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("initialization", () => {
    it("should initialize with correct default state", () => {
      const snapshot = store.getSnapshot();

      expect(snapshot.agentStates).toHaveLength(7);
      expect(snapshot.events).toHaveLength(0);
      expect(snapshot.notifications).toHaveLength(0);
    });

    it("should initialize with default user context", () => {
      const context = store.getUserContext();

      expect(context).toEqual({
        stressLevel: "medium",
        energyLevel: "medium",
        mode: "balanced"
      });
    });
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

  describe("recordEvent", () => {
    it("should add event to events list", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: now.toISOString(),
        payload: { title: "Test Assignment" }
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(1);
      expect(snapshot.events[0]).toEqual(event);
    });

    it("should mark agent as idle after recording event", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.markAgentRunning("notes");

      const event: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: now.toISOString(),
        payload: {}
      };

      store.recordEvent(event);

      const snapshot = store.getSnapshot();
      const notesAgent = snapshot.agentStates.find((s) => s.name === "notes");

      expect(notesAgent?.status).toBe("idle");
      expect(notesAgent?.lastEvent).toEqual(event);
    });

    it("should maintain events in reverse chronological order", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "notes",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: "2024-01-15T10:00:00Z",
        payload: {}
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "lecture-plan",
        eventType: "lecture.reminder",
        priority: "medium",
        timestamp: "2024-01-15T11:00:00Z",
        payload: {}
      };

      store.recordEvent(event1);
      store.recordEvent(event2);

      const snapshot = store.getSnapshot();
      expect(snapshot.events[0]).toEqual(event2);
      expect(snapshot.events[1]).toEqual(event1);
    });

    it("should enforce maximum of 100 events", () => {
      for (let i = 0; i < 150; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "notes",
          eventType: "assignment.deadline",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: {}
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.events).toHaveLength(100);
      expect(snapshot.events[0].id).toBe("evt-149");
      expect(snapshot.events[99].id).toBe("evt-50");
    });
  });

  describe("pushNotification", () => {
    it("should add notification with id and timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      store.pushNotification({
        title: "Test Notification",
        message: "This is a test",
        priority: "high",
        source: "notes"
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(1);

      const notification = snapshot.notifications[0];
      expect(notification.title).toBe("Test Notification");
      expect(notification.message).toBe("This is a test");
      expect(notification.priority).toBe("high");
      expect(notification.source).toBe("notes");
      expect(notification.id).toMatch(/^notif-/);
      expect(notification.timestamp).toBe(now.toISOString());
    });

    it("should maintain notifications in reverse chronological order", () => {
      vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));

      store.pushNotification({
        title: "First",
        message: "First notification",
        priority: "medium",
        source: "notes"
      });

      vi.setSystemTime(new Date("2024-01-15T11:00:00Z"));

      store.pushNotification({
        title: "Second",
        message: "Second notification",
        priority: "high",
        source: "lecture-plan"
      });

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications[0].title).toBe("Second");
      expect(snapshot.notifications[1].title).toBe("First");
    });

    it("should enforce maximum of 40 notifications", () => {
      for (let i = 0; i < 50; i++) {
        store.pushNotification({
          title: `Notification ${i}`,
          message: "Test",
          priority: "medium",
          source: "notes"
        });
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.notifications).toHaveLength(40);
      expect(snapshot.notifications[0].title).toBe("Notification 49");
      expect(snapshot.notifications[39].title).toBe("Notification 10");
    });
  });

  describe("setUserContext and getUserContext", () => {
    it("should update user context", () => {
      const newContext: Partial<UserContext> = {
        stressLevel: "high",
        mode: "focus"
      };

      const result = store.setUserContext(newContext);

      expect(result).toEqual({
        stressLevel: "high",
        energyLevel: "medium",
        mode: "focus"
      });
    });

    it("should merge partial updates with existing context", () => {
      store.setUserContext({ stressLevel: "high" });
      const context = store.getUserContext();

      expect(context.stressLevel).toBe("high");
      expect(context.energyLevel).toBe("medium");
      expect(context.mode).toBe("balanced");
    });

    it("should allow multiple sequential updates", () => {
      store.setUserContext({ stressLevel: "high" });
      store.setUserContext({ mode: "recovery" });
      store.setUserContext({ energyLevel: "low" });

      const context = store.getUserContext();

      expect(context).toEqual({
        stressLevel: "high",
        energyLevel: "low",
        mode: "recovery"
      });
    });
  });

  describe("getSnapshot", () => {
    it("should include generated timestamp", () => {
      const now = new Date("2024-01-15T10:00:00Z");
      vi.setSystemTime(now);

      const snapshot = store.getSnapshot();

      expect(snapshot.generatedAt).toBe(now.toISOString());
    });

    it("should calculate todayFocus based on mode", () => {
      store.setUserContext({ mode: "focus" });
      let snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Deep work + assignment completion");

      store.setUserContext({ mode: "recovery" });
      snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Light planning + recovery tasks");

      store.setUserContext({ mode: "balanced" });
      snapshot = store.getSnapshot();
      expect(snapshot.summary.todayFocus).toBe("Balanced schedule with deadlines first");
    });

    it("should count pending deadlines", () => {
      const event1: AgentEvent = {
        id: "evt-1",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      const event2: AgentEvent = {
        id: "evt-2",
        source: "assignment-tracker",
        eventType: "assignment.deadline",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      const event3: AgentEvent = {
        id: "evt-3",
        source: "notes",
        eventType: "note.created",
        priority: "low",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event1);
      store.recordEvent(event2);
      store.recordEvent(event3);

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.pendingDeadlines).toBe(2);
    });

    it("should calculate meal compliance based on food nudges", () => {
      const snapshot1 = store.getSnapshot();
      expect(snapshot1.summary.mealCompliance).toBe(100);

      const event1: AgentEvent = {
        id: "evt-1",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event1);
      const snapshot2 = store.getSnapshot();
      expect(snapshot2.summary.mealCompliance).toBe(92);

      const event2: AgentEvent = {
        id: "evt-2",
        source: "food-tracking",
        eventType: "food.nudge",
        priority: "medium",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event2);
      const snapshot3 = store.getSnapshot();
      expect(snapshot3.summary.mealCompliance).toBe(84);
    });

    it("should have minimum meal compliance of 10", () => {
      for (let i = 0; i < 20; i++) {
        const event: AgentEvent = {
          id: `evt-${i}`,
          source: "food-tracking",
          eventType: "food.nudge",
          priority: "medium",
          timestamp: new Date().toISOString(),
          payload: {}
        };
        store.recordEvent(event);
      }

      const snapshot = store.getSnapshot();
      expect(snapshot.summary.mealCompliance).toBe(10);
    });

    it("should detect if digest is ready", () => {
      const snapshot1 = store.getSnapshot();
      expect(snapshot1.summary.digestReady).toBe(false);

      const event: AgentEvent = {
        id: "evt-1",
        source: "video-editor",
        eventType: "video.digest-ready",
        priority: "high",
        timestamp: new Date().toISOString(),
        payload: {}
      };

      store.recordEvent(event);

      const snapshot2 = store.getSnapshot();
      expect(snapshot2.summary.digestReady).toBe(true);
    });

    it("should include all agent states", () => {
      const snapshot = store.getSnapshot();

      const expectedAgents = [
        "notes",
        "lecture-plan",
        "assignment-tracker",
        "food-tracking",
        "social-highlights",
        "video-editor",
        "orchestrator"
      ];

      expect(snapshot.agentStates.map((s) => s.name)).toEqual(expectedAgents);
    });
  });
});
