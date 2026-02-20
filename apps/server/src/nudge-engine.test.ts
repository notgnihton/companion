import { describe, expect, it } from "vitest";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { AgentEvent, UserContext } from "./types.js";

const defaultContext: UserContext = {
  stressLevel: "medium",
  energyLevel: "medium",
  mode: "balanced"
};

describe("buildContextAwareNudge", () => {
  it("adds a stress-aware assignment message and softens high priority", () => {
    const event: AgentEvent = {
      id: "evt-1",
      source: "assignment-tracker",
      eventType: "assignment.deadline",
      priority: "high",
      timestamp: "2026-02-16T10:00:00.000Z",
      payload: {
        task: "Problem Set 6",
        course: "Algorithms"
      }
    };

    const nudge = buildContextAwareNudge(event, {
      ...defaultContext,
      stressLevel: "high"
    });

    expect(nudge).not.toBeNull();
    expect(nudge?.title).toBe("Deadline alert");
    expect(nudge?.message).toMatch(/One step at a time is enough/);
    expect(nudge?.priority).toBe("medium");
  });

  it("raises assignment urgency for focus mode with high energy", () => {
    const event: AgentEvent = {
      id: "evt-2",
      source: "assignment-tracker",
      eventType: "assignment.deadline",
      priority: "medium",
      timestamp: "2026-02-16T10:00:00.000Z",
      payload: {
        task: "Lab prep",
        course: "Systems"
      }
    };

    const nudge = buildContextAwareNudge(event, {
      ...defaultContext,
      mode: "focus",
      energyLevel: "high"
    });

    expect(nudge).not.toBeNull();
    expect(nudge?.priority).toBe("high");
    expect(nudge?.message).toMatch(/Lock in one focused block/);
  });

  it("uses focused note prompts when mode is focus", () => {
    const event: AgentEvent = {
      id: "evt-3",
      source: "notes",
      eventType: "note.prompt",
      priority: "low",
      timestamp: "2026-02-16T10:00:00.000Z",
      payload: {
        prompt: "How is your session going?"
      }
    };

    const nudge = buildContextAwareNudge(event, {
      ...defaultContext,
      mode: "focus"
    });

    expect(nudge).not.toBeNull();
    expect(nudge?.title).toBe("Reflection prompt");
    expect(nudge?.priority).toBe("medium");
    expect(nudge?.message).toMatch(/Capture one concise update/);
  });

  it("returns null for unknown event types", () => {
    const event: AgentEvent = {
      id: "evt-4",
      source: "orchestrator",
      eventType: "unknown.event",
      priority: "low",
      timestamp: "2026-02-16T10:00:00.000Z",
      payload: {}
    };

    expect(buildContextAwareNudge(event, defaultContext)).toBeNull();
  });
});
