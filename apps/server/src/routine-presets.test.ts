import { beforeEach, describe, expect, it } from "vitest";
import { applyRoutinePresetPlacements } from "./routine-presets.js";
import { RuntimeStore } from "./store.js";

describe("routine-presets placement", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  it("places routines into nearest free slot without overlapping fixed lectures", () => {
    const now = new Date("2026-02-17T06:00:00.000Z");
    const weekday = new Date("2026-02-17T00:00:00.000Z").getUTCDay();

    store.createLectureEvent(userId, {
      title: "DAT520 Lecture",
      startTime: "2026-02-17T07:00:00.000Z",
      durationMinutes: 60,
      workload: "medium"
    });
    const preset = store.createRoutinePreset(userId, {
      title: "Morning gym",
      preferredStartTime: "07:00",
      durationMinutes: 60,
      workload: "medium",
      weekdays: [weekday],
      active: true
    });

    const placement = applyRoutinePresetPlacements(store, userId, { now, horizonDays: 1, stepMinutes: 15 });
    const routineEvent = store
      .getScheduleEvents(userId)
      .find((event) => event.recurrenceParentId === `routine-preset:${preset.id}`);

    expect(placement.createdEvents).toBe(1);
    expect(routineEvent).toBeDefined();
    expect(routineEvent?.startTime).toBe("2026-02-17T08:00:00.000Z");
  });

  it("rebuilds generated routine blocks without duplicating events", () => {
    const now = new Date("2026-02-17T06:00:00.000Z");
    const weekday = new Date("2026-02-17T00:00:00.000Z").getUTCDay();

    const preset = store.createRoutinePreset(userId, {
      title: "Nightly review",
      preferredStartTime: "21:00",
      durationMinutes: 45,
      workload: "low",
      weekdays: [weekday],
      active: true
    });

    const first = applyRoutinePresetPlacements(store, userId, { now, horizonDays: 1 });
    const second = applyRoutinePresetPlacements(store, userId, { now, horizonDays: 1 });

    const routineEvents = store
      .getScheduleEvents(userId)
      .filter((event) => event.recurrenceParentId === `routine-preset:${preset.id}`);

    expect(first.createdEvents).toBe(1);
    expect(second.clearedEvents).toBe(1);
    expect(second.createdEvents).toBe(1);
    expect(routineEvents).toHaveLength(1);
  });
});
