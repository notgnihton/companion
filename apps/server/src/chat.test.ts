import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { sendChatMessage, RateLimitError } from "./chat.js";
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

  it("adds GitHub course citations when getGitHubCourseContent tool is used", async () => {
    const nowIso = new Date().toISOString();
    store.setGitHubCourseData({
      repositories: [{ owner: "dat560-2026", repo: "info", courseCode: "DAT560" }],
      documents: [
        {
          id: "doc-dat560-syllabus",
          courseCode: "DAT560",
          owner: "dat560-2026",
          repo: "info",
          path: "docs/syllabus.md",
          url: "https://github.com/dat560-2026/info/blob/HEAD/docs/syllabus.md",
          title: "DAT560 Syllabus",
          summary: "Project grading and deliverables.",
          highlights: ["Project milestones", "Deliverables"],
          snippet: "Deliverables include proposal, implementation, and final report.",
          syncedAt: nowIso
        }
      ],
      deadlinesSynced: 1,
      lastSyncedAt: nowIso
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getGitHubCourseContent",
            args: { courseCode: "DAT560", query: "deliverables" }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "The DAT560 syllabus lists proposal, implementation, and report deliverables.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What does DAT560 say about deliverables?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "doc-dat560-syllabus",
          type: "github-course-doc",
          metadata: expect.objectContaining({
            owner: "dat560-2026",
            repo: "info",
            path: "docs/syllabus.md"
          })
        })
      ])
    );
  });

  it("supports multiple tool-call rounds before returning final text", async () => {
    const now = new Date();
    const schedule = store.createLectureEvent({
      title: "DAT520 Lecture",
      startTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "medium"
    });
    const deadline = store.createDeadline({
      course: "DAT560",
      task: "Assignment 2",
      dueDate: new Date(now.getTime() + 26 * 60 * 60 * 1000).toISOString(),
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
            name: "getSchedule",
            args: {}
          }
        ]
      })
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
        text: "You have one lecture today and one high-priority deadline due soon.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What's up today and what's due?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(3);
    expect(result.reply).toContain("one lecture today");
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: schedule.id, type: "schedule" }),
        expect.objectContaining({ id: deadline.id, type: "deadline" })
      ])
    );
  });

  it("returns a tool-data fallback instead of generic failure when final text is empty", async () => {
    const now = new Date();
    store.createLectureEvent({
      title: "DAT520 Lecture",
      startTime: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "medium"
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getSchedule",
            args: {}
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What is my schedule today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.reply).toContain("I fetched your data");
    expect(result.reply).toContain("Schedule today");
  });

  it("injects schedule intent guidance into function-calling instruction", async () => {
    await sendChatMessage(store, "What's my lecture schedule today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: schedule");
    expect(firstRequest.systemInstruction).toContain("Prefer getSchedule first");
  });

  it("injects journal intent guidance into function-calling instruction", async () => {
    await sendChatMessage(store, "What have I written in my journal?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: journal");
    expect(firstRequest.systemInstruction).toContain("Prefer searchJournal");
  });

  it("injects habits/goals intent guidance with tool hints", async () => {
    await sendChatMessage(store, "Can you check in my study sprint habit today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: habits-goals");
    expect(firstRequest.systemInstruction).toContain("getHabitsGoalsStatus");
    expect(firstRequest.systemInstruction).toContain("updateHabitCheckIn");
    expect(firstRequest.systemInstruction).toContain("createHabit");
    expect(firstRequest.systemInstruction).toContain("deleteHabit");
    expect(firstRequest.systemInstruction).toContain("createGoal");
    expect(firstRequest.systemInstruction).toContain("deleteGoal");
  });

  it("falls back to general intent when no specific domain keywords are present", async () => {
    await sendChatMessage(store, "Hello there", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: general");
  });

  it("detects integration intent for sync/status questions", async () => {
    await sendChatMessage(store, "Is Canvas sync working and is Gmail connected?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: integrations");
    expect(firstRequest.systemInstruction).toContain("sync status");
  });

  it("detects data-management intent for export/import requests", async () => {
    await sendChatMessage(store, "How do I export a backup and restore it later?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: data-management");
    expect(firstRequest.systemInstruction).toContain("import/export/backup/restore");
  });

  it("injects few-shot routing examples into function-calling instruction", async () => {
    await sendChatMessage(store, "How is my schedule looking today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Few-shot intent routing examples");
    expect(firstRequest.systemInstruction).toContain("User: \"How is my schedule looking today?\"");
    expect(firstRequest.systemInstruction).toContain("Tool plan: Call getSchedule");
  });

  it("preserves markdown styling in assistant output", async () => {
    generateChatResponse = vi.fn(async () => ({
      text: "**OK**. Today's schedule includes:\n\n* **DAT520 Laboratorium /Lab** from 09:15 to 11:00\n* **DAT520 Forelesning /Lecture** from 11:15 to 13:00",
      finishReason: "stop"
    }));
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "How is my schedule looking?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.reply).toContain("**OK**. Today's schedule includes");
    expect(result.reply).toContain("* **DAT520 Laboratorium /Lab** from 09:15 to 11:00");
    expect(result.reply).toContain("* **DAT520 Forelesning /Lecture** from 11:15 to 13:00");
  });

  it("routes ambiguous follow-up questions to email intent when recent email context exists", async () => {
    store.recordChatMessage("assistant", "Recent emails (1): DAT560 Assignment update", {
      citations: [
        {
          id: "gmail-1",
          type: "email",
          label: "DAT560 Assignment update"
        }
      ]
    });

    await sendChatMessage(store, "what did it contain?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Detected intent: emails");
  });

  it("includes Gmail snippet/from/receivedAt in getEmails functionResponse payload", async () => {
    store.setGmailMessages(
      [
        {
          id: "gmail-123",
          from: "course@uis.no",
          subject: "DAT560 Assignment 2 reminder",
          snippet: "Please submit by Thursday 13:00 and include your report.",
          receivedAt: "2026-02-17T12:00:00.000Z",
          labels: ["INBOX", "UNREAD"],
          isRead: false
        }
      ],
      "2026-02-17T12:05:00.000Z"
    );

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getEmails",
            args: { limit: 1 }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "Your latest email is about DAT560 Assignment 2.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    await sendChatMessage(store, "What did my last email contain?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    const secondRequest = generateChatResponse.mock.calls[1][0] as {
      messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    const fnResponse = lastMessage.parts[0]?.functionResponse as
      | { name: string; response: Record<string, unknown> }
      | undefined;

    expect(lastMessage.role).toBe("function");
    expect(fnResponse?.name).toBe("getEmails");
    expect(fnResponse?.response?.total).toBe(1);

    const emails = fnResponse?.response?.emails as Array<Record<string, unknown>>;
    expect(Array.isArray(emails)).toBe(true);
    expect(emails[0]?.from).toBe("course@uis.no");
    expect(emails[0]?.receivedAt).toBe("2026-02-17T12:00:00.000Z");
    expect(emails[0]?.snippet).toContain("submit by Thursday");
    expect(emails[0]?.isRead).toBe(false);
  });

  it("compacts large tool responses before sending functionResponse payloads to Gemini", async () => {
    const now = Date.now();
    for (let index = 0; index < 12; index += 1) {
      store.createDeadline({
        course: "DAT560",
        task: `Assignment ${index + 1} with very long context details that are useful but should be bounded`,
        dueDate: new Date(now + (index + 1) * 24 * 60 * 60 * 1000).toISOString(),
        priority: "medium",
        completed: false
      });
    }

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getDeadlines",
            args: { daysAhead: 30 }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "You have multiple deadlines coming up.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    await sendChatMessage(store, "Give me all upcoming deadlines", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    const secondRequest = generateChatResponse.mock.calls[1][0] as {
      messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    const fnResponse = lastMessage.parts[0]?.functionResponse as
      | { name: string; response: Record<string, unknown> }
      | undefined;

    expect(lastMessage.role).toBe("function");
    expect(fnResponse?.name).toBe("getDeadlines");
    expect(fnResponse?.response?.total).toBe(12);
    expect(fnResponse?.response?.truncated).toBe(true);

    const deadlines = fnResponse?.response?.deadlines as unknown[];
    expect(Array.isArray(deadlines)).toBe(true);
    expect(deadlines.length).toBe(6);
  });

  it("returns a local fallback reply when second function-calling pass is rate limited", async () => {
    const now = new Date();
    store.createLectureEvent({
      title: "DAT520 Lecture",
      startTime: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
      durationMinutes: 90,
      workload: "medium"
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getSchedule",
            args: {}
          }
        ]
      })
      .mockRejectedValueOnce(new RateLimitError("Gemini API rate limit exceeded: provider 429"));
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What's my schedule today?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.finishReason).toBe("rate_limit_fallback");
    expect(result.reply).toContain("temporary rate limit");
    expect(result.reply).toContain("Schedule today");
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "schedule"
        })
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
    const deadline = store.createDeadline({
      course: "DAT560",
      task: "Assignment 2",
      dueDate: "2026-02-21T12:00:00.000Z",
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
            name: "queueDeadlineAction",
            args: { deadlineId: deadline.id, action: "complete" }
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

    const result = await sendChatMessage(store, "Mark DAT560 Assignment 2 as complete", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage.metadata?.pendingActions?.length).toBe(1);
    expect(result.reply).toContain("need your confirmation");
    expect(result.reply).toContain("confirm ");
  });

  it("creates journal entries immediately when Gemini calls createJournalEntry", async () => {
    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "createJournalEntry",
            args: { content: "First conversation with my AI assistant." }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "Saved your journal entry.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Add this to my journal: First conversation with my AI assistant.", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage.metadata?.pendingActions ?? []).toHaveLength(0);
    expect(result.reply).toContain("Saved your journal entry.");
    expect(store.searchJournalEntries({ query: "First conversation with my AI assistant.", limit: 5 }).length).toBe(1);
  });

  it("adds habit/goal citations when getHabitsGoalsStatus tool is used", async () => {
    const habit = store.createHabit({
      name: "Study sprint",
      cadence: "daily",
      targetPerWeek: 6
    });
    const goal = store.createGoal({
      title: "Finish DAT560 assignment",
      cadence: "weekly",
      targetCount: 3,
      dueDate: null
    });

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "getHabitsGoalsStatus",
            args: {}
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "You are tracking one habit and one goal today.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "How are my habits and goals going?", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: habit.id, type: "habit" }),
        expect.objectContaining({ id: goal.id, type: "goal" })
      ])
    );
  });

  it("creates habit from empty state when Gemini calls createHabit", async () => {
    expect(store.getHabitsWithStatus()).toHaveLength(0);

    generateChatResponse = vi
      .fn()
      .mockResolvedValueOnce({
        text: "",
        finishReason: "stop",
        functionCalls: [
          {
            name: "createHabit",
            args: {
              name: "Study sprint",
              cadence: "daily",
              targetPerWeek: 6
            }
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "Created a new habit: Study sprint.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Create a habit called Study sprint", {
      geminiClient: fakeGemini,
      useFunctionCalling: true
    });

    expect(result.reply).toContain("Created a new habit");
    expect(store.getHabitsWithStatus()).toHaveLength(1);
    expect(result.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "habit", label: "Study sprint" })
      ])
    );
  });

  it("stores and forwards image attachments with chat messages", async () => {
    const imageAttachment = {
      id: "img-1",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      mimeType: "image/png",
      fileName: "note.png"
    };

    await sendChatMessage(store, "", {
      geminiClient: fakeGemini,
      useFunctionCalling: true,
      attachments: [imageAttachment]
    });

    const firstCall = generateChatResponse.mock.calls[0]?.[0] as {
      messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const lastMessage = firstCall.messages[firstCall.messages.length - 1];
    const inlineData = lastMessage.parts.find((part) => "inlineData" in part)?.inlineData as
      | { mimeType: string; data: string }
      | undefined;

    expect(inlineData?.mimeType).toBe("image/png");
    expect(inlineData?.data).toBe("aGVsbG8=");

    const history = store.getRecentChatMessages(2);
    const user = history.find((message) => message.role === "user");
    expect(user?.metadata?.attachments).toEqual([imageAttachment]);
  });
});
