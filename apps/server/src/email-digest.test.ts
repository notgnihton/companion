import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailDigestService } from "./email-digest.js";
import { RuntimeStore } from "./store.js";

describe("EmailDigestService", () => {
  const userId = "test-user";

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-20T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a daily digest when push delivery fails", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new EmailDigestService(store, userId);

    store.createDeadline(userId, {
      course: "Algorithms",
      task: "Assignment 1",
      dueDate: "2026-02-21T09:00:00.000Z",
      priority: "high",
      completed: false
    });

    store.recordPushDeliveryResult(
      "https://push.example/subscription",
      {
        id: "notif-1",
        source: "orchestrator",
        title: "Heads up",
        message: "Check your tasks",
        priority: "medium",
        timestamp: new Date().toISOString()
      },
      {
        delivered: false,
        shouldDropSubscription: true,
        attempts: 1,
        retries: 0,
        statusCode: 410,
        error: "Gone"
      }
    );

    await service.runOnce(new Date("2026-02-20T12:00:00.000Z"));

    const digests = store.getEmailDigests(userId);
    expect(digests).toHaveLength(1);
    expect(digests[0].type).toBe("daily");
    expect(digests[0].reason).toBe("push-failures");
    expect(digests[0].body).toContain("Assignment 1");
  });

  it("sends a weekly digest on inactive Sundays", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new EmailDigestService(store, userId);

    store.recordChatMessage(userId, "user", "Finished the first draft of the report");
    vi.setSystemTime(new Date("2026-02-22T18:00:00.000Z"));

    await service.runOnce(new Date("2026-02-22T18:00:00.000Z"));

    const weekly = store.getEmailDigests(userId).find((digest) => digest.type === "weekly");
    expect(weekly).toBeTruthy();
    expect(weekly?.reason).toBe("inactivity");
    expect(weekly?.body).toContain("Finished the first draft of the report");
  });

  it("respects the daily cooldown to avoid duplicate digests", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new EmailDigestService(store, userId);

    store.recordPushDeliveryResult(
      "https://push.example/subscription",
      {
        id: "notif-2",
        source: "orchestrator",
        title: "Reminder",
        message: "Finish tasks",
        priority: "high",
        timestamp: new Date().toISOString()
      },
      {
        delivered: false,
        shouldDropSubscription: false,
        attempts: 1,
        retries: 0,
        error: "Network issue"
      }
    );

    await service.runOnce(new Date("2026-02-20T12:00:00.000Z"));
    await service.runOnce(new Date("2026-02-20T18:00:00.000Z"));

    const dailyDigests = store.getEmailDigests(userId).filter((digest) => digest.type === "daily");
    expect(dailyDigests).toHaveLength(1);
  });
});
