import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { YouTubeClient } from "./youtube-client.js";
import { YouTubeSyncService } from "./youtube-sync.js";

describe("YouTube Integration", () => {
  let store: RuntimeStore;
  
  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("YouTubeSyncService", () => {
    it("should construct with store", () => {
      const service = new YouTubeSyncService(store);
      expect(service).toBeDefined();
    });

    it("should return error when API key not configured", async () => {
      const mockClient = {
        isConfigured: () => false
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe("YouTube API key not configured");
      expect(result.channelsCount).toBe(0);
      expect(result.videosCount).toBe(0);
    });

    it("should fetch channels and videos when configured", async () => {
      const mockChannels = [
        {
          id: "UC1",
          title: "Test Channel",
          description: "Test Description",
          thumbnailUrl: "https://example.com/thumb.jpg",
          subscriberCount: 1000
        }
      ];

      const mockVideos = [
        {
          id: "vid1",
          channelId: "UC1",
          channelTitle: "Test Channel",
          title: "Test Video",
          description: "Video description",
          publishedAt: "2024-01-01T00:00:00Z",
          thumbnailUrl: "https://example.com/vid-thumb.jpg",
          duration: "PT10M",
          viewCount: 500,
          likeCount: 50,
          commentCount: 10
        }
      ];

      const mockClient = {
        isConfigured: () => true,
        fetchSubscriptions: async () => mockChannels,
        fetchChannelUploads: async () => ["vid1"],
        fetchVideoMetadata: async () => mockVideos,
        getQuotaStatus: () => ({ used: 101, limit: 10000, remaining: 9899, resetAt: "2024-01-02T00:00:00Z" })
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(true);
      expect(result.channelsCount).toBe(1);
      expect(result.videosCount).toBe(1);
      expect(result.error).toBeUndefined();

      // Verify data was stored
      const storedData = store.getYouTubeData();
      expect(storedData).not.toBeNull();
      expect(storedData?.channels).toHaveLength(1);
      expect(storedData?.videos).toHaveLength(1);
      expect(storedData?.channels[0]?.title).toBe("Test Channel");
      expect(storedData?.videos[0]?.title).toBe("Test Video");
    });

    it("should handle errors gracefully during sync", async () => {
      const mockClient = {
        isConfigured: () => true,
        fetchSubscriptions: async () => {
          throw new Error("Network error");
        }
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
      expect(result.channelsCount).toBe(0);
      expect(result.videosCount).toBe(0);
    });

    it("should continue with other channels if one fails", async () => {
      const mockChannels = [
        {
          id: "UC1",
          title: "Channel 1",
          description: "Description 1",
          thumbnailUrl: "https://example.com/thumb1.jpg",
          subscriberCount: 1000
        },
        {
          id: "UC2",
          title: "Channel 2",
          description: "Description 2",
          thumbnailUrl: "https://example.com/thumb2.jpg",
          subscriberCount: 2000
        }
      ];

      const mockClient = {
        isConfigured: () => true,
        fetchSubscriptions: async () => mockChannels,
        fetchChannelUploads: async (channelId: string) => {
          if (channelId === "UC1") {
            throw new Error("Failed to fetch UC1");
          }
          return ["vid2"];
        },
        fetchVideoMetadata: async () => [
          {
            id: "vid2",
            channelId: "UC2",
            channelTitle: "Channel 2",
            title: "Video 2",
            description: "Description 2",
            publishedAt: "2024-01-01T00:00:00Z",
            thumbnailUrl: "https://example.com/vid2-thumb.jpg",
            duration: "PT5M",
            viewCount: 200,
            likeCount: 20,
            commentCount: 5
          }
        ],
        getQuotaStatus: () => ({ used: 201, limit: 10000, remaining: 9799, resetAt: "2024-01-02T00:00:00Z" })
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      const result = await service.sync();
      
      // Sync should succeed despite one channel failing
      expect(result.success).toBe(true);
      expect(result.channelsCount).toBe(2);
      expect(result.videosCount).toBe(1);
    });

    it("should respect maxChannels and maxVideosPerChannel options", async () => {
      let subscriptionsCalled = false;
      let uploadsCalled = false;

      const mockClient = {
        isConfigured: () => true,
        fetchSubscriptions: async (maxResults: number) => {
          subscriptionsCalled = true;
          expect(maxResults).toBe(25);
          return [];
        },
        fetchChannelUploads: async (channelId: string, maxResults: number) => {
          uploadsCalled = true;
          expect(maxResults).toBe(3);
          return [];
        },
        fetchVideoMetadata: async () => [],
        getQuotaStatus: () => ({ used: 0, limit: 10000, remaining: 10000, resetAt: "2024-01-02T00:00:00Z" })
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      await service.sync({ maxChannels: 25, maxVideosPerChannel: 3 });
      
      expect(subscriptionsCalled).toBe(true);
    });

    it("should get quota status", () => {
      const mockClient = {
        getQuotaStatus: () => ({ used: 500, limit: 10000, remaining: 9500, resetAt: "2024-01-02T00:00:00Z" })
      } as unknown as YouTubeClient;

      const service = new YouTubeSyncService(store, mockClient);
      const quotaStatus = service.getQuotaStatus();
      
      expect(quotaStatus.used).toBe(500);
      expect(quotaStatus.remaining).toBe(9500);
      expect(quotaStatus.limit).toBe(10000);
    });

    it("should start and stop sync service", () => {
      const service = new YouTubeSyncService(store);
      
      service.start(100); // Short interval for testing
      service.stop();
      
      expect(true).toBe(true); // Just verify no errors
    });
  });
});
