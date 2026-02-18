import { describe, it, expect, beforeEach, vi } from "vitest";
import { Part } from "@google/generative-ai";
import {
  GeminiClient,
  GeminiError,
  RateLimitError,
  buildContextWindow,
  buildSystemPrompt,
  type GeminiChatRequest,
  type ContextWindow
} from "./gemini.js";
import type { Deadline, JournalEntry, LectureEvent, UserContext } from "./types.js";

describe("GeminiClient", () => {
  describe("initialization", () => {
    it("should initialize without API key", () => {
      const client = new GeminiClient(undefined);
      expect(client.isConfigured()).toBe(false);
    });

    it("should initialize with API key", () => {
      const client = new GeminiClient("test-api-key");
      expect(client.isConfigured()).toBe(true);
    });
  });

  describe("configuration check", () => {
    it("should throw error when Vertex project is not configured", async () => {
      const client = new GeminiClient(undefined);
      const request: GeminiChatRequest = {
        messages: [{ role: "user", parts: [{ text: "Hello" }] }]
      };

      await expect(client.generateChatResponse(request)).rejects.toThrow(
        "GEMINI_VERTEX_PROJECT_ID is required"
      );
    });
  });

  describe("request validation", () => {
    it("should throw error when message list is empty", async () => {
      const client = new GeminiClient("test-api-key");
      const request: GeminiChatRequest = {
        messages: []
      };

      await expect(client.generateChatResponse(request)).rejects.toThrow(
        "At least one message is required"
      );
    });

    it("should pass system instruction and tools to Vertex generateContent requests", async () => {
      const client = new GeminiClient("test-api-key");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              finish_reason: "STOP",
              content: {
                parts: [{ text: "Hello" }]
              }
            }
          ],
          usage_metadata: {
            prompt_token_count: 12,
            candidates_token_count: 6,
            total_token_count: 18
          }
        })
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
      (client as unknown as { getVertexAccessToken: () => Promise<string> }).getVertexAccessToken = async () => "token";
      (client as unknown as { normalizeVertexModelNameForGenerateContent: () => string }).normalizeVertexModelNameForGenerateContent =
        () => "projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash";

      const request: GeminiChatRequest = {
        messages: [{ role: "user", parts: [{ text: "Hello" }] }],
        systemInstruction: "Use tools when needed.",
        tools: [
          {
            name: "getSchedule",
            description: "Get schedule",
            parameters: {
              type: "object",
              properties: {}
            } as any
          }
        ]
      };

      const response = await client.generateChatResponse(request);

      expect(response.text).toBe("Hello");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body);
      expect(payload.system_instruction).toEqual({
        parts: [{ text: "Use tools when needed." }]
      });
      expect(payload.contents).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
      expect(payload.tools?.[0]?.function_declarations?.[0]?.name).toBe("getSchedule");
      vi.unstubAllGlobals();
    });

    it("uses global Vertex host when location is global", () => {
      const client = new GeminiClient("test-api-key");
      const asInternals = client as unknown as {
        resolveVertexApiHost: (location: string) => string;
      };

      expect(asInternals.resolveVertexApiHost("global")).toBe("aiplatform.googleapis.com");
      expect(asInternals.resolveVertexApiHost("us-central1")).toBe("us-central1-aiplatform.googleapis.com");
    });

    it("wraps non-object function responses for Vertex compatibility", async () => {
      const client = new GeminiClient("test-api-key");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              finish_reason: "STOP",
              content: {
                parts: [{ text: "ok" }]
              }
            }
          ]
        })
      });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
      (client as unknown as { getVertexAccessToken: () => Promise<string> }).getVertexAccessToken = async () => "token";
      (client as unknown as { normalizeVertexModelNameForGenerateContent: () => string }).normalizeVertexModelNameForGenerateContent =
        () => "projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash";

      await client.generateChatResponse({
        messages: [
          {
            role: "function",
            parts: [
              {
                functionResponse: {
                  name: "getSchedule",
                  response: ["a", "b", "c"]
                }
              } as unknown as Part
            ]
          }
        ]
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
      const payload = JSON.parse(init.body) as {
        contents: Array<{ parts: Array<{ function_response?: { response?: unknown } }> }>;
      };
      const functionResponse =
        payload.contents[0]?.parts?.[0]?.function_response?.response as { result?: unknown } | undefined;
      expect(functionResponse).toEqual({
        result: ["a", "b", "c"]
      });

      vi.unstubAllGlobals();
    });

    it("should retry transient 429 responses and return the recovered Vertex result", async () => {
      const client = new GeminiClient("test-api-key");

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 429
        })
        .mockResolvedValue({
          ok: true,
          json: async () => ({
            candidates: [
              {
                finish_reason: "STOP",
                content: { parts: [{ text: "Recovered" }] }
              }
            ]
          })
        });
      vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
      (client as unknown as { getVertexAccessToken: () => Promise<string> }).getVertexAccessToken = async () => "token";
      (client as unknown as { normalizeVertexModelNameForGenerateContent: () => string }).normalizeVertexModelNameForGenerateContent =
        () => "projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash";

      const timeoutSpy = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(
          ((handler: TimerHandler) => {
            if (typeof handler === "function") {
              handler();
            }
            return 0 as unknown as ReturnType<typeof setTimeout>;
          }) as unknown as typeof setTimeout
        );

      const response = await client.generateChatResponse({
        messages: [{ role: "user", parts: [{ text: "Retry test" }] }]
      });

      expect(response.text).toBe("Recovered");
      expect(fetchMock).toHaveBeenCalledTimes(2);
      timeoutSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });

  describe("error handling", () => {
    it("should create GeminiError with status code", () => {
      const error = new GeminiError("Test error", 500);
      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe("GeminiError");
    });

    it("should create RateLimitError", () => {
      const error = new RateLimitError();
      expect(error.message).toContain("rate limit");
      expect(error.statusCode).toBe(429);
      expect(error.name).toBe("RateLimitError");
    });

    it("should allow custom RateLimitError message", () => {
      const error = new RateLimitError("Gemini API rate limit exceeded: provider says too many requests");
      expect(error.message).toContain("provider says too many requests");
      expect(error.statusCode).toBe(429);
      expect(error.name).toBe("RateLimitError");
    });

    it("adds a global-location hint for Gemini 3 preview model 404s", () => {
      const client = new GeminiClient("test-api-key");
      const asInternals = client as unknown as {
        liveModelName: string;
        buildVertexModelNotFoundMessage: (errorBody: string, statusText: string) => string;
      };

      asInternals.liveModelName = "gemini-3-flash-preview";
      const message = asInternals.buildVertexModelNotFoundMessage("model not found", "NOT_FOUND");
      expect(message).toContain("GEMINI_VERTEX_LOCATION=global");
    });
  });
});

describe("buildContextWindow", () => {
  it("should build context with schedule only", () => {
    const schedule: LectureEvent[] = [
      {
        id: "1",
        title: "DAT520 Distributed Systems",
        startTime: "2026-02-16T10:15:00.000Z",
        durationMinutes: 90,
        workload: "medium"
      }
    ];

    const context: ContextWindow = {
      todaySchedule: schedule,
      upcomingDeadlines: [],
      recentJournals: []
    };

    const result = buildContextWindow(context);
    expect(result).toContain("Today's Schedule:");
    expect(result).toContain("DAT520 Distributed Systems");
  });

  it("should build context with deadlines only", () => {
    const deadlines: Deadline[] = [
      {
        id: "1",
        course: "DAT520",
        task: "Lab 1",
        dueDate: "2026-02-20T23:59:00.000Z",
        priority: "high",
        completed: false
      }
    ];

    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: deadlines,
      recentJournals: []
    };

    const result = buildContextWindow(context);
    expect(result).toContain("Upcoming Deadlines:");
    expect(result).toContain("DAT520: Lab 1");
    expect(result).toContain("Priority: high");
  });

  it("should build context with journal entries", () => {
    const journals: JournalEntry[] = [
      {
        id: "1",
        content: "Had a great lecture today on distributed systems",
        timestamp: "2026-02-16T14:30:00.000Z",
        updatedAt: "2026-02-16T14:30:00.000Z",
        version: 1
      }
    ];

    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: [],
      recentJournals: journals
    };

    const result = buildContextWindow(context);
    expect(result).toContain("Recent Journal Entries:");
    expect(result).toContain("Had a great lecture today");
  });

  it("should truncate long journal entries", () => {
    const longContent = "a".repeat(150);
    const journals: JournalEntry[] = [
      {
        id: "1",
        content: longContent,
        timestamp: "2026-02-16T14:30:00.000Z",
        updatedAt: "2026-02-16T14:30:00.000Z",
        version: 1
      }
    ];

    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: [],
      recentJournals: journals
    };

    const result = buildContextWindow(context);
    expect(result).toContain("...");
    expect(result.length).toBeLessThan(longContent.length + 100);
  });

  it("should include user state", () => {
    const userState: UserContext = {
      energyLevel: "high",
      stressLevel: "low",
      mode: "focus"
    };

    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: [],
      recentJournals: [],
      userState
    };

    const result = buildContextWindow(context);
    expect(result).toContain("User State:");
    expect(result).toContain("Energy: high");
    expect(result).toContain("Stress: low");
    expect(result).toContain("Mode: focus");
  });

  it("should include custom context", () => {
    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: [],
      recentJournals: [],
      customContext: "Additional context information"
    };

    const result = buildContextWindow(context);
    expect(result).toContain("Additional context information");
  });

  it("should build complete context window", () => {
    const schedule: LectureEvent[] = [
      {
        id: "1",
        title: "DAT520 Lecture",
        startTime: "2026-02-16T10:15:00.000Z",
        durationMinutes: 90,
        workload: "medium"
      }
    ];

    const deadlines: Deadline[] = [
      {
        id: "1",
        course: "DAT520",
        task: "Lab 1",
        dueDate: "2026-02-20T23:59:00.000Z",
        priority: "high",
        completed: false
      }
    ];

    const journals: JournalEntry[] = [
      {
        id: "1",
        content: "Started working on Lab 1",
        timestamp: "2026-02-16T14:30:00.000Z",
        updatedAt: "2026-02-16T14:30:00.000Z",
        version: 1
      }
    ];

    const userState: UserContext = {
      energyLevel: "medium",
      stressLevel: "medium",
      mode: "balanced"
    };

    const context: ContextWindow = {
      todaySchedule: schedule,
      upcomingDeadlines: deadlines,
      recentJournals: journals,
      userState,
      customContext: "Working on distributed systems course"
    };

    const result = buildContextWindow(context);
    expect(result).toContain("Today's Schedule:");
    expect(result).toContain("Upcoming Deadlines:");
    expect(result).toContain("Recent Journal Entries:");
    expect(result).toContain("User State:");
    expect(result).toContain("Working on distributed systems course");
  });

  it("should show completed status for deadlines", () => {
    const deadlines: Deadline[] = [
      {
        id: "1",
        course: "DAT520",
        task: "Lab 1",
        dueDate: "2026-02-20T23:59:00.000Z",
        priority: "high",
        completed: true
      },
      {
        id: "2",
        course: "DAT560",
        task: "Assignment 1",
        dueDate: "2026-02-25T23:59:00.000Z",
        priority: "medium",
        completed: false
      }
    ];

    const context: ContextWindow = {
      todaySchedule: [],
      upcomingDeadlines: deadlines,
      recentJournals: []
    };

    const result = buildContextWindow(context);
    expect(result).toContain("✅");
    expect(result).toContain("⬜");
  });
});

describe("buildSystemPrompt", () => {
  it("should build system prompt with user name and context", () => {
    const contextWindow = "Today's Schedule:\n- 10:15 AM: DAT520 Lecture";
    const result = buildSystemPrompt("Lucy", contextWindow);

    expect(result).toContain("Lucy");
    expect(result).toContain("UiS (University of Stavanger)");
    expect(result).toContain(contextWindow);
    expect(result).toContain("encouraging, conversational, and proactive");
  });

  it("should include context window in prompt", () => {
    const contextWindow = buildContextWindow({
      todaySchedule: [],
      upcomingDeadlines: [
        {
          id: "1",
          course: "DAT520",
          task: "Lab 1",
          dueDate: "2026-02-20T23:59:00.000Z",
          priority: "high",
          completed: false
        }
      ],
      recentJournals: []
    });

    const result = buildSystemPrompt("TestUser", contextWindow);
    expect(result).toContain("Upcoming Deadlines:");
    expect(result).toContain("DAT520: Lab 1");
  });
});
