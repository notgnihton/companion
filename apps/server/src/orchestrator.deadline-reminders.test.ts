import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";

describe("OrchestratorRuntime - deadline reminder checks", () => {
  let store: RuntimeStore;
  let orchestrator: OrchestratorRuntime;

  beforeEach(() => {
    store = new RuntimeStore();
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
      completed: false
    });

    orchestrator.start();
    await vi.advanceTimersByTimeAsync(100);

    const reminders = store
      .getSnapshot()
      .notifications.filter((notification) => notification.title === "Deadline status check");

    expect(reminders.length).toBe(1);
    expect(reminders[0].message).toContain(`/api/deadlines/${deadline.id}/confirm-status`);
  });

  it("does not emit duplicate reminders during cooldown window", async () => {
    store.createDeadline({
      course: "Physics",
      task: "Problem set",
      dueDate: "2026-03-10T08:00:00.000Z",
      priority: "critical",
      completed: false
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
