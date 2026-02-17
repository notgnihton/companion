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
      now,
      useFunctionCalling: false
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

  it("includes recommendation context for upcoming deadlines when relevant content exists", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    store.createDeadline({
      course: "DAT560",
      task: "VAE assignment",
      dueDate: "2026-02-18T23:59:00.000Z",
      priority: "high",
      completed: false
    });

    store.setYouTubeData({
      channels: [
        {
          id: "UC2",
          title: "GenAI Lab",
          description: "Generative AI tutorials",
          thumbnailUrl: "https://example.com/thumb2.jpg",
          subscriberCount: 500000
        }
      ],
      videos: [
        {
          id: "vae-vid",
          channelId: "UC2",
          channelTitle: "GenAI Lab",
          title: "VAE and transformer tutorial for DAT560 assignment",
          description: "A practical ML walkthrough",
          publishedAt: "2026-02-16T06:00:00.000Z",
          thumbnailUrl: "https://example.com/vae.jpg",
          duration: "PT12M",
          viewCount: 25000,
          likeCount: 2100,
          commentCount: 180
        }
      ],
      lastSyncedAt: "2026-02-16T08:00:00.000Z"
    });

    const result = await sendChatMessage(store, "What should I watch before DAT560?", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toContain("Recommended content for upcoming work");
    expect(contextWindow).toContain("VAE and transformer tutorial");
  });

  it("shows fallback message when no social media data is synced", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    const result = await sendChatMessage(store, "Any new videos?", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toContain("Social media: No recent data synced");
  });

  it("includes Gmail context with unread count and actionable items", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    // Add Gmail messages
    store.setGmailMessages(
      [
        {
          id: "msg1",
          from: "notifications@instructure.com",
          subject: "Lab 3 has been graded",
          snippet: "Your submission for Lab 3: gRPC has been graded. Score: 95/100",
          receivedAt: "2026-02-16T08:30:00.000Z",
          labels: ["INBOX", "UNREAD"],
          isRead: false
        },
        {
          id: "msg2",
          from: "github@notifications.github.com",
          subject: "PR merged: defnotai/server",
          snippet: "Your pull request has been merged into main",
          receivedAt: "2026-02-15T20:00:00.000Z",
          labels: ["INBOX", "UNREAD"],
          isRead: false
        },
        {
          id: "msg3",
          from: "professor@uis.no",
          subject: "Reminder: Assignment 2 deadline approaching",
          snippet: "Just a friendly reminder that Assignment 2 for DAT520 is due on Friday",
          receivedAt: "2026-02-15T14:00:00.000Z",
          labels: ["INBOX", "UNREAD"],
          isRead: false
        },
        {
          id: "msg4",
          from: "friend@example.com",
          subject: "Coffee tomorrow?",
          snippet: "Hey, want to grab coffee tomorrow afternoon?",
          receivedAt: "2026-02-14T12:00:00.000Z",
          labels: ["INBOX"],
          isRead: true
        }
      ],
      "2026-02-16T08:00:00.000Z"
    );

    const result = await sendChatMessage(store, "What's in my inbox?", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;

    // Check unread count
    expect(contextWindow).toContain("Gmail Inbox");
    expect(contextWindow).toContain("3 unread messages");

    // Check important senders (Canvas, GitHub, UiS)
    expect(contextWindow).toContain("Important senders");
    expect(contextWindow).toContain("notifications@instructure.com");
    expect(contextWindow).toContain("Lab 3 has been graded");

    // Check actionable items (graded, deadline, reminder keywords)
    expect(contextWindow).toContain("Actionable items");
    expect(contextWindow).toContain("Assignment 2 deadline approaching");
  });

  it("shows fallback message when no Gmail messages are synced", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    const result = await sendChatMessage(store, "Check my emails", {
      geminiClient: fakeGemini,
      now,
      useFunctionCalling: false
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toContain("Gmail: No emails synced yet");
  });

  it("adds deadline citations when getDeadlines tool is used", async () => {
    const dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const deadline = store.createDeadline({
      course: "DAT560",
      task: "Assignment 2",
      dueDate,
      priority: "high",
      completed: false
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getDeadlines",
            args: { daysAhead: 7 }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "You have one high-priority deadline this week.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What is due this week?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: deadline.id,
          type: "deadline"
        })
      ])
    );
    expect(result.assistantMessage.metadata?.citations).toEqual(result.citations);
  });

  it("adds social citations when getSocialDigest tool is used", async () => {
    const nowIso = new Date().toISOString();

    store.setYouTubeData({
      channels: [],
      videos: [
        {
          id: "yt-1",
          channelId: "ch-1",
          channelTitle: "ML Weekly",
          title: "Transformer fine-tuning walkthrough",
          description: "Guide for DAT560 prep",
          publishedAt: nowIso,
          thumbnailUrl: "https://example.com/thumb.jpg",
          duration: "PT8M",
          viewCount: 1200,
          likeCount: 90,
          commentCount: 12
        }
      ],
      lastSyncedAt: nowIso
    });

    store.setXData({
      tweets: [
        {
          id: "tweet-1",
          text: "New thread on practical gradient descent debugging.",
          authorId: "author-1",
          authorUsername: "mlnotes",
          authorName: "ML Notes",
          createdAt: nowIso,
          likeCount: 44,
          retweetCount: 9,
          replyCount: 3,
          conversationId: "conv-1"
        }
      ],
      lastSyncedAt: nowIso
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getSocialDigest",
            args: { daysBack: 3 }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "You have one relevant video and one X thread to review.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Anything useful from social today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "yt-1", type: "social-youtube" }),
        expect.objectContaining({ id: "tweet-1", type: "social-x" })
      ])
    );
  });

  it("executes pending action on explicit confirm command without Gemini call", async () => {
    const deadline = store.createDeadline({
      course: "DAT520",
      task: "Lab 5",
      dueDate: "2026-02-20T12:00:00.000Z",
      priority: "high",
      completed: false
    });
    const pending = store.createPendingChatAction({
      actionType: "complete-deadline",
      summary: "Complete DAT520 Lab 5",
      payload: { deadlineId: deadline.id }
    });

    const result = await sendChatMessage(store, `confirm ${pending.id}`, {
      geminiClient: fakeGemini
    });

    expect(generateChatResponse).not.toHaveBeenCalled();
    expect(result.reply).toContain("Marked DAT520 Lab 5 as completed");
    expect(result.assistantMessage.metadata?.actionExecution?.status).toBe("confirmed");
    expect(store.getDeadlineById(deadline.id, false)?.completed).toBe(true);
    expect(store.getPendingChatActions()).toHaveLength(0);
  });

  it("cancels pending action on explicit cancel command without Gemini call", async () => {
    const pending = store.createPendingChatAction({
      actionType: "create-journal-draft",
      summary: "Create draft",
      payload: { content: "Draft from chat" }
    });

    const result = await sendChatMessage(store, `cancel ${pending.id}`, {
      geminiClient: fakeGemini
    });

    expect(generateChatResponse).not.toHaveBeenCalled();
    expect(result.reply).toContain("Cancelled action");
    expect(result.assistantMessage.metadata?.actionExecution?.status).toBe("cancelled");
    expect(store.getPendingChatActions()).toHaveLength(0);
  });

  it("adds pending action metadata when Gemini queues an action tool call", async () => {
    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "queueJournalDraft",
            args: { content: "Draft a reflection from our chat." }
          }
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15
        }
      })
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        usageMetadata: {
          promptTokenCount: 9,
          candidatesTokenCount: 4,
          totalTokenCount: 13
        }
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Save this as a journal draft", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage.metadata?.pendingActions?.length).toBe(1);
    expect(result.reply).toContain("need your confirmation");
    expect(result.reply).toContain("confirm ");
  });
});
