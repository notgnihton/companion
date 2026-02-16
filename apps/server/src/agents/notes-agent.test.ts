import { describe, it, expect, vi, beforeEach } from "vitest";
import { NotesAgent } from "./notes-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";
import { RuntimeStore } from "../store.js";

describe("NotesAgent", () => {
  let agent: NotesAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];
  let mockStore: RuntimeStore;

  beforeEach(() => {
    agent = new NotesAgent();
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
      expect(agent.name).toBe("notes");
    });

    it("should have correct interval", () => {
      expect(agent.intervalMs).toBe(30_000);
    });
  });

  describe("run", () => {
    it("should emit a note prompt event", async () => {
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];

      expect(event.source).toBe("notes");
      expect(event.eventType).toBe("note.prompt");
      expect(event.id).toMatch(/^notes-/);
    });

    it("should emit event with prompt data", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("prompt");
      expect(typeof payload.prompt).toBe("string");
      expect(payload.prompt.length).toBeGreaterThan(0);
    });

    it("should emit low priority events", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("low");
    });

    it("should select from available prompts", async () => {
      const validPrompts = [
        "Capture one thought from your morning that might matter later.",
        "Review yesterday's notes and tag one actionable item.",
        "You had a productive block yesterday. Write what made it work."
      ];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validPrompts).toContain(payload.prompt);
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
        expect(event.source).toBe("notes");
        expect(event.eventType).toBe("note.prompt");
        expect(event.priority).toBe("low");
      });
    });

    it("should generate different prompts on multiple runs", async () => {
      const iterations = 20;
      const prompts = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        emittedEvents = [];
    mockStore = new RuntimeStore();
        await agent.run(mockContext);
        const payload = emittedEvents[0].payload as any;
        prompts.add(payload.prompt);
      }

      // With 20 iterations and 3 possible prompts, we should see more than 1 prompt
      expect(prompts.size).toBeGreaterThan(1);
    });
  });

  describe("prompt variations", () => {
    it("should include morning capture prompt", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.1); // Force first prompt

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.prompt).toBe("Capture one thought from your morning that might matter later.");

      mockRandom.mockRestore();
    });

    it("should include review prompt", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.4); // Force second prompt

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.prompt).toBe("Review yesterday's notes and tag one actionable item.");

      mockRandom.mockRestore();
    });

    it("should include productive block prompt", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.9); // Force third prompt

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.prompt).toBe("You had a productive block yesterday. Write what made it work.");

      mockRandom.mockRestore();
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
