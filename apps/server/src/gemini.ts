import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult, FunctionDeclaration, FunctionCall, Part } from "@google/generative-ai";
import { config } from "./config.js";
import { Deadline, JournalEntry, LectureEvent, UserContext } from "./types.js";

export interface GeminiMessage {
  role: "user" | "model";
  parts: Part[];
}

export interface GeminiChatRequest {
  messages: GeminiMessage[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
}

export interface GeminiChatResponse {
  text: string;
  finishReason?: string;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
  functionCalls?: FunctionCall[];
}

export interface ContextWindow {
  todaySchedule: LectureEvent[];
  upcomingDeadlines: Deadline[];
  recentJournals: JournalEntry[];
  userState?: UserContext;
  customContext?: string;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

export class RateLimitError extends GeminiError {
  constructor(message = "Gemini API rate limit exceeded", cause?: unknown) {
    super(message, 429, cause);
    this.name = "RateLimitError";
  }
}

export class GeminiClient {
  private client: GoogleGenerativeAI | null = null;
  private model: GenerativeModel | null = null;
  private readonly modelName = "gemini-2.0-flash";

  constructor(apiKey?: string) {
    const key = apiKey ?? config.GEMINI_API_KEY;

    if (key) {
      this.client = new GoogleGenerativeAI(key);
      // Model instance will be created per-request to support tools configuration
      this.model = this.client.getGenerativeModel({ model: this.modelName });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.model !== null;
  }

  private extractStatusCode(error: unknown): number | undefined {
    if (typeof error === "object" && error !== null) {
      const maybeError = error as { status?: unknown; statusCode?: unknown; code?: unknown };
      for (const value of [maybeError.status, maybeError.statusCode, maybeError.code]) {
        if (typeof value === "number" && Number.isInteger(value) && value >= 400 && value <= 599) {
          return value;
        }
        if (typeof value === "string" && /^[45]\d{2}$/.test(value)) {
          return Number.parseInt(value, 10);
        }
      }
    }

    if (error instanceof Error) {
      const match = error.message.match(/\b([45]\d{2})\b/);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }

    return undefined;
  }

  async generateChatResponse(request: GeminiChatRequest): Promise<GeminiChatResponse> {
    if (!this.isConfigured()) {
      throw new GeminiError("Gemini API key not configured. Set GEMINI_API_KEY environment variable.");
    }

    try {
      const modelConfig: {
        model: string;
        tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
        systemInstruction?: string;
      } = {
        model: this.modelName
      };

      if (request.tools && request.tools.length > 0) {
        modelConfig.tools = [{ functionDeclarations: request.tools }];
      }

      if (request.systemInstruction && request.systemInstruction.trim().length > 0) {
        modelConfig.systemInstruction = request.systemInstruction;
      }

      // Build a per-request model so SDK-normalized system instructions and tools are always valid.
      const model = this.client!.getGenerativeModel(modelConfig);

      const chat = model.startChat({
        history: request.messages.slice(0, -1)
      });

      const lastMessage = request.messages[request.messages.length - 1];
      if (!lastMessage || lastMessage.role !== "user") {
        throw new GeminiError("Last message must be from user");
      }

      const result: GenerateContentResult = await chat.sendMessage(lastMessage.parts[0]?.text ?? "");
      const response = result.response;
      
      // Extract function calls if present
      const functionCalls = response.functionCalls();

      // Get text (may be empty if there are function calls)
      let text = "";
      try {
        text = response.text();
      } catch {
        // Response may not have text if it only contains function calls
        text = "";
      }

      return {
        text,
        finishReason: response.candidates?.[0]?.finishReason,
        usageMetadata: response.usageMetadata
          ? {
              promptTokenCount: response.usageMetadata.promptTokenCount,
              candidatesTokenCount: response.usageMetadata.candidatesTokenCount,
              totalTokenCount: response.usageMetadata.totalTokenCount
            }
          : undefined,
        functionCalls: functionCalls && functionCalls.length > 0 ? functionCalls : undefined
      };
    } catch (error) {
      const statusCode = this.extractStatusCode(error);

      if (statusCode === 429) {
        const providerMessage = error instanceof Error ? error.message : "Too many requests";
        throw new RateLimitError(`Gemini API rate limit exceeded: ${providerMessage}`, error);
      }

      if (statusCode === 401 || statusCode === 403) {
        throw new GeminiError("Invalid Gemini API key", statusCode, error);
      }

      if (error instanceof Error) {
        if (statusCode !== undefined) {
          throw new GeminiError(`Gemini API error (${statusCode}): ${error.message}`, statusCode, error);
        }

        if (error.message.toLowerCase().includes("api key")) {
          throw new GeminiError("Invalid Gemini API key", 401, error);
        }

        throw new GeminiError(`Gemini API error: ${error.message}`, undefined, error);
      }

      throw new GeminiError("Unknown Gemini API error", undefined, error);
    }
  }
}

export function buildContextWindow(context: ContextWindow): string {
  const parts: string[] = [];

  if (context.todaySchedule.length > 0) {
    parts.push("**Today's Schedule:**");
    context.todaySchedule.forEach((event) => {
      const startTime = new Date(event.startTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit"
      });
      parts.push(`- ${startTime}: ${event.title} (${event.durationMinutes} min)`);
    });
  }

  if (context.upcomingDeadlines.length > 0) {
    parts.push("\n**Upcoming Deadlines:**");
    context.upcomingDeadlines.forEach((deadline) => {
      const dueDate = new Date(deadline.dueDate).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
      const status = deadline.completed ? "✅" : "⬜";
      parts.push(`- ${status} ${deadline.course}: ${deadline.task} (Due ${dueDate}, Priority: ${deadline.priority})`);
    });
  }

  if (context.recentJournals.length > 0) {
    parts.push("\n**Recent Journal Entries:**");
    context.recentJournals.forEach((entry) => {
      const date = new Date(entry.timestamp).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
      const preview = entry.content.slice(0, 100);
      parts.push(`- ${date}: ${preview}${entry.content.length > 100 ? "..." : ""}`);
    });
  }

  if (context.userState) {
    parts.push(
      `\n**User State:** Energy: ${context.userState.energyLevel}, Stress: ${context.userState.stressLevel}, Mode: ${context.userState.mode}`
    );
  }

  if (context.customContext) {
    parts.push(`\n${context.customContext}`);
  }

  return parts.join("\n");
}

export function buildSystemPrompt(userName: string, contextWindow: string): string {
  return `You are Companion, a personal AI assistant for ${userName}, a university student at UiS (University of Stavanger). You have access to their full academic context including schedule, deadlines, and journal entries.

${contextWindow}

Your role is to be encouraging, conversational, and proactive. Help ${userName} plan their day, reflect on progress, work through problems, and stay on top of deadlines. Keep responses concise and friendly.`;
}

let defaultClient: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!defaultClient) {
    defaultClient = new GeminiClient();
  }
  return defaultClient;
}
