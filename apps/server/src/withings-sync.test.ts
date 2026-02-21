import { describe, expect, it } from "vitest";
import { RuntimeStore } from "./store.js";
import { WithingsSyncService, WithingsDataClient } from "./withings-sync.js";
import { WithingsOAuthService } from "./withings-oauth.js";

class FakeWithingsOAuth {
  constructor(
    private readonly connected: boolean,
    private readonly accessToken: string,
    private readonly throwOnToken = false
  ) {}

  isConnected(): boolean {
    return this.connected;
  }

  async getValidAccessToken(): Promise<string> {
    if (this.throwOnToken) {
      throw new Error("token refresh failed");
    }
    return this.accessToken;
  }
}

class FakeWithingsClient implements WithingsDataClient {
  constructor(
    private readonly weight: Array<{ measuredAt: string; weightKg: number }> = [],
    private readonly sleep: Array<{ date: string; totalSleepSeconds: number }> = [],
    private readonly throwOnFetch = false
  ) {}

  async fetchWeight(): Promise<Array<{ measuredAt: string; weightKg: number }>> {
    if (this.throwOnFetch) {
      throw new Error("weight fetch failed");
    }
    return this.weight;
  }

  async fetchSleepSummary(): Promise<Array<{ date: string; totalSleepSeconds: number }>> {
    if (this.throwOnFetch) {
      throw new Error("sleep fetch failed");
    }
    return this.sleep;
  }
}

describe("WithingsSyncService", () => {
  const userId = "test-user";

  it("returns not connected when OAuth is not configured", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new WithingsSyncService(
      store,
      userId,
      new FakeWithingsOAuth(false, "") as unknown as WithingsOAuthService,
      new FakeWithingsClient()
    );

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(result.error).toContain("not connected");
    expect(store.getWithingsData(userId).weight).toHaveLength(0);
  });

  it("stores fetched weight and sleep data", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new WithingsSyncService(
      store,
      userId,
      new FakeWithingsOAuth(true, "token") as unknown as WithingsOAuthService,
      new FakeWithingsClient(
        [
          {
            measuredAt: "2026-02-18T06:00:00.000Z",
            weightKg: 73.1
          }
        ],
        [
          {
            date: "2026-02-17",
            totalSleepSeconds: 26400
          }
        ]
      )
    );

    const result = await service.sync({ daysBack: 14 });

    expect(result.success).toBe(true);
    expect(result.weightsCount).toBe(1);
    expect(result.sleepDaysCount).toBe(1);

    const data = store.getWithingsData(userId);
    expect(data.lastSyncedAt).not.toBeNull();
    expect(data.weight[0]?.weightKg).toBe(73.1);
    expect(data.sleepSummary[0]?.date).toBe("2026-02-17");
  });

  it("returns provider errors when fetch fails", async () => {
    const store = new RuntimeStore(":memory:");
    const service = new WithingsSyncService(
      store,
      userId,
      new FakeWithingsOAuth(true, "token") as unknown as WithingsOAuthService,
      new FakeWithingsClient([], [], true)
    );

    const result = await service.sync();

    expect(result.success).toBe(false);
    expect(result.error).toContain("weight fetch failed");
  });
});
