export type SyncAutoHealingSkipReason = "backoff" | "circuit_open";

export interface SyncAutoHealingOptions {
  integration: string;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  circuitFailureThreshold?: number;
  circuitOpenMs?: number;
  jitterRatio?: number;
}

export interface SyncAutoHealingAttemptDecision {
  allowed: boolean;
  reason?: SyncAutoHealingSkipReason;
}

export interface SyncAutoHealingState {
  integration: string;
  consecutiveFailures: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  backoffUntil: string | null;
  circuitOpenUntil: string | null;
  nextAttemptAt: string | null;
  lastBackoffMs: number;
  skipCounts: {
    backoff: number;
    circuitOpen: number;
  };
}

function toIso(value: number | null): string | null {
  if (value === null) {
    return null;
  }
  return new Date(value).toISOString();
}

export class SyncAutoHealingPolicy {
  private readonly integration: string;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly circuitFailureThreshold: number;
  private readonly circuitOpenMs: number;
  private readonly jitterRatio: number;

  private consecutiveFailures = 0;
  private lastSuccessAtMs: number | null = null;
  private lastFailureAtMs: number | null = null;
  private lastError: string | null = null;
  private backoffUntilMs: number | null = null;
  private circuitOpenUntilMs: number | null = null;
  private lastBackoffMs = 0;
  private skippedBackoff = 0;
  private skippedCircuitOpen = 0;

  constructor(options: SyncAutoHealingOptions) {
    this.integration = options.integration;
    this.baseBackoffMs = Math.max(1000, options.baseBackoffMs ?? 30_000);
    this.maxBackoffMs = Math.max(this.baseBackoffMs, options.maxBackoffMs ?? 30 * 60 * 1000);
    this.circuitFailureThreshold = Math.max(2, options.circuitFailureThreshold ?? 4);
    this.circuitOpenMs = Math.max(10_000, options.circuitOpenMs ?? 10 * 60 * 1000);
    this.jitterRatio = Math.min(Math.max(options.jitterRatio ?? 0.35, 0), 1);
  }

  private withJitter(baseMs: number): number {
    const jitter = Math.floor(baseMs * this.jitterRatio * Math.random());
    return baseMs + jitter;
  }

  private pruneExpired(nowMs: number): void {
    if (this.backoffUntilMs !== null && this.backoffUntilMs <= nowMs) {
      this.backoffUntilMs = null;
    }

    if (this.circuitOpenUntilMs !== null && this.circuitOpenUntilMs <= nowMs) {
      this.circuitOpenUntilMs = null;
      if (this.consecutiveFailures >= this.circuitFailureThreshold) {
        // Half-open strategy: keep some memory but allow fresh attempts.
        this.consecutiveFailures = Math.ceil(this.circuitFailureThreshold / 2);
      }
    }
  }

  canAttempt(nowMs: number = Date.now()): SyncAutoHealingAttemptDecision {
    this.pruneExpired(nowMs);

    if (this.circuitOpenUntilMs !== null && this.circuitOpenUntilMs > nowMs) {
      return { allowed: false, reason: "circuit_open" };
    }

    if (this.backoffUntilMs !== null && this.backoffUntilMs > nowMs) {
      return { allowed: false, reason: "backoff" };
    }

    return { allowed: true };
  }

  recordSkip(reason: SyncAutoHealingSkipReason): void {
    if (reason === "circuit_open") {
      this.skippedCircuitOpen += 1;
      return;
    }
    this.skippedBackoff += 1;
  }

  recordSuccess(nowMs: number = Date.now()): void {
    this.consecutiveFailures = 0;
    this.lastSuccessAtMs = nowMs;
    this.lastError = null;
    this.backoffUntilMs = null;
    this.circuitOpenUntilMs = null;
    this.lastBackoffMs = 0;
  }

  recordFailure(errorMessage?: string, nowMs: number = Date.now()): void {
    this.consecutiveFailures += 1;
    this.lastFailureAtMs = nowMs;
    this.lastError = errorMessage ?? "Unknown sync failure";

    const exponent = Math.max(0, this.consecutiveFailures - 1);
    const baseDelay = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** exponent);
    const backoffMs = this.withJitter(baseDelay);

    this.lastBackoffMs = backoffMs;
    this.backoffUntilMs = nowMs + backoffMs;

    if (this.consecutiveFailures >= this.circuitFailureThreshold) {
      const circuitMs = this.withJitter(this.circuitOpenMs);
      this.circuitOpenUntilMs = nowMs + circuitMs;
    }
  }

  getState(nowMs: number = Date.now()): SyncAutoHealingState {
    this.pruneExpired(nowMs);

    const nextAttemptMs = [this.backoffUntilMs, this.circuitOpenUntilMs]
      .filter((value): value is number => value !== null)
      .reduce<number | null>((latest, current) => (latest === null || current > latest ? current : latest), null);

    return {
      integration: this.integration,
      consecutiveFailures: this.consecutiveFailures,
      lastSuccessAt: toIso(this.lastSuccessAtMs),
      lastFailureAt: toIso(this.lastFailureAtMs),
      lastError: this.lastError,
      backoffUntil: toIso(this.backoffUntilMs),
      circuitOpenUntil: toIso(this.circuitOpenUntilMs),
      nextAttemptAt: toIso(nextAttemptMs),
      lastBackoffMs: this.lastBackoffMs,
      skipCounts: {
        backoff: this.skippedBackoff,
        circuitOpen: this.skippedCircuitOpen
      }
    };
  }
}
