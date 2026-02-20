import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";
import { Notification } from "./types.js";

describe("OrchestratorRuntime - deadline reminder checks", () => {
  let store: RuntimeStore;
  let orchestrator: OrchestratorRuntime;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    orchestrator = new OrchestratorRuntime(store);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T12:00:00.000Z"));
  });

  afterEach(() => {
    orchestrator.stop();
    vi.useRealTimers();
  });

  it("emits a status-check notification for overdue incomplete deadlines", async () => {
    const deadline = store.createDeadline({
      course: "Operating Systems",
      task: "Lab report",
      dueDate: "2026-03-10T09:00:00.000Z",
      priority: "high",
      completed: false,
      canvasAssignmentId: 2001
    });

    const received: Notification[] = [];
    const unsubscribe = store.onNotification((notification) => {
      received.push(notification);
    });

    orchestrator.start();
    await vi.advanceTimersByTimeAsync(100);
    unsubscribe();

    const reminders = store
      .getSnapshot()
      .notifications.filter((notification) => notification.title === "Deadline status check");

    expect(reminders.length).toBe(1);
    expect(reminders[0].message).toContain("Mark complete");

    const reminder = received.find((notification) => notification.title === "Deadline status check");
    expect(reminder?.actions).toEqual(["complete", "working", "view"]);
    expect(reminder?.metadata?.deadlineId).toBe(deadline.id);
  });

  it("does not emit duplicate reminders during cooldown window", async () => {
    store.createDeadline({
      course: "Physics",
      task: "Problem set",
      dueDate: "2026-03-10T08:00:00.000Z",
      priority: "critical",
      completed: false,
      canvasAssignmentId: 2002
    });

    orchestrator.start();
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    const reminders = store
      .getSnapshot()
      .notifications.filter((notification) => notification.title === "Deadline status check");

    expect(reminders.length).toBe(1);
  });
});
