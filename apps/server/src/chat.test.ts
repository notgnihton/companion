import { describe, it, expect, beforeEach, vi } from "vitest";
import { RuntimeStore } from "./store.js";
import { sendChatMessage, compressChatContext, RateLimitError } from "./chat.js";
import type { GeminiClient } from "./gemini.js";

describe("chat service", () => {
  let store: RuntimeStore;
  let fakeGemini: GeminiClient;
  let generateChatResponse: any;
  let generateLiveChatResponse: any;

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
    generateLiveChatResponse = vi.fn(async (request: {
      messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
      systemInstruction: string;
      tools?: unknown;
      onToolCall: (calls: Array<{ id?: string; name: string; args: Record<string, unknown> }>) => Promise<
        Array<{ id?: string; name: string; response: unknown }>
      >;
    }) => {
      const workingMessages = [...request.messages];
      let response = await generateChatResponse({
        messages: workingMessages,
        systemInstruction: request.systemInstruction,
        tools: request.tools
      });
      let round = 0;

      while (Array.isArray(response.functionCalls) && response.functionCalls.length > 0 && round < 8) {
        round += 1;
        const liveCalls = response.functionCalls.map(
          (fnCall: { name: string; args?: Record<string, unknown> }, index: number) => ({
            id: `${round}-${index}`,
            name: fnCall.name,
            args: (fnCall.args ?? {}) as Record<string, unknown>
          })
        );
        const toolResponses = await request.onToolCall(liveCalls);

        workingMessages.push({
          role: "model",
          parts: response.functionCalls.map((fnCall: unknown) => ({
            functionCall: fnCall
          }))
        });

        workingMessages.push({
          role: "function",
          parts: liveCalls.map((call: { id?: string; name: string; args: Record<string, unknown> }) => {
            const matched =
              toolResponses.find((responseEntry) => responseEntry.id === call.id) ??
              toolResponses.find((responseEntry) => responseEntry.name === call.name);
            return {
              functionResponse: {
                name: call.name,
                response: matched?.response ?? {}
              }
            };
          })
        });

        response = await generateChatResponse({
          messages: workingMessages,
          systemInstruction: request.systemInstruction,
          tools: request.tools
        });
      }

      return response;
    });
    fakeGemini = {
      generateChatResponse,
      generateLiveChatResponse
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
    });

    expect(generateChatResponse).toHaveBeenCalled();
    expect(result.reply).toContain("quick plan");
    expect(result.assistantMessage.metadata?.contextWindow).toBe("");
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
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toBe("");
  });

  it("omits social media context from prompt window even when social data exists", async () => {
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
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    
    expect(contextWindow).toBe("");
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
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toBe("");
  });

  it("does not inject social fallback text into prompt context", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    const result = await sendChatMessage(store, "Any new videos?", {
      geminiClient: fakeGemini,
      now,
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toBe("");
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
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;

    // Check unread count
    expect(contextWindow).toBe("");
  });

  it("shows fallback message when no Gmail messages are synced", async () => {
    const now = new Date("2026-02-16T09:00:00.000Z");

    const result = await sendChatMessage(store, "Check my emails", {
      geminiClient: fakeGemini,
      now,
    });

    expect(generateChatResponse).toHaveBeenCalled();
    const contextWindow = result.assistantMessage.metadata?.contextWindow;
    expect(contextWindow).toBe("");
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What is due this week?", {
      geminiClient: fakeGemini,
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

  it("hydrates generic getDeadlines calls with inferred course code from user text", async () => {
    const dueSoon = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const dat560 = store.createDeadline({
      course: "DAT560",
      task: "Assignment 2",
      dueDate: dueSoon,
      priority: "high",
      completed: false
    });
    store.createDeadline({
      course: "DAT520",
      task: "Lab 4",
      dueDate: dueSoon,
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
            args: {}
          }
        ]
      })
      .mockResolvedValueOnce({
        text: "You have one DAT560 deadline coming up.",
        finishReason: "stop"
      });
    fakeGemini = {
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    await sendChatMessage(store, "What deadlines do I have for DAT560?", {
      geminiClient: fakeGemini,
    });

    const secondRequest = generateChatResponse.mock.calls[1][0] as {
      messages: Array<{ role: string; parts: Array<Record<string, unknown>> }>;
    };
    const functionResponseMessage = secondRequest.messages[secondRequest.messages.length - 1];
    const fnResponse = functionResponseMessage.parts[0]?.functionResponse as
      | { name: string; response: Record<string, unknown> }
      | undefined;

    expect(functionResponseMessage.role).toBe("function");
    expect(fnResponse?.name).toBe("getDeadlines");
    expect(fnResponse?.response?.total).toBe(1);
    const deadlines = fnResponse?.response?.deadlines as Array<Record<string, unknown>>;
    expect(deadlines[0]?.id).toBe(dat560.id);
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What does DAT560 say about deliverables?", {
      geminiClient: fakeGemini,
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
      startTime: now.toISOString(),
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What's up today and what's due?", {
      geminiClient: fakeGemini,
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What is my schedule today?", {
      geminiClient: fakeGemini,
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.reply).toContain("I fetched your data");
    expect(result.reply).toContain("Schedule today");
  });

  it("uses model-driven tool routing instruction without local intent markers", async () => {
    await sendChatMessage(store, "What's my lecture schedule today?", {
      geminiClient: fakeGemini,
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Tool routing is model-driven");
    expect(firstRequest.systemInstruction).not.toContain("Detected intent:");
    expect(firstRequest.systemInstruction).not.toContain("Few-shot intent routing examples");
  });

  it("keeps generic tool-use behavior hints in function-calling instruction", async () => {
    await sendChatMessage(store, "How do I export a backup and restore it later?", {
      geminiClient: fakeGemini,
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("For factual questions about schedule, deadlines, journal, email");
    expect(firstRequest.systemInstruction).toContain("For journal-save requests, call createJournalEntry directly");
    expect(firstRequest.systemInstruction).toContain(
      "For deadline mutations, use queueDeadlineAction and require explicit user confirmation."
    );
    expect(firstRequest.systemInstruction).toContain(
      "For schedule mutations, execute immediately with createScheduleBlock/updateScheduleBlock/deleteScheduleBlock/clearScheduleWindow."
    );
  });

  it("preserves markdown styling in assistant output", async () => {
    generateChatResponse = vi.fn(async () => ({
      text: "**OK**. Today's schedule includes:\n\n* **DAT520 Laboratorium /Lab** from 09:15 to 11:00\n* **DAT520 Forelesning /Lecture** from 11:15 to 13:00",
      finishReason: "stop"
    }));
    fakeGemini = {
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "How is my schedule looking?", {
      geminiClient: fakeGemini,
    });

    expect(result.reply).toContain("**OK**. Today's schedule includes");
    expect(result.reply).toContain("* **DAT520 Laboratorium /Lab** from 09:15 to 11:00");
    expect(result.reply).toContain("* **DAT520 Forelesning /Lecture** from 11:15 to 13:00");
  });

  it("keeps email follow-up handling model-driven (no local email intent override marker)", async () => {
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
    });

    const firstRequest = generateChatResponse.mock.calls[0][0] as { systemInstruction: string };
    expect(firstRequest.systemInstruction).toContain("Tool routing is model-driven");
    expect(firstRequest.systemInstruction).not.toContain("Detected intent: emails");
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    await sendChatMessage(store, "What did my last email contain?", {
      geminiClient: fakeGemini,
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
    for (let index = 0; index < 40; index += 1) {
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    await sendChatMessage(store, "Give me all upcoming deadlines", {
      geminiClient: fakeGemini,
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
    expect(fnResponse?.response?.total).toBe(30);
    expect(fnResponse?.response?.truncated).toBe(true);

    const deadlines = fnResponse?.response?.deadlines as unknown[];
    expect(Array.isArray(deadlines)).toBe(true);
    expect(deadlines.length).toBe(24);
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "What's my schedule today?", {
      geminiClient: fakeGemini,
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Mark DAT560 Assignment 2 as complete", {
      geminiClient: fakeGemini,
    });

    expect(generateChatResponse).toHaveBeenCalledTimes(2);
    expect(result.assistantMessage.metadata?.pendingActions?.length).toBe(1);
    expect(result.reply).toContain("need your confirmation");
    expect(result.reply).toContain("confirm ");
  });

  it("autocaptures repeated commitment language into a habit creation pending action", async () => {
    store.recordChatMessage("user", "I keep missing morning gym lately.");

    const result = await sendChatMessage(store, "I want to do morning gym consistently.", {
      geminiClient: fakeGemini,
    });

    expect(generateChatResponse).not.toHaveBeenCalled();
    expect(result.reply).toContain("Why this suggestion");
    expect(result.reply).toContain("Confirm/Cancel buttons");
    expect(result.assistantMessage.metadata?.pendingActions).toHaveLength(1);
    expect(result.assistantMessage.metadata?.pendingActions?.[0]).toMatchObject({
      actionType: "create-habit"
    });
  });

  it("autocaptures repeated struggle language into habit update and executes on confirm", async () => {
    const habit = store.createHabit({
      name: "Morning gym",
      cadence: "daily",
      targetPerWeek: 5
    });

    store.recordChatMessage("user", "I keep missing morning gym.");

    const suggestion = await sendChatMessage(store, "I keep missing morning gym this week.", {
      geminiClient: fakeGemini,
    });

    expect(generateChatResponse).not.toHaveBeenCalled();

    const pendingAction = suggestion.assistantMessage.metadata?.pendingActions?.[0];
    expect(pendingAction).toBeDefined();
    expect(pendingAction?.actionType).toBe("update-habit");

    const confirmResult = await sendChatMessage(store, `confirm ${pendingAction?.id}`, {
      geminiClient: fakeGemini,
    });

    expect(confirmResult.assistantMessage.metadata?.actionExecution?.status).toBe("confirmed");
    expect(store.getHabitById(habit.id)?.targetPerWeek).toBe(4);
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Add this to my journal: First conversation with my AI assistant.", {
      geminiClient: fakeGemini,
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "How are my habits and goals going?", {
      geminiClient: fakeGemini,
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
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await sendChatMessage(store, "Create a habit called Study sprint", {
      geminiClient: fakeGemini,
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

  it("compresses older chat context via Gemini", async () => {
    store.recordChatMessage("user", "Need to finish DAT560 lab by Thursday evening.");
    store.recordChatMessage("assistant", "Plan two focused blocks for DAT560 and one review block.");
    store.recordChatMessage("user", "Latest short ping");
    store.recordChatMessage("assistant", "Latest short pong");

    generateChatResponse = vi.fn().mockResolvedValue({
      text: "1) Active objectives\n- Finish DAT560 lab\n2) Deadlines and dates\n- DAT560 lab by Thursday evening",
      finishReason: "stop"
    });
    fakeGemini = {
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await compressChatContext(store, {
      geminiClient: fakeGemini,
      maxMessages: 50,
      preserveRecentMessages: 2,
      targetSummaryChars: 2200
    });

    expect(["live", "standard"]).toContain(result.usedModelMode);
    expect(result.compressedMessageCount).toBe(2);
    expect(result.preservedMessageCount).toBe(2);
    expect(result.summary).toContain("Active objectives");
    expect(generateChatResponse).toHaveBeenCalledTimes(1);

    const request = generateChatResponse.mock.calls[0][0] as {
      messages: Array<{ parts: Array<{ text?: string }> }>;
    };
    const promptText = request.messages[0]?.parts[0]?.text ?? "";
    expect(promptText).toContain("Conversation transcript to compress");
    expect(promptText).toContain("Need to finish DAT560 lab");
    expect(promptText).not.toContain("Latest short ping");
  });

  it("falls back to heuristic compression when model call fails", async () => {
    store.recordChatMessage("user", "I want to keep a daily study sprint after dinner.");
    store.recordChatMessage("assistant", "Great, we can track this as a habit with check-ins.");
    store.recordChatMessage("user", "Also keep gym at 07:00 before class.");

    generateChatResponse = vi.fn().mockRejectedValue(new RateLimitError("Temporary 429"));
    fakeGemini = {
      generateChatResponse,
      generateLiveChatResponse
    } as unknown as GeminiClient;

    const result = await compressChatContext(store, {
      geminiClient: fakeGemini,
      maxMessages: 30,
      preserveRecentMessages: 0,
      targetSummaryChars: 1800
    });

    expect(result.usedModelMode).toBe("fallback");
    expect(result.summary).toContain("Compressed context snapshot");
    expect(result.summary).toContain("daily study sprint");
    expect(result.summary).toContain("gym at 07:00");
  });
});
