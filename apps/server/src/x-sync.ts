import { RuntimeStore } from "./store.js";
import { XClient, XTweet } from "./x-client.js";
import { XData } from "./types.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

export type XSyncErrorCode =
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "empty"
  | "network"
  | "parse"
  | "unknown";

export interface XSyncResult {
  success: boolean;
  tweetsCount: number;
  error?: string;
  errorCode?: XSyncErrorCode;
}

export interface XSyncOptions {
  maxTweets?: number;
}

export class XSyncService {
  private readonly store: RuntimeStore;
  private readonly client: XClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 4 * 60 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "x",
    baseBackoffMs: 45_000,
    maxBackoffMs: 3 * 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 30 * 60 * 1000
  });

  constructor(store: RuntimeStore, client?: XClient) {
    this.store = store;
    this.client = client ?? new XClient();
  }

  /**
   * Start the X sync service with periodic syncing every 4 hours
   */
  start(intervalMs: number = 4 * 60 * 60 * 1000): void {
    if (this.syncInterval) {
      return;
    }

    this.autoSyncIntervalMs = intervalMs;

    // Sync immediately on start (only if configured)
    if (this.client.isConfigured()) {
      void this.runAutoSync();
    }

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      if (this.client.isConfigured()) {
        void this.runAutoSync();
      }
    }, intervalMs);
  }

  /**
   * Stop the X sync service
   */
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

  /**
   * Perform an X sync
   */
  async sync(options?: XSyncOptions): Promise<XSyncResult> {
    if (!this.client.isConfigured()) {
      return {
        success: false,
        tweetsCount: 0,
        error: "X API credentials not configured (set OAuth credentials or X_BEARER_TOKEN).",
        errorCode: "not_configured"
      };
    }

    try {
      const maxTweets = options?.maxTweets ?? 50;

      // Fetch home timeline
      const tweets = await this.client.fetchHomeTimeline(maxTweets);

      const xData: XData = {
        tweets: tweets.map(tweet => ({
          id: tweet.id,
          text: tweet.text,
          authorId: tweet.authorId,
          authorUsername: tweet.authorUsername,
          authorName: tweet.authorName,
          createdAt: tweet.createdAt,
          likeCount: tweet.likeCount,
          retweetCount: tweet.retweetCount,
          replyCount: tweet.replyCount,
          conversationId: tweet.conversationId
        })),
        lastSyncedAt: new Date().toISOString()
      };

      this.store.setXData(xData);

      if (tweets.length === 0) {
        return {
          success: false,
          tweetsCount: 0,
          error:
            "X sync returned no tweets. If using bearer-token mode, confirm query access and account permissions.",
          errorCode: "empty"
        };
      }

      return {
        success: true,
        tweetsCount: tweets.length
      };
    } catch (error) {
      const classified = classifyXSyncError(error);
      console.error("X sync failed:", classified.code, classified.message);
      
      return {
        success: false,
        tweetsCount: 0,
        error: classified.message,
        errorCode: classified.code
      };
    }
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
    if (!this.client.isConfigured() || this.autoSyncInProgress) {
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

function classifyXSyncError(error: unknown): { code: XSyncErrorCode; message: string } {
  if (error instanceof Error) {
    const message = error.message;
    const lower = message.toLowerCase();

    if (lower.includes("429") || lower.includes("rate limit")) {
      return { code: "rate_limit", message };
    }
    if (lower.includes("401") || lower.includes("403") || lower.includes("unauthorized") || lower.includes("forbidden")) {
      return { code: "auth", message };
    }
    if (lower.includes("network") || lower.includes("fetch")) {
      return { code: "network", message };
    }
    if (lower.includes("parse") || lower.includes("json")) {
      return { code: "parse", message };
    }

    return { code: "unknown", message };
  }

  return { code: "unknown", message: "Unknown X sync error" };
}
