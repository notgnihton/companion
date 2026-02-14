import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Notification System", () => {
  let store: RuntimeStore;

  beforeEach(() => {
    store = new RuntimeStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should push a notification with generated id and timestamp", () => {
    const now = new Date("2024-01-15T10:00:00Z");
    vi.setSystemTime(now);

    store.pushNotification({
      type: "info",
      title: "Test Notification",
      message: "Test message",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(1);
    expect(snapshot.notifications[0].title).toBe("Test Notification");
    expect(snapshot.notifications[0].message).toBe("Test message");
    expect(snapshot.notifications[0].type).toBe("info");
    expect(snapshot.notifications[0].id).toMatch(/^notif-/);
    expect(snapshot.notifications[0].timestamp).toBe(now.toISOString());
  });

  it("should keep notifications in reverse chronological order", () => {
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    store.pushNotification({
      type: "info",
      title: "First",
      message: "Message 1",
    });

    vi.setSystemTime(new Date("2024-01-15T11:00:00Z"));
    store.pushNotification({
      type: "warning",
      title: "Second",
      message: "Message 2",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications[0].title).toBe("Second");
    expect(snapshot.notifications[1].title).toBe("First");
  });

  it("should limit notifications to maximum of 40", () => {
    for (let i = 0; i < 60; i++) {
      store.pushNotification({
        type: "info",
        title: `Notification ${i}`,
        message: `Message ${i}`,
      });
    }

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(40);
    expect(snapshot.notifications[0].title).toBe("Notification 59");
    expect(snapshot.notifications[39].title).toBe("Notification 20");
  });
});
