import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncAutoHealingPolicy } from "./sync-auto-healing.js";

describe("SyncAutoHealingPolicy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("applies exponential backoff with jitter after failures", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const policy = new SyncAutoHealingPolicy({
      integration: "canvas",
      baseBackoffMs: 1_000,
      maxBackoffMs: 8_000,
      circuitFailureThreshold: 5,
      jitterRatio: 0
    });

    policy.recordFailure("first", 1_000);
    expect(policy.getState(1_000).lastBackoffMs).toBe(1_000);
    expect(policy.canAttempt(1_500)).toEqual({ allowed: false, reason: "backoff" });
    expect(policy.canAttempt(2_001)).toEqual({ allowed: true });

    policy.recordFailure("second", 2_100);
    expect(policy.getState(2_100).lastBackoffMs).toBe(2_000);
    expect(policy.canAttempt(3_500)).toEqual({ allowed: false, reason: "backoff" });
    expect(policy.canAttempt(4_200)).toEqual({ allowed: true });
  });

  it("opens a circuit after repeated failures", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const policy = new SyncAutoHealingPolicy({
      integration: "github",
      baseBackoffMs: 1_000,
      maxBackoffMs: 8_000,
      circuitFailureThreshold: 3,
      circuitOpenMs: 10_000,
      jitterRatio: 0
    });

    policy.recordFailure("f1", 1_000);
    policy.recordFailure("f2", 3_000);
    policy.recordFailure("f3", 7_000);

    const state = policy.getState(7_000);
    expect(state.circuitOpenUntil).toBe("1970-01-01T00:00:17.000Z");
    expect(policy.canAttempt(8_000)).toEqual({ allowed: false, reason: "circuit_open" });
    expect(policy.canAttempt(17_100)).toEqual({ allowed: true });
  });

  it("resets failure/backoff state on success", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const policy = new SyncAutoHealingPolicy({
      integration: "youtube",
      baseBackoffMs: 1_000,
      maxBackoffMs: 8_000,
      circuitFailureThreshold: 3,
      jitterRatio: 0
    });

    policy.recordFailure("temporary", 5_000);
    expect(policy.getState(5_000).consecutiveFailures).toBe(1);

    policy.recordSuccess(6_000);
    const state = policy.getState(6_000);

    expect(state.consecutiveFailures).toBe(0);
    expect(state.backoffUntil).toBeNull();
    expect(state.circuitOpenUntil).toBeNull();
    expect(state.lastError).toBeNull();
    expect(state.lastSuccessAt).toBe("1970-01-01T00:00:06.000Z");
    expect(policy.canAttempt(6_100)).toEqual({ allowed: true });
  });
});
