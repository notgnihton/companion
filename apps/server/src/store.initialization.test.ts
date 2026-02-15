import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Initialization", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should initialize with correct default state", () => {
    const snapshot = store.getSnapshot();

    expect(snapshot.agentStates).toHaveLength(4);
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
