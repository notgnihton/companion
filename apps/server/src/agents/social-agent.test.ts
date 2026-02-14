import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocialHighlightsAgent } from "./social-agent.js";
import { AgentContext } from "../agent-base.js";
import { AgentEvent } from "../types.js";

describe("SocialHighlightsAgent", () => {
  let agent: SocialHighlightsAgent;
  let mockContext: AgentContext;
  let emittedEvents: AgentEvent[];

  beforeEach(() => {
    agent = new SocialHighlightsAgent();
    emittedEvents = [];
    mockContext = {
      emit: (event: AgentEvent) => {
        emittedEvents.push(event);
      }
    };
  });

  describe("configuration", () => {
    it("should have correct agent name", () => {
      expect(agent.name).toBe("social-highlights");
    });

    it("should have correct interval", () => {
      expect(agent.intervalMs).toBe(25_000);
    });
  });

  describe("run", () => {
    it("should emit a social highlight event", async () => {
      await agent.run(mockContext);

      expect(emittedEvents).toHaveLength(1);
      const event = emittedEvents[0];

      expect(event.source).toBe("social-highlights");
      expect(event.eventType).toBe("social.highlight");
      expect(event.id).toMatch(/^social-highlights-/);
    });

    it("should emit event with social media data", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload).toHaveProperty("platform");
      expect(payload).toHaveProperty("title");
      expect(payload).toHaveProperty("relevance");
    });

    it("should emit medium priority events", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      expect(event.priority).toBe("medium");
    });

    it("should select from available social topics", async () => {
      const validPlatforms = ["YouTube", "Reddit", "X"];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validPlatforms).toContain(payload.platform);
      expect(typeof payload.title).toBe("string");
      expect(payload.title.length).toBeGreaterThan(0);
    });

    it("should include relevance score", async () => {
      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(typeof payload.relevance).toBe("number");
      expect(payload.relevance).toBeGreaterThan(0);
      expect(payload.relevance).toBeLessThanOrEqual(1);
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
        expect(event.source).toBe("social-highlights");
        expect(event.eventType).toBe("social.highlight");
        expect(event.priority).toBe("medium");
      });
    });

    it("should generate different events on multiple runs", async () => {
      const iterations = 20;
      const platforms = new Set<string>();

      for (let i = 0; i < iterations; i++) {
        emittedEvents = [];
        await agent.run(mockContext);
        const payload = emittedEvents[0].payload as any;
        platforms.add(payload.platform);
      }

      // With 20 iterations and 3 possible platforms, we should see more than 1 platform
      expect(platforms.size).toBeGreaterThan(1);
    });

    it("should emit events with different relevance scores", async () => {
      const validRelevances = [0.86, 0.79, 0.73];

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(validRelevances).toContain(payload.relevance);
    });
  });

  describe("topic variations", () => {
    it("should include YouTube topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.1); // Force first topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("YouTube");
      expect(payload.title).toBe("AI tooling workflow update");
      expect(payload.relevance).toBe(0.86);

      mockRandom.mockRestore();
    });

    it("should include Reddit topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.4); // Force second topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("Reddit");
      expect(payload.title).toBe("Best study systems for CS students");
      expect(payload.relevance).toBe(0.79);

      mockRandom.mockRestore();
    });

    it("should include X (Twitter) topics", async () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.9); // Force third topic

      await agent.run(mockContext);

      const event = emittedEvents[0];
      const payload = event.payload as any;

      expect(payload.platform).toBe("X");
      expect(payload.title).toBe("Productivity thread with strong signal");
      expect(payload.relevance).toBe(0.73);

      mockRandom.mockRestore();
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
  });
});
