import { beforeEach, describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Routine Presets", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("creates and retrieves routine presets", () => {
    const preset = store.createRoutinePreset({
      title: "Morning gym",
      preferredStartTime: "07:00",
      durationMinutes: 60,
      workload: "medium",
      weekdays: [1, 3, 5],
      active: true
    });

    expect(preset.id).toMatch(/^routine-/);
    expect(preset.weekdays).toEqual([1, 3, 5]);
    expect(store.getRoutinePresetById(preset.id)?.title).toBe("Morning gym");
    expect(store.getRoutinePresets()).toHaveLength(1);
  });

  it("updates routine preset fields and normalizes weekdays", () => {
    const preset = store.createRoutinePreset({
      title: "Nightly review",
      preferredStartTime: "21:00",
      durationMinutes: 45,
      workload: "low",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      active: true
    });

    const updated = store.updateRoutinePreset(preset.id, {
      title: "Evening review",
      durationMinutes: 50,
      weekdays: [5, 1, 1, 7, -1]
    });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Evening review");
    expect(updated?.durationMinutes).toBe(50);
    expect(updated?.weekdays).toEqual([1, 5]);
  });

  it("defaults invalid weekdays to all days", () => {
    const preset = store.createRoutinePreset({
      title: "Daily planning",
      preferredStartTime: "08:30",
      durationMinutes: 30,
      workload: "low",
      weekdays: [9, -2] as number[],
      active: true
    });

    expect(preset.weekdays).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
