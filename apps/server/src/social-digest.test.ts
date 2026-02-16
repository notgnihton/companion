import { describe, it, expect, beforeEach, vi } from "vitest";
import { SocialDigestService } from "./social-digest.js";
import { GeminiClient } from "./gemini.js";
import { YouTubeData } from "./types.js";

describe("SocialDigestService", () => {
  let service: SocialDigestService;
  let mockGeminiClient: GeminiClient;

  beforeEach(() => {
    mockGeminiClient = {
      isConfigured: vi.fn().mockReturnValue(false),
      generateChatResponse: vi.fn()
    } as unknown as GeminiClient;
    
    service = new SocialDigestService(mockGeminiClient);
  });

  it("should generate digest with no videos", async () => {
    const youtubeData: YouTubeData = {
      channels: [],
      videos: [],
      lastSyncedAt: null
    };

    const digest = await service.generateDigest(youtubeData, {
      hours: 24,
      platforms: ["youtube"]
    });

    expect(digest).toBeDefined();
    expect(digest.sections).toEqual([]);
    expect(digest.digest).toContain("No new content");
  });

  it("should categorize YouTube videos by topic", async () => {
    const now = new Date();
    const youtubeData: YouTubeData = {
      channels: [
        {
          id: "ch1",
          title: "AI Channel",
          description: "AI content",
          thumbnailUrl: "https://example.com/thumb.jpg",
          subscriberCount: 100000
        }
      ],
      videos: [
        {
          id: "vid1",
          channelId: "ch1",
          channelTitle: "AI Channel",
          title: "GPT-5 Released - Major AI News",
          description: "New AI model",
          publishedAt: now.toISOString(),
          thumbnailUrl: "https://example.com/thumb1.jpg",
          duration: "PT10M",
          viewCount: 50000,
          likeCount: 3000,
          commentCount: 500
        },
        {
          id: "vid2",
          channelId: "ch1",
          channelTitle: "AI Channel",
          title: "JavaScript Programming Tutorial",
          description: "Learn JS",
          publishedAt: now.toISOString(),
          thumbnailUrl: "https://example.com/thumb2.jpg",
          duration: "PT15M",
          viewCount: 30000,
          likeCount: 2000,
          commentCount: 300
        }
      ],
      lastSyncedAt: now.toISOString()
    };

    const digest = await service.generateDigest(youtubeData, {
      hours: 24,
      platforms: ["youtube"],
      focusAreas: ["AI news", "tech"]
    });

    expect(digest).toBeDefined();
    expect(digest.sections.length).toBeGreaterThan(0);
    
    // Check that videos are categorized
    const aiSection = digest.sections.find((s) => s.topic === "AI news");
    const techSection = digest.sections.find((s) => s.topic === "tech");
    
    expect(aiSection).toBeDefined();
    expect(techSection).toBeDefined();
    expect(aiSection!.items).toHaveLength(1);
    expect(techSection!.items).toHaveLength(1);
  });

  it("should filter videos by time range", async () => {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000); // 25 hours ago
    
    const youtubeData: YouTubeData = {
      channels: [],
      videos: [
        {
          id: "vid1",
          channelId: "ch1",
          channelTitle: "Test Channel",
          title: "Recent AI video",
          description: "New content",
          publishedAt: now.toISOString(),
          thumbnailUrl: "https://example.com/thumb.jpg",
          duration: "PT10M",
          viewCount: 1000,
          likeCount: 100,
          commentCount: 10
        },
        {
          id: "vid2",
          channelId: "ch1",
          channelTitle: "Test Channel",
          title: "Old AI video",
          description: "Old content",
          publishedAt: yesterday.toISOString(),
          thumbnailUrl: "https://example.com/thumb.jpg",
          duration: "PT10M",
          viewCount: 1000,
          likeCount: 100,
          commentCount: 10
        }
      ],
      lastSyncedAt: now.toISOString()
    };

    const digest = await service.generateDigest(youtubeData, {
      hours: 24,
      platforms: ["youtube"]
    });

    // Should only include the recent video
    const totalItems = digest.sections.reduce((sum, section) => sum + section.items.length, 0);
    expect(totalItems).toBe(1);
  });

  it("should include proper metadata in digest items", async () => {
    const now = new Date();
    const youtubeData: YouTubeData = {
      channels: [],
      videos: [
        {
          id: "test-vid",
          channelId: "test-ch",
          channelTitle: "Test Channel",
          title: "Test AI Video",
          description: "Test description",
          publishedAt: now.toISOString(),
          thumbnailUrl: "https://example.com/thumb.jpg",
          duration: "PT12M30S",
          viewCount: 5000,
          likeCount: 500,
          commentCount: 50
        }
      ],
      lastSyncedAt: now.toISOString()
    };

    const digest = await service.generateDigest(youtubeData, {
      hours: 24,
      platforms: ["youtube"]
    });

    const item = digest.sections[0]?.items[0];
    expect(item).toBeDefined();
    expect(item?.type).toBe("video");
    expect(item?.platform).toBe("youtube");
    expect(item?.title).toBe("Test AI Video");
    expect(item?.author).toBe("Test Channel");
    expect(item?.url).toBe("https://youtube.com/watch?v=test-vid");
    expect(item?.metadata).toBeDefined();
    expect(item?.metadata?.videoId).toBe("test-vid");
    expect(item?.metadata?.duration).toBe("PT12M30S");
  });
});
