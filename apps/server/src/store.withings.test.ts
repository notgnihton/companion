import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";

describe("RuntimeStore - Withings tokens and sync data", () => {
  const userId = "test-user";

  it("preserves Withings tokens when writing synced health data", () => {
    const store = new RuntimeStore(":memory:");

    store.setWithingsTokens(userId, {
      refreshToken: "refresh-token",
      accessToken: "access-token",
      tokenExpiresAt: "2026-02-18T20:00:00.000Z",
      userId: "12345",
      scope: "user.metrics,user.sleepevents",
      connectedAt: "2026-02-18T17:00:00.000Z",
      source: "oauth"
    });

    store.setWithingsData(userId,
      [
        {
          measuredAt: "2026-02-18T07:00:00.000Z",
          weightKg: 73.4
        }
      ],
      [
        {
          date: "2026-02-17",
          totalSleepSeconds: 26100
        }
      ],
      "2026-02-18T17:10:00.000Z"
    );

    const tokens = store.getWithingsTokens(userId);
    const data = store.getWithingsData(userId);

    expect(tokens?.refreshToken).toBe("refresh-token");
    expect(tokens?.accessToken).toBe("access-token");
    expect(tokens?.userId).toBe("12345");
    expect(tokens?.scope).toContain("user.metrics");
    expect(data.weight[0]?.weightKg).toBe(73.4);
    expect(data.sleepSummary[0]?.date).toBe("2026-02-17");
  });

  it("supports Withings token records with only an access token", () => {
    const store = new RuntimeStore(":memory:");

    store.setWithingsTokens(userId, {
      accessToken: "env-access-token",
      connectedAt: "2026-02-18T17:00:00.000Z",
      source: "env"
    });

    const tokens = store.getWithingsTokens(userId);
    expect(tokens).not.toBeNull();
    expect(tokens?.refreshToken).toBeUndefined();
    expect(tokens?.accessToken).toBe("env-access-token");
    expect(tokens?.source).toBe("env");
  });
});
