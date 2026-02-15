import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - push delivery tracking", () => {
  it("tracks delivery counters and recent failures", () => {
    const store = new RuntimeStore(":memory:");

    const notification = {
      id: "notif-1",
      title: "Heads up",
      message: "Message",
      priority: "medium" as const,
      source: "orchestrator" as const,
      timestamp: "2026-02-15T02:00:00.000Z"
    };

    store.recordPushDeliveryResult("https://push.example/s1", notification, {
      delivered: true,
      shouldDropSubscription: false,
      retries: 1,
      attempts: 2
    });

    store.recordPushDeliveryResult("https://push.example/s2", notification, {
      delivered: false,
      shouldDropSubscription: true,
      retries: 2,
      attempts: 3,
      statusCode: 410,
      error: "Gone"
    });

    const metrics = store.getPushDeliveryMetrics();

    expect(metrics.attempted).toBe(2);
    expect(metrics.delivered).toBe(1);
    expect(metrics.failed).toBe(1);
    expect(metrics.droppedSubscriptions).toBe(1);
    expect(metrics.totalRetries).toBe(3);
    expect(metrics.recentFailures).toHaveLength(1);
    expect(metrics.recentFailures[0].statusCode).toBe(410);
    expect(metrics.recentFailures[0].attempts).toBe(3);
  });
});
