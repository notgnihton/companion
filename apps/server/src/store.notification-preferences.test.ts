import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - notification preferences", () => {
  let store: RuntimeStore;
  const userId = "test-user";

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies priority and category filters", () => {
    store.setNotificationPreferences(userId, {
      minimumPriority: "high",
      categoryToggles: {
        notes: false
      }
    });

    expect(
      store.shouldDispatchNotification(userId, {
        id: "n1",
        title: "t",
        message: "m",
        source: "notes",
        priority: "critical",
        timestamp: "2026-01-10T12:00:00.000Z"
      })
    ).toBe(false);

    expect(
      store.shouldDispatchNotification(userId, {
        id: "n2",
        title: "t",
        message: "m",
        source: "orchestrator",
        priority: "medium",
        timestamp: "2026-01-10T12:00:00.000Z"
      })
    ).toBe(false);

    expect(
      store.shouldDispatchNotification(userId, {
        id: "n3",
        title: "t",
        message: "m",
        source: "orchestrator",
        priority: "high",
        timestamp: "2026-01-10T12:00:00.000Z"
      })
    ).toBe(true);
  });

  it("respects quiet hours with critical override", () => {
    store.setNotificationPreferences(userId, {
      quietHours: {
        enabled: true,
        startHour: 22,
        endHour: 7
      },
      allowCriticalInQuietHours: true
    });

    expect(
      store.shouldDispatchNotification(userId, {
        id: "n4",
        title: "t",
        message: "m",
        source: "assignment-tracker",
        priority: "high",
        timestamp: "2026-01-10T23:30:00.000Z"
      })
    ).toBe(false);

    expect(
      store.shouldDispatchNotification(userId, {
        id: "n5",
        title: "t",
        message: "m",
        source: "assignment-tracker",
        priority: "critical",
        timestamp: "2026-01-10T23:30:00.000Z"
      })
    ).toBe(true);
  });
});
