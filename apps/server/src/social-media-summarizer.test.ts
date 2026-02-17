import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocialMediaSummarizer } from "./social-media-summarizer.js";
import { GeminiClient } from "./gemini.js";
import { YouTubeData, XData } from "./types.js";

describe("SocialMediaSummarizer", () => {
  let mockGeminiClient: GeminiClient;
  let summarizer: SocialMediaSummarizer;

  beforeEach(() => {
    mockGeminiClient = {
      generateChatResponse: vi.fn(),
      isConfigured: vi.fn().mockReturnValue(true)
    } as unknown as GeminiClient;

    summarizer = new SocialMediaSummarizer(mockGeminiClient);
  });

  const mockYouTubeData: YouTubeData = {
    channels: [],
    videos: [
      {
        id: "vid1",
        channelId: "ch1",
        channelTitle: "AI Weekly",
        title: "GPT-5 Announcement and What It Means",
        description: "Deep dive into the latest GPT-5 release",
        publishedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        thumbnailUrl: "https://example.com/thumb1.jpg",
        duration: "PT10M30S",
        viewCount: 10000,
        likeCount: 500,
        commentCount: 100
      },
      {
        id: "vid2",
        channelId: "ch2",
        channelTitle: "Tech Reviews",
        title: "New MacBook Pro M4 Review",
        description: "Reviewing the latest MacBook Pro",
        publishedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        thumbnailUrl: "https://example.com/thumb2.jpg",
        duration: "PT15M20S",
        viewCount: 5000,
        likeCount: 200,
        commentCount: 50
      },
      {
        id: "vid3",
        channelId: "ch3",
        channelTitle: "Gaming Channel",
        title: "Best Indie Games of 2026",
        description: "Top indie games to play this year",
        publishedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        thumbnailUrl: "https://example.com/thumb3.jpg",
        duration: "PT20M15S",
        viewCount: 3000,
        likeCount: 150,
        commentCount: 30
      }
    ],
    lastSyncedAt: new Date().toISOString()
  };

  const mockXData: XData = {
    tweets: [
      {
        id: "tweet1",
        text: "Just saw the new Claude 3.5 Sonnet benchmarks. Mind-blowing improvements in coding!",
        authorId: "user1",
        authorUsername: "ai_enthusiast",
        authorName: "AI Enthusiast",
        createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        likeCount: 100,
        retweetCount: 20,
        replyCount: 10,
        conversationId: "conv1"
      },
      {
        id: "tweet2",
        text: "New startup funding: $50M for AI-powered developer tools. The future is here!",
        authorId: "user2",
        authorUsername: "tech_news",
        authorName: "Tech News Daily",
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        likeCount: 200,
        retweetCount: 50,
        replyCount: 25,
        conversationId: "conv2"
      }
    ],
    lastSyncedAt: new Date().toISOString()
  };

  describe("generateDigest", () => {
    it("should generate digest with default options", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse).mockResolvedValue({
        text: "1: AI news\n2: tech\n3: entertainment\n4: AI news\n5: tech",
        finishReason: "STOP"
      });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData);

      expect(digest).toBeDefined();
      expect(digest.totalVideos).toBe(3);
      expect(digest.totalTweets).toBe(2);
      expect(digest.metadata.summaryLength).toBe("detailed");
      expect(digest.metadata.focusAreas).toEqual(["AI news", "tech", "entertainment"]);
    });

    it("should filter content by time window", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse).mockResolvedValue({
        text: "1: AI news\n2: tech",
        finishReason: "STOP"
      });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData, {
        timeWindow: "24h"
      });

      // Only vid2 and tweet1 are within 24h
      expect(digest.totalVideos).toBeLessThanOrEqual(2);
      expect(digest.totalTweets).toBeLessThanOrEqual(1);
    });

    it("should respect maxVideos and maxTweets limits", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse).mockResolvedValue({
        text: "1: AI news",
        finishReason: "STOP"
      });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData, {
        maxVideos: 1,
        maxTweets: 1
      });

      expect(digest.totalVideos).toBeLessThanOrEqual(1);
      expect(digest.totalTweets).toBeLessThanOrEqual(1);
    });

    it("should handle empty data gracefully", async () => {
      const emptyYouTube: YouTubeData = { channels: [], videos: [], lastSyncedAt: null };
      const emptyX: XData = { tweets: [], lastSyncedAt: null };

      const digest = await summarizer.generateDigest(emptyYouTube, emptyX);

      expect(digest.totalVideos).toBe(0);
      expect(digest.totalTweets).toBe(0);
      expect(digest.topics.length).toBe(0);
    });

    it("should handle null data inputs", async () => {
      const digest = await summarizer.generateDigest(null, null);

      expect(digest.totalVideos).toBe(0);
      expect(digest.totalTweets).toBe(0);
      expect(digest.topics.length).toBe(0);
    });

    it("should use custom focus areas", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse).mockResolvedValue({
        text: "1: AI news\n2: AI news",
        finishReason: "STOP"
      });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData, {
        focusAreas: ["AI news"]
      });

      expect(digest.metadata.focusAreas).toEqual(["AI news"]);
    });

    it("should generate different summary lengths", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse)
        .mockResolvedValueOnce({
          text: "1: AI news\n2: tech\n3: entertainment\n4: AI news\n5: tech",
          finishReason: "STOP"
        })
        .mockResolvedValue({
          text: "Brief summary.",
          finishReason: "STOP"
        });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData, {
        summaryLength: "brief"
      });

      expect(digest.metadata.summaryLength).toBe("brief");
    });

    it("should fall back to keyword matching if Gemini categorization fails", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse)
        .mockRejectedValueOnce(new Error("Gemini API error"))
        .mockResolvedValue({
          text: "Fallback summary.",
          finishReason: "STOP"
        });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData);

      expect(digest).toBeDefined();
      expect(digest.topics.length).toBeGreaterThan(0);
    });

    it("should sort items by engagement", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse)
        .mockResolvedValueOnce({
          text: "1: tech\n2: tech\n3: tech\n4: tech\n5: tech",
          finishReason: "STOP"
        })
        .mockResolvedValue({
          text: "Tech summary.",
          finishReason: "STOP"
        });

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData, {
        focusAreas: ["tech"]
      });

      const techTopic = digest.topics.find((t) => t.topic === "tech");
      expect(techTopic).toBeDefined();
      
      if (techTopic && techTopic.items.length > 1) {
        // Check that items are sorted by engagement (descending)
        for (let i = 0; i < techTopic.items.length - 1; i++) {
          const currentEngagement = techTopic.items[i]?.engagement ?? 0;
          const nextEngagement = techTopic.items[i + 1]?.engagement ?? 0;
          expect(currentEngagement).toBeGreaterThanOrEqual(nextEngagement);
        }
      }
    });

    it("should generate fallback summary if Gemini summarization fails", async () => {
      vi.mocked(mockGeminiClient.generateChatResponse)
        .mockResolvedValueOnce({
          text: "1: AI news\n2: tech",
          finishReason: "STOP"
        })
        .mockRejectedValue(new Error("Gemini API error"));

      const digest = await summarizer.generateDigest(mockYouTubeData, mockXData);

      expect(digest).toBeDefined();
      expect(digest.topics.length).toBeGreaterThan(0);
      // Each topic should have a summary (even if fallback)
      digest.topics.forEach((topic) => {
        expect(topic.summary).toBeTruthy();
        expect(typeof topic.summary).toBe("string");
      });
    });
  });
});
