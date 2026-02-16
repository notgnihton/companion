import { RuntimeStore } from "./store.js";
import { YouTubeClient, YouTubeVideo, YouTubeChannel } from "./youtube-client.js";
import { YouTubeData } from "./types.js";

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

export class YouTubeSyncService {
  private readonly store: RuntimeStore;
  private readonly client: YouTubeClient;
  private syncInterval: ReturnType<typeof setInterval> | null = null;

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

    // Sync immediately on start (only if configured)
    if (this.client.isConfigured()) {
      void this.sync();
    }

    // Then sync periodically
    this.syncInterval = setInterval(() => {
      if (this.client.isConfigured()) {
        void this.sync();
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

      // Fetch subscribed channels
      const channels = await this.client.fetchSubscriptions(maxChannels);

      // Fetch recent uploads from each channel
      const allVideoIds: string[] = [];
      for (const channel of channels.slice(0, Math.min(channels.length, 10))) {
        try {
          const videoIds = await this.client.fetchChannelUploads(channel.id, maxVideosPerChannel);
          allVideoIds.push(...videoIds);
        } catch (error) {
          console.error(`Failed to fetch uploads for channel ${channel.id}:`, error);
          // Continue with other channels even if one fails
        }
      }

      // Fetch video metadata for all videos
      const videos = allVideoIds.length > 0 
        ? await this.client.fetchVideoMetadata(allVideoIds) 
        : [];

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
}
