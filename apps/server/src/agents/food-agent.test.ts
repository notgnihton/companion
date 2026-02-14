import { describe, it, expect, vi, beforeEach } from "vitest";
import { FoodTrackingAgent } from "./food-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("FoodTrackingAgent", () => {
  let agent: FoodTrackingAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];

  beforeEach(() => {
    agent = new FoodTrackingAgent();
    emittedEvents = [];
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      }
    };
  });

  describe("configuration", () => {
    it("should have correct agent name", () => {
      expect(agent.name).toBe("food-tracking");
    });

    it("should have correct interval", () => {
      expect(agent.intervalMs).toBe(40_000);
    });
  });

  describe("run", () => {
    it("should emit a food nudge event", async () => {
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];

      expect(event.source).toBe("food-tracking");
      expect(event.eventType).toBe("food.nudge");
      expect(event.id).toMatch(/^food-tracking-/);
    });

    it("should emit event with message data", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("message");
      expect(typeof payload.message).toBe("string");
      expect(payload.message).toBe("Log your meal");
    });

    it("should emit low priority events", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("low");
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
        expect(event.source).toBe("food-tracking");
        expect(event.eventType).toBe("food.nudge");
        expect(event.priority).toBe("low");
      });
    });

    it("should emit consistent message on each run", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);

      const payload1 = emittedEvents[0].payload as any;
      const payload2 = emittedEvents[1].payload as any;

      expect(payload1.message).toBe(payload2.message);
      expect(payload1.message).toBe("Log your meal");
    });

    it("should generate unique event IDs on each run", async () => {
      await agent.run(mockContext);
      await agent.run(mockContext);
      await agent.run(mockContext);

      const ids = emittedEvents.map((e) => e.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("edge cases", () => {
    it("should handle context emit being called", async () => {
      let emitCalled = false;
      const testContext: AgentContext = {
        emit: () => {
          emitCalled = true;
        }
      };

      await agent.run(testContext);

      expect(emitCalled).toBe(true);
    });

    it("should complete run without throwing errors", async () => {
      await expect(agent.run(mockContext)).resolves.not.toThrow();
    });

    it("should not mutate the context", async () => {
      const originalEmit = mockContext.emit;
      
      await agent.run(mockContext);
      
      expect(mockContext.emit).toBe(originalEmit);
    });

    it("should emit event immediately without delay", async () => {
      const startTime = Date.now();
      
      await agent.run(mockContext);
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Should complete quickly (within 100ms)
      expect(executionTime).toBeLessThan(100);
      expect(emittedEvents).toHaveLength(1);
    });
  });

  describe("event structure", () => {
    it("should emit events with all required fields", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];

      expect(event).toHaveProperty("id");
      expect(event).toHaveProperty("source");
      expect(event).toHaveProperty("eventType");
      expect(event).toHaveProperty("priority");
      expect(event).toHaveProperty("timestamp");
      expect(event).toHaveProperty("payload");
    });

    it("should emit events with correct types", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];

      expect(typeof event.id).toBe("string");
      expect(typeof event.source).toBe("string");
      expect(typeof event.eventType).toBe("string");
      expect(typeof event.priority).toBe("string");
      expect(typeof event.timestamp).toBe("string");
      expect(typeof event.payload).toBe("object");
    });

    it("should have valid priority value", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const validPriorities = ["low", "medium", "high", "critical"];

      expect(validPriorities).toContain(event.priority);
    });
  });
});
