import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { AgentName } from "./types.js";

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
      title: "Test Notification",
      message: "Test message",
      priority: "medium",
      source: "notes",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(1);
    expect(snapshot.notifications[0].title).toBe("Test Notification");
    expect(snapshot.notifications[0].message).toBe("Test message");
    expect(snapshot.notifications[0].priority).toBe("medium");
    expect(snapshot.notifications[0].source).toBe("notes");
    expect(snapshot.notifications[0].id).toMatch(/^notif-/);
    expect(snapshot.notifications[0].timestamp).toBe(now.toISOString());
  });

  it("should keep notifications in reverse chronological order", () => {
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    store.pushNotification({
      title: "First",
      message: "Message 1",
      priority: "low",
      source: "notes",
    });

    vi.setSystemTime(new Date("2024-01-15T11:00:00Z"));
    store.pushNotification({
      title: "Second",
      message: "Message 2",
      priority: "high",
      source: "orchestrator",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications[0].title).toBe("Second");
    expect(snapshot.notifications[1].title).toBe("First");
  });

  it("should limit notifications to maximum of 40", () => {
    for (let i = 0; i < 60; i++) {
      store.pushNotification({
        title: `Notification ${i}`,
        message: `Message ${i}`,
        priority: "medium",
        source: "notes",
      });
    }

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(40);
    expect(snapshot.notifications[0].title).toBe("Notification 59");
    expect(snapshot.notifications[39].title).toBe("Notification 20");
  });

  it("should handle all priority levels for notifications", () => {
    const priorities: Array<"low" | "medium" | "high" | "critical"> = [
      "low",
      "medium",
      "high",
      "critical",
    ];

    priorities.forEach((priority) => {
      store.pushNotification({
        title: `${priority} priority notification`,
        message: "Test message",
        priority,
        source: "notes",
      });
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(4);
    expect(snapshot.notifications[0].priority).toBe("critical");
    expect(snapshot.notifications[3].priority).toBe("low");
  });

  it("should handle notifications from all agent sources", () => {
    const agentNames: AgentName[] = [
      "notes",
      "lecture-plan",
      "assignment-tracker",
      "food-tracking",
      "social-highlights",
      "video-editor",
      "orchestrator",
    ];

    agentNames.forEach((source) => {
      store.pushNotification({
        title: `Notification from ${source}`,
        message: "Test message",
        priority: "medium",
        source,
      });
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications).toHaveLength(7);
    
    const sources = snapshot.notifications.map((n) => n.source);
    agentNames.reverse().forEach((name) => {
      expect(sources).toContain(name);
    });
  });

  it("should handle long notification messages", () => {
    const longMessage = "A".repeat(500);
    
    store.pushNotification({
      title: "Long message test",
      message: longMessage,
      priority: "medium",
      source: "notes",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications[0].message).toBe(longMessage);
    expect(snapshot.notifications[0].message.length).toBe(500);
  });

  it("should handle special characters in notification content", () => {
    const specialTitle = "Test <html> & \"quotes\" 'single'";
    const specialMessage = "Line1\nLine2\tTabbed";

    store.pushNotification({
      title: specialTitle,
      message: specialMessage,
      priority: "medium",
      source: "notes",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.notifications[0].title).toBe(specialTitle);
    expect(snapshot.notifications[0].message).toBe(specialMessage);
  });
});
