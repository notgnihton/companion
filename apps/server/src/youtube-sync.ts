import { RuntimeStore } from "./store.js";
import { YouTubeAPIError, YouTubeClient, YouTubeChannel } from "./youtube-client.js";
import { config } from "./config.js";
import { YouTubeData } from "./types.js";
import { SyncAutoHealingPolicy, SyncAutoHealingState } from "./sync-auto-healing.js";

export interface YouTubeSyncResult {
  success: boolean;
  channelsCount: number;
  videosCount: number;
  error?: string;
}

export interface YouTubeSyncOptions {
  maxChannels?: number;
  maxVideosPerChannel?: number;
}

function parseCsvEnv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

function dedupeVideoIds(videoIds: string[]): string[] {
  return Array.from(new Set(videoIds));
}

function looksLikeSubscriptionAuthError(error: unknown): boolean {
  if (error instanceof YouTubeAPIError && error.statusCode === 401) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("unauthorized") ||
    message.includes("mine") ||
    message.includes("insufficient authentication scopes") ||
    message.includes("login required") ||
    message.includes("not properly authorized")
  );
}

export class YouTubeSyncService {
  private readonly store: RuntimeStore;
  private readonly client: YouTubeClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;
  private retryTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoSyncInProgress = false;
  private autoSyncIntervalMs = 6 * 60 * 60 * 1000;
  private readonly autoHealing = new SyncAutoHealingPolicy({
    integration: "youtube",
    baseBackoffMs: 45_000,
    maxBackoffMs: 3 * 60 * 60 * 1000,
    circuitFailureThreshold: 4,
    circuitOpenMs: 30 * 60 * 1000
  });

  constructor(store: RuntimeStore, client?: YouTubeClient) {
    this.store = store;
    this.client = client ?? new YouTubeClient();
  }

  /**
   * Start the YouTube sync service with periodic syncing every 6 hours
   */
  start(intervalMs: number = 6 * 60 * 60 * 1000): void {
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
   * Stop the YouTube sync service
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

  private getConfiguredChannelIds(): string[] {
    return parseCsvEnv(config.YOUTUBE_CHANNEL_IDS);
  }

  private buildFallbackQueries(): string[] {
    const configured = parseCsvEnv(config.YOUTUBE_FALLBACK_QUERIES);
    if (configured.length > 0) {
      return configured;
    }

    const queries: string[] = [];
    const now = new Date();
    const deadlines = this.store
      .getAcademicDeadlines(now)
      .filter((deadline) => !deadline.completed)
      .slice(0, 8);
    const schedule = this.store.getScheduleEvents().slice(0, 8);

    deadlines.forEach((deadline) => {
      queries.push(`${deadline.course} ${deadline.task}`.trim());
      queries.push(`${deadline.course} lecture`);
    });
    schedule.forEach((lecture) => {
      queries.push(lecture.title);
    });

    queries.push("machine learning tutorial");
    queries.push("software engineering lecture");

    return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
  }

  /**
   * Perform a YouTube sync
   */
  async sync(options?: YouTubeSyncOptions): Promise<YouTubeSyncResult> {
    if (!this.client.isConfigured()) {
      return {
        success: false,
        channelsCount: 0,
        videosCount: 0,
        error: "YouTube API key not configured"
      };
    }

    try {
      const maxChannels = options?.maxChannels ?? 50;
      const maxVideosPerChannel = options?.maxVideosPerChannel ?? 5;
      const configuredChannelIds = this.getConfiguredChannelIds().slice(0, maxChannels);

      let channels: YouTubeChannel[] = [];
      let allVideoIds: string[] = [];

      if (configuredChannelIds.length > 0) {
        channels = await this.client.fetchChannelsByIds(configuredChannelIds);
      } else {
        try {
          channels = await this.client.fetchSubscriptions(maxChannels);
        } catch (error) {
          if (!looksLikeSubscriptionAuthError(error)) {
            throw error;
          }
          console.warn("YouTube subscriptions endpoint requires OAuth. Falling back to keyword video search.");
          channels = [];
        }
      }

      if (channels.length > 0) {
        for (const channel of channels.slice(0, Math.min(channels.length, 10))) {
          try {
            const videoIds = await this.client.fetchChannelUploads(channel.id, maxVideosPerChannel);
            allVideoIds.push(...videoIds);
          } catch (error) {
            console.error(`Failed to fetch uploads for channel ${channel.id}:`, error);
            // Continue with other channels even if one fails
          }
        }
      } else {
        const fallbackQueries = this.buildFallbackQueries().slice(0, 4);
        for (const query of fallbackQueries) {
          try {
            const videoIds = await this.client.searchVideosByQuery(query, maxVideosPerChannel);
            allVideoIds.push(...videoIds);
          } catch (error) {
            console.error(`Failed to search YouTube for query "${query}":`, error);
          }
        }
      }

      allVideoIds = dedupeVideoIds(allVideoIds);
      const videos = allVideoIds.length > 0 ? await this.client.fetchVideoMetadata(allVideoIds) : [];

      if (channels.length === 0 && videos.length > 0) {
        const channelMap = new Map<string, YouTubeChannel>();
        videos.forEach((video) => {
          if (!channelMap.has(video.channelId)) {
            channelMap.set(video.channelId, {
              id: video.channelId,
              title: video.channelTitle,
              description: "",
              thumbnailUrl: video.thumbnailUrl,
              subscriberCount: 0
            });
          }
        });
        channels = Array.from(channelMap.values());
      }

      const youtubeData: YouTubeData = {
        channels,
        videos,
        lastSyncedAt: new Date().toISOString()
      };

      this.store.setYouTubeData(youtubeData);

      return {
        success: true,
        channelsCount: channels.length,
        videosCount: videos.length
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("YouTube sync failed:", errorMessage);
      
      return {
        success: false,
        channelsCount: 0,
        videosCount: 0,
        error: errorMessage
      };
    }
  }

  /**
   * Get current quota status
   */
  getQuotaStatus() {
    return this.client.getQuotaStatus();
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
