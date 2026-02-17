import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { XClient } from "./x-client.js";
import { XSyncService } from "./x-sync.js";

describe("X Integration", () => {
  let store: RuntimeStore;
  
  beforeEach(() => {
    store = new RuntimeStore(":memory:");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("XSyncService", () => {
    it("should construct with store", () => {
      const service = new XSyncService(store);
      expect(service).toBeDefined();
    });

    it("should return error when API credentials not configured", async () => {
      const mockClient = {
        isConfigured: () => false
      } as unknown as XClient;

      const service = new XSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain("X API credentials not configured");
      expect(result.errorCode).toBe("not_configured");
      expect(result.tweetsCount).toBe(0);
    });

    it("should fetch home timeline when configured", async () => {
      const mockTweets = [
        {
          id: "1234567890",
          text: "This is a test tweet",
          authorId: "user123",
          authorUsername: "testuser",
          authorName: "Test User",
          createdAt: "2024-01-01T00:00:00Z",
          likeCount: 10,
          retweetCount: 5,
          replyCount: 2,
          conversationId: "1234567890"
        },
        {
          id: "1234567891",
          text: "Another test tweet",
          authorId: "user456",
          authorUsername: "anotheruser",
          authorName: "Another User",
          createdAt: "2024-01-01T01:00:00Z",
          likeCount: 20,
          retweetCount: 10,
          replyCount: 5,
          conversationId: "1234567891"
        }
      ];

      const mockClient = {
        isConfigured: () => true,
        fetchHomeTimeline: async () => mockTweets
      } as unknown as XClient;

      const service = new XSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(true);
      expect(result.tweetsCount).toBe(2);
      expect(result.error).toBeUndefined();

      // Verify data was stored
      const storedData = store.getXData();
      expect(storedData).toBeDefined();
      expect(storedData?.tweets).toHaveLength(2);
      expect(storedData?.tweets[0]?.text).toBe("This is a test tweet");
      expect(storedData?.lastSyncedAt).toBeDefined();
    });

    it("should handle sync errors gracefully", async () => {
      const mockClient = {
        isConfigured: () => true,
        fetchHomeTimeline: async () => {
          throw new Error("API rate limit exceeded");
        }
      } as unknown as XClient;

      const service = new XSyncService(store, mockClient);
      const result = await service.sync();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe("API rate limit exceeded");
      expect(result.tweetsCount).toBe(0);
    });

    it("should respect maxTweets option", async () => {
      const mockTweets = Array.from({ length: 100 }, (_, i) => ({
        id: `tweet${i}`,
        text: `Tweet ${i}`,
        authorId: "user123",
        authorUsername: "testuser",
        authorName: "Test User",
        createdAt: "2024-01-01T00:00:00Z",
        likeCount: 0,
        retweetCount: 0,
        replyCount: 0,
        conversationId: `tweet${i}`
      }));

      let requestedMax = 0;
      const mockClient = {
        isConfigured: () => true,
        fetchHomeTimeline: async (maxResults?: number) => {
          requestedMax = maxResults ?? 50;
          return mockTweets.slice(0, requestedMax);
        }
      } as unknown as XClient;

      const service = new XSyncService(store, mockClient);
      const result = await service.sync({ maxTweets: 25 });
      
      expect(result.success).toBe(true);
      expect(requestedMax).toBe(25);
      expect(result.tweetsCount).toBe(25);
    });

    it("should return actionable empty-feed diagnostics when X returns no tweets", async () => {
      const mockClient = {
        isConfigured: () => true,
        fetchHomeTimeline: async () => []
      } as unknown as XClient;

      const service = new XSyncService(store, mockClient);
      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.tweetsCount).toBe(0);
      expect(result.errorCode).toBe("empty");
      expect(result.error).toContain("returned no tweets");
    });

    it("should start and stop sync intervals", () => {
      const service = new XSyncService(store);
      
      // Start with very long interval to prevent actual syncing during test
      service.start(1000000);
      
      // Stop should not throw
      service.stop();
      
      // Multiple stops should be safe
      service.stop();
    });
  });

  describe("XClient", () => {
    it("should detect when not configured", () => {
      const client = new XClient("", "", "", "", "");
      expect(client.isConfigured()).toBe(false);
    });

    it("should detect when configured with all OAuth credentials", () => {
      const client = new XClient("key", "secret", "token", "tokenSecret", "bearer");
      expect(client.isConfigured()).toBe(true);
    });

    it("should detect bearer-token-only configuration", () => {
      const client = new XClient("", "", "", "", "bearer-token-only");
      expect(client.isConfigured()).toBe(true);
    });

    it("should detect incomplete OAuth configuration", () => {
      // Missing access token secret
      const client1 = new XClient("key", "secret", "token", "", "");
      expect(client1.isConfigured()).toBe(false);

      // Missing API key
      const client2 = new XClient("", "secret", "token", "tokenSecret", "");
      expect(client2.isConfigured()).toBe(false);
    });
  });

  describe("RuntimeStore X data methods", () => {
    it("should store and retrieve X data", () => {
      const xData = {
        tweets: [
          {
            id: "1",
            text: "Test tweet",
            authorId: "user1",
            authorUsername: "testuser",
            authorName: "Test User",
            createdAt: "2024-01-01T00:00:00Z",
            likeCount: 5,
            retweetCount: 2,
            replyCount: 1,
            conversationId: "1"
          }
        ],
        lastSyncedAt: "2024-01-01T12:00:00Z"
      };

      store.setXData(xData);
      const retrieved = store.getXData();

      expect(retrieved).toEqual(xData);
    });

    it("should return null when no X data exists", () => {
      const data = store.getXData();
      expect(data).toBeNull();
    });

    it("should update X data on subsequent sets", () => {
      const data1 = {
        tweets: [
          {
            id: "1",
            text: "First tweet",
            authorId: "user1",
            authorUsername: "user1",
            authorName: "User 1",
            createdAt: "2024-01-01T00:00:00Z",
            likeCount: 0,
            retweetCount: 0,
            replyCount: 0,
            conversationId: "1"
          }
        ],
        lastSyncedAt: "2024-01-01T00:00:00Z"
      };

      const data2 = {
        tweets: [
          {
            id: "2",
            text: "Second tweet",
            authorId: "user2",
            authorUsername: "user2",
            authorName: "User 2",
            createdAt: "2024-01-02T00:00:00Z",
            likeCount: 10,
            retweetCount: 5,
            replyCount: 2,
            conversationId: "2"
          }
        ],
        lastSyncedAt: "2024-01-02T00:00:00Z"
      };

      store.setXData(data1);
      store.setXData(data2);
      
      const retrieved = store.getXData();
      expect(retrieved).toEqual(data2);
    });
  });
});
