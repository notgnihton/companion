import { describe, it, expect, vi, beforeEach } from "vitest";
import { LecturePlanAgent } from "./lecture-plan-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";
import { RuntimeStore } from "../store.js";

describe("LecturePlanAgent", () => {
  let agent: LecturePlanAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];
  let mockStore: RuntimeStore;

  beforeEach(() => {
    agent = new LecturePlanAgent();
    emittedEvents = [];
    mockStore = new RuntimeStore();
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      },
      getStore: () => mockStore
    };
  });

  describe("configuration", () => {
    it("should have correct agent name", () => {
      expect(agent.name).toBe("lecture-plan");
    });

    it("should have correct interval", () => {
      expect(agent.intervalMs).toBe(35_000);
    });
  });

  describe("run", () => {
    it("should emit a lecture reminder event", async () => {
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];

      expect(event.source).toBe("lecture-plan");
      expect(event.eventType).toBe("lecture.reminder");
      expect(event.id).toMatch(/^lecture-plan-/);
    });

    it("should emit event with lecture data", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("title");
      expect(payload).toHaveProperty("minutesUntil");
      expect(payload).toHaveProperty("workload");
    });

    it("should emit high priority for lectures starting soon", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      
      // Force selection of "Systems Design" with minutesUntil: 45
      mockRandom.mockReturnValue(0.9);

      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("high");

      mockRandom.mockRestore();
    });

    it("should emit medium priority for lectures starting later", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      
      // Force selection of "Data Structures" with minutesUntil: 90
      mockRandom.mockReturnValue(0.1);

      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("medium");

      mockRandom.mockRestore();
    });

    it("should select from available lecture hints", async () => {
      const validTitles = ["Data Structures", "Linear Algebra", "Systems Design"];
      const validWorkloads = ["medium", "high"];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validTitles).toContain(payload.title);
      expect(validWorkloads).toContain(payload.workload);
      expect(typeof payload.minutesUntil).toBe("number");
      expect(payload.minutesUntil).toBeGreaterThan(0);
    });

    it("should emit events with valid timestamps", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      
      const timestamp = new Date(event.timestamp);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    it("should be callable multiple times", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(3);
      
      emittedEvents.forEach((event) => {
        expect(event.source).toBe("lecture-plan");
        expect(event.eventType).toBe("lecture.reminder");
      });
    });

    it("should generate different events on multiple runs", async () => {
      const iterations = 20;
      const titles = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        emittedEvents = [];
    mockStore = new RuntimeStore();
        await agent.run(mockContext);
        const payload = emittedEvents[0].payload as any;
        titles.add(payload.title);
      }

      // With 20 iterations and 3 possible titles, we should see more than 1 title
      expect(titles.size).toBeGreaterThan(1);
    });
  });

  describe("edge cases", () => {
    it("should handle context emit being called", async () => {
      let emitCalled = false;
      const testContext: AgentContext = {
        emit: () => {
          emitCalled = true;
        },
        getStore: () => new RuntimeStore()
      };

      await agent.run(testContext);

      expect(emitCalled).toBe(true);
    });

    it("should complete run without throwing errors", async () => {
      await expect(agent.run(mockContext)).resolves.not.toThrow();
    });
  });
});
