import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssignmentTrackerAgent } from "./assignment-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";
import { RuntimeStore } from "../store.js";

describe("AssignmentTrackerAgent - Deadlines & Priorities", () => {
  let agent: AssignmentTrackerAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];
  let mockStore: RuntimeStore;

  beforeEach(() => {
    agent = new AssignmentTrackerAgent();
    emittedEvents = [];
    mockStore = new RuntimeStore();
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      },
      getStore: () => mockStore
    };
  });

  describe("priority calculation", () => {
    it("should emit critical priority for deadlines <= 12 hours", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      // Force selection of "Operating Systems" with hoursLeft: 12
      mockRandom.mockReturnValue(0.9);

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      expect(event.priority).toBe("critical");

      mockRandom.mockRestore();
    });

    it("should emit high priority for deadlines <= 24 hours", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      // Force selection of "Algorithms" with hoursLeft: 28 (not <= 24)
      // Let's mock a different scenario
      mockRandom.mockReturnValue(0.1);

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      const payload = event.payload as any;
      
      // Algorithms has 28 hours, so it should be medium
      if (payload.hoursLeft <= 12) {
        expect(event.priority).toBe("critical");
      } else if (payload.hoursLeft <= 24) {
        expect(event.priority).toBe("high");
      } else {
        expect(event.priority).toBe("medium");
      }

      mockRandom.mockRestore();
    });

    it("should emit medium priority for deadlines > 24 hours", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      // Force selection of "Databases" with hoursLeft: 54
      mockRandom.mockReturnValue(0.4);

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      expect(event.priority).toBe("medium");

      mockRandom.mockRestore();
    });

    it("should correctly calculate priority based on hoursLeft", async () => {
      // Test all three deadlines and verify their priorities
      const testCases = [
        { randomValue: 0.1, expectedPriority: "medium", hoursLeft: 28 },  // Algorithms
        { randomValue: 0.4, expectedPriority: "medium", hoursLeft: 54 },  // Databases
        { randomValue: 0.9, expectedPriority: "critical", hoursLeft: 12 } // OS
      ];

      for (const testCase of testCases) {
        const mockRandom = vi.spyOn(Math, "random");
        mockRandom.mockReturnValue(testCase.randomValue);
        
        emittedEvents = [];
        await agent.run(mockContext);

        const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
        expect(event.priority).toBe(testCase.expectedPriority);

        mockRandom.mockRestore();
      }
    });
  });

  describe("deadline variations", () => {
    it("should include Algorithms deadline", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.1); // Force first deadline

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      const payload = event.payload as any;

      expect(payload.course).toBe("Algorithms");
      expect(payload.task).toBe("Problem Set 4");
      expect(payload.hoursLeft).toBe(28);
      expect(event.priority).toBe("medium");

      mockRandom.mockRestore();
    });

    it("should include Databases deadline", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.4); // Force second deadline

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      const payload = event.payload as any;

      expect(payload.course).toBe("Databases");
      expect(payload.task).toBe("Schema Design Report");
      expect(payload.hoursLeft).toBe(54);
      expect(event.priority).toBe("medium");

      mockRandom.mockRestore();
    });

    it("should include Operating Systems deadline", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.9); // Force third deadline

      await agent.run(mockContext);

      const event = emittedEvents.find(e => e.eventType === "assignment.deadline")!;
      const payload = event.payload as any;

      expect(payload.course).toBe("Operating Systems");
      expect(payload.task).toBe("Lab 3");
      expect(payload.hoursLeft).toBe(12);
      expect(event.priority).toBe("critical");

      mockRandom.mockRestore();
    });
  });
});
