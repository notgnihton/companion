import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - context trends", () => {
  const userId = "test-user";
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates history by hour and day of week", () => {
    const mondayMorning = new Date("2026-02-16T08:00:00.000Z");
    vi.setSystemTime(mondayMorning);
    store.setUserContext(userId, { energyLevel: "high", stressLevel: "low" });

    const mondayEvening = new Date("2026-02-16T20:00:00.000Z");
    vi.setSystemTime(mondayEvening);
    store.setUserContext(userId, { energyLevel: "medium", stressLevel: "high" });

    const tuesdayMorning = new Date("2026-02-17T08:30:00.000Z");
    vi.setSystemTime(tuesdayMorning);
    store.setUserContext(userId, { energyLevel: "high", stressLevel: "medium" });

    const trends = store.getContextTrends(userId);

    expect(trends.sampleSize).toBe(3);

    const hourBucket = trends.byHour.find((bucket) => bucket.hour === mondayMorning.getUTCHours());
    expect(hourBucket?.energyLevels.high).toBe(2);
    expect(hourBucket?.stressLevels.low).toBe(1);
    expect(hourBucket?.stressLevels.medium).toBe(1);

    const mondayBucket = trends.byDayOfWeek.find((bucket) => bucket.dayOfWeek === mondayMorning.getUTCDay());
    expect(mondayBucket?.total).toBe(2);
    expect(mondayBucket?.stressLevels.high).toBe(1);

    const tuesdayBucket = trends.byDayOfWeek.find((bucket) => bucket.dayOfWeek === tuesdayMorning.getUTCDay());
    expect(tuesdayBucket?.energyLevels.high).toBe(1);

    expect(trends.recommendations.bestNotificationHours).toContain(mondayMorning.getUTCHours());
  });

  it("returns empty aggregates when no history exists", () => {
    const trends = store.getContextTrends(userId);

    expect(trends.sampleSize).toBe(0);
    expect(trends.byHour).toHaveLength(0);
    expect(trends.byDayOfWeek).toHaveLength(0);
    expect(trends.recommendations.bestNotificationHours).toHaveLength(0);
    expect(trends.latestContext).toBeDefined();
  });
});
