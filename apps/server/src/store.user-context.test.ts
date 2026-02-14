import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - User Context", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return default user context", () => {
    const context = store.getUserContext();
    expect(context).toEqual({
      stressLevel: "medium",
      energyLevel: "medium",
      mode: "balanced",
    });
  });

  it("should update user context partially", () => {
    store.setUserContext({ stressLevel: "high" });

    const context = store.getUserContext();
    expect(context).toEqual({
      stressLevel: "high",
      energyLevel: "medium",
      mode: "balanced",
    });
  });

  it("should update multiple fields", () => {
    store.setUserContext({
      stressLevel: "low",
      energyLevel: "high",
      mode: "focus",
    });

    const context = store.getUserContext();
    expect(context).toEqual({
      stressLevel: "low",
      energyLevel: "high",
      mode: "focus",
    });
  });

  it("should return updated context from setUserContext", () => {
    const updated = store.setUserContext({ mode: "recovery" });
    expect(updated.mode).toBe("recovery");
    expect(updated.stressLevel).toBe("medium");
    expect(updated.energyLevel).toBe("medium");
  });

  it("should preserve context across multiple updates", () => {
    store.setUserContext({ stressLevel: "high" });
    store.setUserContext({ energyLevel: "low" });
    store.setUserContext({ mode: "recovery" });

    const context = store.getUserContext();
    expect(context).toEqual({
      stressLevel: "high",
      energyLevel: "low",
      mode: "recovery",
    });
  });
});
