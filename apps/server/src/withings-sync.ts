import { config } from "./config.js";
import { RuntimeStore } from "./store.js";
import { WithingsSleepSummaryEntry, WithingsSyncResult, WithingsWeightEntry } from "./types.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";
import { WithingsOAuthService } from "./withings-oauth.js";

interface WithingsApiResponse<TBody = unknown> {
  status?: number;
  error?: string;
  body?: TBody;
}

interface WithingsWeightMeasure {
  type?: number;
  value?: number;
  unit?: number;
}

interface WithingsWeightMeasureGroup {
  date?: number;
  measures?: WithingsWeightMeasure[];
}

interface WithingsWeightBody {
  measuregrps?: WithingsWeightMeasureGroup[];
}

interface WithingsSleepSeriesEntry {
  date?: string;
  startdate?: number;
  data?: Record<string, unknown>;
}

interface WithingsSleepBody {
  series?: WithingsSleepSeriesEntry[];
}

export interface WithingsDataClient {
  fetchWeight(accessToken: string, daysBack: number): Promise<WithingsWeightEntry[]>;
  fetchSleepSummary(accessToken: string, daysBack: number): Promise<WithingsSleepSummaryEntry[]>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMeasureValue(value: number, unit: number): number {
  return value * 10 ** unit;
}

function toDateKeyFromDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toDateKeyFromUnixSeconds(value: number): string {
  return toDateKeyFromDate(new Date(value * 1000));
}

function clampDaysBack(daysBack: number): number {
  return Math.max(1, Math.min(90, Math.round(daysBack)));
}

export class WithingsClient implements WithingsDataClient {
  private readonly endpoint: string;

  constructor(endpoint: string = config.WITHINGS_API_ENDPOINT) {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  private buildUrl(path: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${this.endpoint}${normalizedPath}`;
  }

  private async postForm<TBody>(path: string, accessToken: string, params: Record<string, string>): Promise<TBody> {
    const form = new URLSearchParams(params);
    const response = await fetch(this.buildUrl(path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });

    const raw = await response.text();
    let payload: WithingsApiResponse<TBody> | null = null;

    try {
      payload = JSON.parse(raw) as WithingsApiResponse<TBody>;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const providerError = payload?.error ? ` (${payload.error})` : "";
      throw new Error(`Withings API error: HTTP ${response.status}${providerError}`);
    }

    if (!payload || payload.status !== 0 || !payload.body) {
      const providerError = payload?.error ?? "unknown_error";
      throw new Error(`Withings API error: ${providerError}`);
    }

    return payload.body;
  }

  async fetchWeight(accessToken: string, daysBack: number): Promise<WithingsWeightEntry[]> {
    const normalizedDaysBack = clampDaysBack(daysBack);
    const now = Math.floor(Date.now() / 1000);
    const start = now - normalizedDaysBack * 24 * 60 * 60;

    const body = await this.postForm<WithingsWeightBody>("/measure", accessToken, {
      action: "getmeas",
      category: "1",
      startdate: String(start),
      enddate: String(now)
    });

    const groups = Array.isArray(body.measuregrps) ? body.measuregrps : [];

    const entries: WithingsWeightEntry[] = groups
      .map((group): WithingsWeightEntry | null => {
        const measuredAtSeconds = asNumber(group.date);
        if (!measuredAtSeconds || !Array.isArray(group.measures)) {
          return null;
        }

        let weightKg: number | null = null;
        let fatRatioPercent: number | undefined;
        let fatMassKg: number | undefined;
        let muscleMassKg: number | undefined;

        group.measures.forEach((measure) => {
          const type = asNumber(measure.type);
          const value = asNumber(measure.value);
          const unit = asNumber(measure.unit);
          if (type === null || value === null || unit === null) {
            return;
          }

          const normalized = normalizeMeasureValue(value, unit);

          if (type === 1) {
            weightKg = normalized;
          } else if (type === 6) {
            fatRatioPercent = normalized;
          } else if (type === 8) {
            fatMassKg = normalized;
          } else if (type === 76) {
            muscleMassKg = normalized;
          }
        });

        if (weightKg === null) {
          return null;
        }

        return {
          measuredAt: new Date(measuredAtSeconds * 1000).toISOString(),
          weightKg: Math.round(weightKg * 1000) / 1000,
          ...(typeof fatRatioPercent === "number" ? { fatRatioPercent: Math.round(fatRatioPercent * 1000) / 1000 } : {}),
          ...(typeof fatMassKg === "number" ? { fatMassKg: Math.round(fatMassKg * 1000) / 1000 } : {}),
          ...(typeof muscleMassKg === "number" ? { muscleMassKg: Math.round(muscleMassKg * 1000) / 1000 } : {})
        };
      })
      .filter((entry): entry is WithingsWeightEntry => entry !== null)
      .sort((a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt));

    return entries;
  }

  async fetchSleepSummary(accessToken: string, daysBack: number): Promise<WithingsSleepSummaryEntry[]> {
    const normalizedDaysBack = clampDaysBack(daysBack);
    const now = new Date();
    const startDate = new Date(now.getTime() - normalizedDaysBack * 24 * 60 * 60 * 1000);

    const body = await this.postForm<WithingsSleepBody>("/v2/sleep", accessToken, {
      action: "getsummary",
      startdateymd: toDateKeyFromDate(startDate),
      enddateymd: toDateKeyFromDate(now),
      data_fields: [
        "total_sleep_time",
        "wakeupduration",
        "lightsleepduration",
        "deepsleepduration",
        "remsleepduration",
        "sleep_efficiency",
        "hr_average",
        "hr_min",
        "hr_max"
      ].join(",")
    });

    const series = Array.isArray(body.series) ? body.series : [];

    const summaries: WithingsSleepSummaryEntry[] = series
      .map((entry): WithingsSleepSummaryEntry | null => {
        const data = asRecord(entry.data);
        if (!data) {
          return null;
        }

        const deepSleepSeconds = asNumber(data.deepsleepduration);
        const lightSleepSeconds = asNumber(data.lightsleepduration);
        const remSleepSeconds = asNumber(data.remsleepduration);
        const awakeSeconds = asNumber(data.wakeupduration);
        const totalSleepSecondsFromTotal = asNumber(data.total_sleep_time);
        const summedSleepSeconds =
          (deepSleepSeconds ?? 0) + (lightSleepSeconds ?? 0) + (remSleepSeconds ?? 0);
        const totalSleepSeconds = totalSleepSecondsFromTotal ?? summedSleepSeconds;

        if (!Number.isFinite(totalSleepSeconds) || totalSleepSeconds <= 0) {
          return null;
        }

        const dateFromSeries = typeof entry.date === "string" && entry.date.trim().length > 0
          ? entry.date
          : undefined;
        const dateFromStartDate = asNumber(entry.startdate);
        const date = dateFromSeries ?? (dateFromStartDate ? toDateKeyFromUnixSeconds(dateFromStartDate) : null);

        if (!date) {
          return null;
        }

        return {
          date,
          totalSleepSeconds: Math.round(totalSleepSeconds),
          ...(typeof deepSleepSeconds === "number" ? { deepSleepSeconds: Math.round(deepSleepSeconds) } : {}),
          ...(typeof lightSleepSeconds === "number" ? { lightSleepSeconds: Math.round(lightSleepSeconds) } : {}),
          ...(typeof remSleepSeconds === "number" ? { remSleepSeconds: Math.round(remSleepSeconds) } : {}),
          ...(typeof awakeSeconds === "number" ? { awakeSeconds: Math.round(awakeSeconds) } : {}),
          ...(typeof asNumber(data.sleep_efficiency) === "number"
            ? { sleepEfficiency: Math.round((asNumber(data.sleep_efficiency) ?? 0) * 1000) / 1000 }
            : {}),
          ...(typeof asNumber(data.hr_average) === "number"
            ? { hrAverage: Math.round((asNumber(data.hr_average) ?? 0) * 1000) / 1000 }
            : {}),
          ...(typeof asNumber(data.hr_min) === "number"
            ? { hrMin: Math.round((asNumber(data.hr_min) ?? 0) * 1000) / 1000 }
            : {}),
          ...(typeof asNumber(data.hr_max) === "number"
            ? { hrMax: Math.round((asNumber(data.hr_max) ?? 0) * 1000) / 1000 }
            : {})
        };
      })
      .filter((entry): entry is WithingsSleepSummaryEntry => entry !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    return summaries;
  }
}

export interface WithingsSyncOptions {
  daysBack?: number;
}

export class WithingsSyncService {
  private readonly store: RuntimeStore;
  private readonly userId: string;
  private readonly oauth: WithingsOAuthService;
  private readonly client: WithingsDataClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 24 * 60 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "withings",
    baseBackoffMs: 60_000,
    maxBackoffMs: 6 * 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 30 * 60 * 1000
  });

  constructor(store: RuntimeStore, userId: string, oauth?: WithingsOAuthService, client?: WithingsDataClient) {
    this.store = store;
    this.userId = userId;
    this.oauth = oauth ?? new WithingsOAuthService(store, userId);
    this.client = client ?? new WithingsClient();
  }

  start(intervalMs: number = 24 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    this.autoSyncIntervalMs = intervalMs;
    void this.runAutoSync();

    this.syncInterval = setInterval(() => {
      void this.runAutoSync();
    }, intervalMs);
  }

  stop(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }
  }

  async sync(options: WithingsSyncOptions = {}): Promise<WithingsSyncResult> {
    if (!this.oauth.isConnected()) {
      return {
        success: false,
        weightsCount: 0,
        sleepDaysCount: 0,
        error: "Withings not connected"
      };
    }

    const daysBack = clampDaysBack(options.daysBack ?? 14);

    try {
      const accessToken = await this.oauth.getValidAccessToken();
      const [weight, sleepSummary] = await Promise.all([
        this.client.fetchWeight(accessToken, daysBack),
        this.client.fetchSleepSummary(accessToken, daysBack)
      ]);

      const lastSyncedAt = new Date().toISOString();
      this.store.setWithingsData(this.userId, weight.slice(0, 365), sleepSummary.slice(0, 365), lastSyncedAt);

      return {
        success: true,
        weightsCount: weight.length,
        sleepDaysCount: sleepSummary.length
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        weightsCount: 0,
        sleepDaysCount: 0,
        error: errorMessage
      };
    }
  }

  async triggerSync(options: WithingsSyncOptions = {}): Promise<WithingsSyncResult> {
    return this.sync(options);
  }

  getData() {
    return this.store.getWithingsData(this.userId);
  }

  getAutoHealingStatus(): SyncAutoHealingState {
    return this.autoHealing.getState();
  }

  private scheduleAutoRetry(): void {
    if (!this.syncInterval || this.retryTimeout) {
      return;
    }

    const nextAttemptAt = this.autoHealing.getState().nextAttemptAt;
    if (!nextAttemptAt) {
      return;
    }

    const delay = Date.parse(nextAttemptAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0 || delay >= this.autoSyncIntervalMs) {
      return;
    }

    this.retryTimeout = setTimeout(() => {
      this.retryTimeout = null;
      void this.runAutoSync();
    }, delay);
  }

  private async runAutoSync(): Promise<void> {
    if (!this.oauth.isConnected() || this.autoSyncInProgress) {
      return;
    }

    const decision = this.autoHealing.canAttempt();
    if (!decision.allowed) {
      this.autoHealing.recordSkip(decision.reason ?? "backoff");
      return;
    }

    this.autoSyncInProgress = true;
    try {
      const result = await this.sync();
      if (result.success) {
        this.autoHealing.recordSuccess();
      } else {
        this.autoHealing.recordFailure(result.error);
        this.scheduleAutoRetry();
      }
    } finally {
      this.autoSyncInProgress = false;
    }
  }
}
