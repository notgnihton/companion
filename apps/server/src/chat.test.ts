import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { sendChatMessage } from "./chat.js";
import type { GeminiClient } from "./gemini.js";

describe("chat service", () => {
  let store: RuntimeStore;
  let fakeGemini: GeminiClient;
  let generateChatResponse: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new RuntimeStore(":memory:");
    generateChatResponse = vi.fn(async () => ({
      text: "Here's a quick plan for your day.",
      finishReason: "stop",
      usageMetadata: {
        promptTokenCount: 12,
        candidatesTokenCount: 6,
        totalTokenCount: 18
      }
    }));
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;
  });

  it("builds chat context and stores conversation history", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    store.createLectureEvent({
      title: "DAT520 Lecture",
      startTime: "2026-02-16T10:15:00.000Z",
      durationMinutes: 90,
      workload: "medium"
    });

    store.createDeadline({
      course: "DAT560",
      task: "Assignment 1",
      dueDate: "2026-02-18T23:59:00.000Z",
      priority: "high",
      completed: false
    });

    store.recordJournalEntry("Reflected on yesterday's study session.");

    const result = await sendChatMessage(store, "What should I focus on today?", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    expect(result.reply).toContain("quick plan");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Canvas data");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("DAT520 Lecture");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Assignment 1");
    expect(result.assistantMessage.metadata?.contextWindow).toContain("Reflected on yesterday's study session.");
    expect(result.assistantMessage.metadata?.usage?.totalTokens).toBe(18);

    const history = store.getChatHistory({ page: 1, pageSize: 5 });
    expect(history.messages).toHaveLength(2);
    expect(history.messages[0].role).toBe("assistant");
    expect(history.messages[1].role).toBe("user");
  });

  it("includes Canvas announcements in context when available", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    store.setCanvasData({
      courses: [],
      assignments: [],
      modules: [],
      announcements: [
        {
          id: 1,
          title: "Important Course Update",
          message: "<p>Please review the updated syllabus and assignment schedule for this semester.</p>",
          posted_at: "2026-02-15T10:00:00.000Z",
          author: { display_name: "Professor Smith" },
          context_code: "course_123"
        },
        {
          id: 2,
          title: "Lab Session Reminder",
          message: "<p>Remember to bring your laptop to the lab session tomorrow.</p>",
          posted_at: "2026-02-14T12:00:00.000Z",
          author: { display_name: "TA Johnson" },
          context_code: "course_123"
        }
      ],
      lastSyncedAt: "2026-02-16T08:00:00.000Z"
    });

    const result = await sendChatMessage(store, "What's new?", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toContain("Canvas Announcements");
    expect(contextWindow).toContain("Important Course Update");
    expect(contextWindow).toContain("Lab Session Reminder");
    expect(contextWindow).toContain("Feb 15");
    expect(contextWindow).toContain("Feb 14");
  });

  it("includes social media context (YouTube and X) when available", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    // Add YouTube data
    store.setYouTubeData({
      channels: [
        {
          id: "UC1",
          title: "Fireship",
          description: "Tech content",
          thumbnailUrl: "https://example.com/thumb.jpg",
          subscriberCount: 1000000
        }
      ],
      videos: [
        {
          id: "vid1",
          channelId: "UC1",
          channelTitle: "Fireship",
          title: "GPT-5 in 100 seconds",
          description: "A quick overview of GPT-5",
          publishedAt: "2026-02-15T10:00:00.000Z",
          thumbnailUrl: "https://example.com/vid1.jpg",
          duration: "PT2M30S",
          viewCount: 50000,
          likeCount: 5000,
          commentCount: 200
        },
        {
          id: "vid2",
          channelId: "UC1",
          channelTitle: "Fireship",
          title: "React 19 Features Explained",
          description: "New React 19 features",
          publishedAt: "2026-02-14T14:00:00.000Z",
          thumbnailUrl: "https://example.com/vid2.jpg",
          duration: "PT5M15S",
          viewCount: 75000,
          likeCount: 7500,
          commentCount: 300
        }
      ],
      lastSyncedAt: "2026-02-16T08:00:00.000Z"
    });

    // Add X/Twitter data
    store.setXData({
      tweets: [
        {
          id: "1234567890",
          text: "Just released a major update to our AI platform! Check out the new features at example.com/updates",
          authorId: "author1",
          authorUsername: "kaborneai",
          authorName: "Kaborne AI",
          createdAt: "2026-02-15T16:00:00.000Z",
          likeCount: 4500,
          retweetCount: 1200,
          replyCount: 350,
          conversationId: "conv1"
        },
        {
          id: "1234567891",
          text: "Interesting thoughts on the future of distributed systems in cloud computing",
          authorId: "author2",
          authorUsername: "techlead",
          authorName: "Tech Lead",
          createdAt: "2026-02-15T08:00:00.000Z",
          likeCount: 2300,
          retweetCount: 560,
          replyCount: 120,
          conversationId: "conv2"
        }
      ],
      lastSyncedAt: "2026-02-16T08:00:00.000Z"
    });

    const result = await sendChatMessage(store, "What did I miss on X? Any new AI videos?", {
      geminiClient: fakeGemini,
      now
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    
    // Check YouTube context
    expect(contextWindow).toContain("Recent YouTube Videos");
    expect(contextWindow).toContain("Fireship");
    expect(contextWindow).toContain("GPT-5 in 100 seconds");
    
    // Check X/Twitter context
    expect(contextWindow).toContain("Recent Posts on X");
    expect(contextWindow).toContain("@kaborneai");
    expect(contextWindow).toContain("major update to our AI platform");
  });

  it("shows fallback message when no social media data is synced", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    const result = await sendChatMessage(store, "Any new videos?", {
      geminiClient: fakeGemini,
      now
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toContain("Social media: No recent data synced");
  });
});
