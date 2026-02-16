import { config } from "./config.js";

export interface YouTubeVideo {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string;
  thumbnailUrl: string;
  duration: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
}

export interface YouTubeChannel {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount: number;
}

export interface YouTubeQuotaUsage {
  used: number;
  limit: number;
  remaining: number;
  resetAt: string;
}

export class YouTubeAPIError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "YouTubeAPIError";
  }
}

export class YouTubeQuotaExceededError extends YouTubeAPIError {
  constructor(message = "YouTube API quota exceeded (10,000 units/day)") {
    super(message, 403);
    this.name = "YouTubeQuotaExceededError";
  }
}

/**
 * Quota cost tracking for YouTube Data API v3
 * Based on: https://developers.google.com/youtube/v3/determine_quota_cost
 */
class QuotaTracker {
  private dailyUsage: number = 0;
  private resetDate: string;
  private readonly dailyLimit = 10000;

  constructor() {
    this.resetDate = new Date().toISOString().split('T')[0]!;
  }

  /**
   * Record quota usage for an API call
   */
  recordUsage(cost: number): void {
    const today = new Date().toISOString().split('T')[0]!;
    
    // Reset usage if it's a new day
    if (today !== this.resetDate) {
      this.dailyUsage = 0;
      this.resetDate = today;
    }

    this.dailyUsage += cost;
  }

  /**
   * Check if we have enough quota for an API call
   */
  canMakeRequest(cost: number): boolean {
    const today = new Date().toISOString().split('T')[0]!;
    
    // Reset usage if it's a new day
    if (today !== this.resetDate) {
      this.dailyUsage = 0;
      this.resetDate = today;
    }

    return (this.dailyUsage + cost) <= this.dailyLimit;
  }

  /**
   * Get current quota status
   */
  getStatus(): YouTubeQuotaUsage {
    const today = new Date().toISOString().split('T')[0]!;
    
    // Reset usage if it's a new day
    if (today !== this.resetDate) {
      this.dailyUsage = 0;
      this.resetDate = today;
    }

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      used: this.dailyUsage,
      limit: this.dailyLimit,
      remaining: this.dailyLimit - this.dailyUsage,
      resetAt: tomorrow.toISOString()
    };
  }

  /**
   * Reset quota usage (for testing)
   */
  reset(): void {
    this.dailyUsage = 0;
    this.resetDate = new Date().toISOString().split('T')[0]!;
  }
}

/**
 * YouTube Data API v3 client
 */
export class YouTubeClient {
  private readonly apiKey: string | null;
  private readonly baseUrl = "https://www.googleapis.com/youtube/v3";
  private quotaTracker: QuotaTracker;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? config.YOUTUBE_API_KEY ?? null;
    this.quotaTracker = new QuotaTracker();
  }

  isConfigured(): boolean {
    return this.apiKey !== null;
  }

  /**
   * Fetch user's subscribed channels
   * Quota cost: 1 unit per request + 2 units per page
   */
  async fetchSubscriptions(maxResults: number = 50): Promise<YouTubeChannel[]> {
    if (!this.isConfigured()) {
      throw new YouTubeAPIError("YouTube API key not configured. Set YOUTUBE_API_KEY environment variable.");
    }

    // Cost: 1 unit for subscriptions.list
    const quotaCost = 1;
    if (!this.quotaTracker.canMakeRequest(quotaCost)) {
      throw new YouTubeQuotaExceededError();
    }

    try {
      const url = new URL(`${this.baseUrl}/subscriptions`);
      url.searchParams.set("part", "snippet");
      url.searchParams.set("mine", "true");
      url.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
      url.searchParams.set("key", this.apiKey!);

      const response = await fetch(url.toString());

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as any)?.error?.message ?? "Quota exceeded";
          if (errorMessage.toLowerCase().includes("quota")) {
            throw new YouTubeQuotaExceededError(errorMessage);
          }
        }
        throw new YouTubeAPIError(`YouTube API error: ${response.statusText}`, response.status);
      }

      this.quotaTracker.recordUsage(quotaCost);

      const data = await response.json() as any;
      const channels: YouTubeChannel[] = [];

      for (const item of data.items || []) {
        channels.push({
          id: item.snippet.resourceId.channelId,
          title: item.snippet.title,
          description: item.snippet.description || "",
          thumbnailUrl: item.snippet.thumbnails?.default?.url || "",
          subscriberCount: 0 // Not available in subscriptions endpoint
        });
      }

      return channels;
    } catch (error) {
      if (error instanceof YouTubeAPIError) {
        throw error;
      }
      throw new YouTubeAPIError(
        `Failed to fetch YouTube subscriptions: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch recent uploads from a channel
   * Quota cost: 100 units per request
   */
  async fetchChannelUploads(channelId: string, maxResults: number = 10): Promise<string[]> {
    if (!this.isConfigured()) {
      throw new YouTubeAPIError("YouTube API key not configured. Set YOUTUBE_API_KEY environment variable.");
    }

    // Cost: 100 units for search.list
    const quotaCost = 100;
    if (!this.quotaTracker.canMakeRequest(quotaCost)) {
      throw new YouTubeQuotaExceededError();
    }

    try {
      const url = new URL(`${this.baseUrl}/search`);
      url.searchParams.set("part", "id");
      url.searchParams.set("channelId", channelId);
      url.searchParams.set("order", "date");
      url.searchParams.set("type", "video");
      url.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
      url.searchParams.set("key", this.apiKey!);

      const response = await fetch(url.toString());

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as any)?.error?.message ?? "Quota exceeded";
          if (errorMessage.toLowerCase().includes("quota")) {
            throw new YouTubeQuotaExceededError(errorMessage);
          }
        }
        throw new YouTubeAPIError(`YouTube API error: ${response.statusText}`, response.status);
      }

      this.quotaTracker.recordUsage(quotaCost);

      const data = await response.json() as any;
      const videoIds: string[] = [];

      for (const item of data.items || []) {
        if (item.id?.videoId) {
          videoIds.push(item.id.videoId);
        }
      }

      return videoIds;
    } catch (error) {
      if (error instanceof YouTubeAPIError) {
        throw error;
      }
      throw new YouTubeAPIError(
        `Failed to fetch channel uploads: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Fetch video metadata for multiple videos
   * Quota cost: 1 unit per request
   */
  async fetchVideoMetadata(videoIds: string[]): Promise<YouTubeVideo[]> {
    if (!this.isConfigured()) {
      throw new YouTubeAPIError("YouTube API key not configured. Set YOUTUBE_API_KEY environment variable.");
    }

    if (videoIds.length === 0) {
      return [];
    }

    // Cost: 1 unit for videos.list
    const quotaCost = 1;
    if (!this.quotaTracker.canMakeRequest(quotaCost)) {
      throw new YouTubeQuotaExceededError();
    }

    try {
      const url = new URL(`${this.baseUrl}/videos`);
      url.searchParams.set("part", "snippet,contentDetails,statistics");
      url.searchParams.set("id", videoIds.join(","));
      url.searchParams.set("key", this.apiKey!);

      const response = await fetch(url.toString());

      if (!response.ok) {
        if (response.status === 403) {
          const errorData = await response.json().catch(() => ({}));
          const errorMessage = (errorData as any)?.error?.message ?? "Quota exceeded";
          if (errorMessage.toLowerCase().includes("quota")) {
            throw new YouTubeQuotaExceededError(errorMessage);
          }
        }
        throw new YouTubeAPIError(`YouTube API error: ${response.statusText}`, response.status);
      }

      this.quotaTracker.recordUsage(quotaCost);

      const data = await response.json() as any;
      const videos: YouTubeVideo[] = [];

      for (const item of data.items || []) {
        videos.push({
          id: item.id,
          channelId: item.snippet.channelId,
          channelTitle: item.snippet.channelTitle,
          title: item.snippet.title,
          description: item.snippet.description || "",
          publishedAt: item.snippet.publishedAt,
          thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
          duration: item.contentDetails.duration,
          viewCount: parseInt(item.statistics?.viewCount || "0", 10),
          likeCount: parseInt(item.statistics?.likeCount || "0", 10),
          commentCount: parseInt(item.statistics?.commentCount || "0", 10)
        });
      }

      return videos;
    } catch (error) {
      if (error instanceof YouTubeAPIError) {
        throw error;
      }
      throw new YouTubeAPIError(
        `Failed to fetch video metadata: ${error instanceof Error ? error.message : "Unknown error"}`,
        undefined,
        error
      );
    }
  }

  /**
   * Get current quota status
   */
  getQuotaStatus(): YouTubeQuotaUsage {
    return this.quotaTracker.getStatus();
  }

  /**
   * Reset quota tracker (for testing)
   */
  resetQuota(): void {
    this.quotaTracker.reset();
  }
}

let defaultClient: YouTubeClient | null = null;

export function getYouTubeClient(): YouTubeClient {
  if (!defaultClient) {
    defaultClient = new YouTubeClient();
  }
  return defaultClient;
}
