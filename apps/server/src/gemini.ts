import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult, FunctionDeclaration, FunctionCall, Part } from "@google/generative-ai";
import { google } from "googleapis";
import WebSocket, { RawData } from "ws";
import { config } from "./config.js";
import { Deadline, JournalEntry, LectureEvent, UserContext } from "./types.js";

export interface GeminiMessage {
  role: "user" | "model" | "function";
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

export interface GeminiLiveFunctionCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveFunctionResponse {
  id?: string;
  name: string;
  response: unknown;
}

export interface GeminiLiveChatRequest extends GeminiChatRequest {
  onToolCall?: (calls: GeminiLiveFunctionCall[]) => Promise<GeminiLiveFunctionResponse[]>;
  onTextChunk?: (chunk: string) => void;
  timeoutMs?: number;
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
  private readonly fallbackModelName = "gemini-2.0-flash";
  private readonly liveModelName: string;
  private readonly apiKey?: string;

  constructor(apiKey?: string) {
    const key = apiKey ?? config.GEMINI_API_KEY;
    this.apiKey = key;
    this.liveModelName = config.GEMINI_LIVE_MODEL;

    if (key) {
      this.client = new GoogleGenerativeAI(key);
      // Fallback non-live model instance for compatibility paths.
      this.model = this.client.getGenerativeModel({ model: this.fallbackModelName });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && this.model !== null;
  }

  canUseLiveApi(): boolean {
    if (config.GEMINI_LIVE_PLATFORM === "vertex") {
      return true;
    }
    return Boolean(this.apiKey);
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

  private normalizeDeveloperLiveModelName(): string {
    const trimmed = this.liveModelName.trim();
    if (trimmed.startsWith("models/")) {
      return trimmed;
    }
    return `models/${trimmed}`;
  }

  private normalizeVertexLiveModelName(): string {
    const trimmed = this.liveModelName.trim();
    if (trimmed.startsWith("projects/")) {
      return trimmed;
    }
    const projectId = config.GEMINI_VERTEX_PROJECT_ID?.trim();
    if (!projectId) {
      throw new GeminiError(
        "GEMINI_VERTEX_PROJECT_ID is required for Vertex Live API when GEMINI_LIVE_MODEL is not a full model resource path."
      );
    }
    const location = config.GEMINI_VERTEX_LOCATION.trim();
    return `projects/${projectId}/locations/${location}/publishers/google/models/${trimmed}`;
  }

  private resolveDeveloperLiveEndpoint(): string {
    return (
      config.GEMINI_LIVE_ENDPOINT ??
      "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
    );
  }

  private resolveVertexLiveEndpoint(): string {
    if (config.GEMINI_LIVE_ENDPOINT) {
      return config.GEMINI_LIVE_ENDPOINT;
    }
    const location = config.GEMINI_VERTEX_LOCATION.trim();
    return `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
  }

  private async getVertexAccessToken(): Promise<string> {
    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"]
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
    if (!token || token.trim().length === 0) {
      throw new GeminiError("Failed to acquire Vertex IAM access token. Check GOOGLE_APPLICATION_CREDENTIALS/ADC.");
    }
    return token;
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
        model: this.fallbackModelName
      };

      if (request.tools && request.tools.length > 0) {
        modelConfig.tools = [{ functionDeclarations: request.tools }];
      }

      if (request.systemInstruction && request.systemInstruction.trim().length > 0) {
        modelConfig.systemInstruction = request.systemInstruction;
      }

      // Build a per-request model so SDK-normalized system instructions and tools are always valid.
      const model = this.client!.getGenerativeModel(modelConfig);

      if (request.messages.length === 0) {
        throw new GeminiError("At least one message is required");
      }

      const maxAttempts = 3;
      let result: GenerateContentResult | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        try {
          result = await model.generateContent({
            contents: request.messages
          });
          break;
        } catch (error) {
          const statusCode = this.extractStatusCode(error);
          const isRetryable429 = statusCode === 429;
          const isLastAttempt = attempt === maxAttempts - 1;

          if (!isRetryable429 || isLastAttempt) {
            throw error;
          }

          const backoffMs = 200 * 2 ** attempt + Math.floor(Math.random() * 120);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }

      if (!result) {
        throw new GeminiError("Gemini API error: no response generated");
      }

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

  private toLiveTurn(message: GeminiMessage): { role: "user" | "model"; parts: Array<Record<string, unknown>> } | null {
    const role: "user" | "model" = message.role === "model" ? "model" : "user";
    const parts: Array<Record<string, unknown>> = [];

    for (const part of message.parts) {
      if (typeof part.text === "string") {
        parts.push({ text: part.text });
        continue;
      }

      if (part.inlineData?.mimeType && part.inlineData?.data) {
        parts.push({
          inlineData: {
            mimeType: part.inlineData.mimeType,
            data: part.inlineData.data
          }
        });
      }
    }

    if (parts.length === 0) {
      return null;
    }

    return {
      role,
      parts
    };
  }

  private toLiveFunctionCalls(value: unknown): GeminiLiveFunctionCall[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const calls: GeminiLiveFunctionCall[] = [];

    for (const entry of value) {
      const record = entry as { id?: unknown; name?: unknown; args?: unknown };
      if (typeof record?.name !== "string" || record.name.trim().length === 0) {
        continue;
      }

      let args: Record<string, unknown> = {};
      if (record.args && typeof record.args === "object" && !Array.isArray(record.args)) {
        args = record.args as Record<string, unknown>;
      } else if (typeof record.args === "string") {
        try {
          const parsed = JSON.parse(record.args);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            args = parsed as Record<string, unknown>;
          }
        } catch {
          args = {};
        }
      }

      calls.push({
        id: typeof record.id === "string" && record.id.trim().length > 0 ? record.id : undefined,
        name: record.name,
        args
      });
    }

    return calls;
  }

  private buildLiveFunctionResponses(
    calls: GeminiLiveFunctionCall[],
    responses: GeminiLiveFunctionResponse[]
  ): Array<{ id?: string; name: string; response: unknown }> {
    return calls.map((call, index) => {
      const byId = call.id
        ? responses.find((response) => response.id === call.id)
        : undefined;
      const byNameAndOrder = responses.find(
        (response, responseIndex) => response.name === call.name && responseIndex === index
      );
      const fallbackByName = responses.find((response) => response.name === call.name);
      const selected = byId ?? byNameAndOrder ?? fallbackByName;

      return {
        id: selected?.id ?? call.id,
        name: call.name,
        response: selected?.response ?? {}
      };
    });
  }

  private toUsageMetadata(value: unknown): GeminiChatResponse["usageMetadata"] | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const payload = value as {
      promptTokenCount?: unknown;
      candidatesTokenCount?: unknown;
      totalTokenCount?: unknown;
      prompt_token_count?: unknown;
      candidates_token_count?: unknown;
      total_token_count?: unknown;
    };
    const promptTokenCount =
      typeof payload.promptTokenCount === "number"
        ? payload.promptTokenCount
        : typeof payload.prompt_token_count === "number"
          ? payload.prompt_token_count
          : undefined;
    const candidatesTokenCount =
      typeof payload.candidatesTokenCount === "number"
        ? payload.candidatesTokenCount
        : typeof payload.candidates_token_count === "number"
          ? payload.candidates_token_count
          : undefined;
    const totalTokenCount =
      typeof payload.totalTokenCount === "number"
        ? payload.totalTokenCount
        : typeof payload.total_token_count === "number"
          ? payload.total_token_count
          : undefined;
    if (
      typeof promptTokenCount !== "number" ||
      typeof candidatesTokenCount !== "number" ||
      typeof totalTokenCount !== "number"
    ) {
      return undefined;
    }

    return {
      promptTokenCount,
      candidatesTokenCount,
      totalTokenCount
    };
  }

  async generateLiveChatResponse(request: GeminiLiveChatRequest): Promise<GeminiChatResponse> {
    if (!this.canUseLiveApi()) {
      if (config.GEMINI_LIVE_PLATFORM === "developer") {
        throw new GeminiError("Gemini API key not configured. Set GEMINI_API_KEY for developer Live API.");
      }
      throw new GeminiError("Vertex Live API is enabled but configuration is incomplete.");
    }
    if (request.messages.length === 0) {
      throw new GeminiError("At least one message is required");
    }

    const vertexMode = config.GEMINI_LIVE_PLATFORM === "vertex";
    const liveUrl = (() => {
      if (vertexMode) {
        return this.resolveVertexLiveEndpoint();
      }
      const endpoint = this.resolveDeveloperLiveEndpoint();
      const separator = endpoint.includes("?") ? "&" : "?";
      return `${endpoint}${separator}key=${encodeURIComponent(this.apiKey ?? "")}`;
    })();
    const modelName = vertexMode ? this.normalizeVertexLiveModelName() : this.normalizeDeveloperLiveModelName();
    const wsHeaders: Record<string, string> = vertexMode
      ? {
          Authorization: `Bearer ${await this.getVertexAccessToken()}`
        }
      : {
          "x-goog-api-key": this.apiKey ?? ""
        };

    const ws = new WebSocket(liveUrl, {
      headers: wsHeaders
    });

    const timeoutMs = request.timeoutMs ?? config.GEMINI_LIVE_TIMEOUT_MS;
    const queue: unknown[] = [];
    let messageWaiter: ((value: unknown) => void) | null = null;
    let closed = false;
    let closeError: GeminiError | null = null;

    const clearWaiter = () => {
      messageWaiter = null;
    };

    const enqueue = (message: unknown) => {
      if (messageWaiter) {
        const next = messageWaiter;
        clearWaiter();
        next(message);
        return;
      }
      queue.push(message);
    };

    ws.on("message", (raw: RawData) => {
      try {
        const data = JSON.parse(String(raw));
        enqueue(data);
      } catch (error) {
        closeError = new GeminiError("Gemini Live API returned invalid JSON", undefined, error);
      }
    });

    ws.on("error", (error: Error) => {
      closeError = new GeminiError(`Gemini Live API socket error: ${error.message}`, undefined, error);
    });

    ws.on("close", (code: number, reason: Buffer) => {
      closed = true;
      const reasonText = reason.toString();
      if (code !== 1000 && !closeError) {
        closeError = new GeminiError(
          `Gemini Live API socket closed unexpectedly (code ${code}${reasonText ? `: ${reasonText}` : ""})`
        );
      }
      if (messageWaiter) {
        const next = messageWaiter;
        clearWaiter();
        next({ __closed: true });
      }
    });

    const waitForOpen = async () => {
      if (ws.readyState === WebSocket.OPEN) {
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const onOpen = () => {
          ws.off("error", onError);
          resolve();
        };
        const onError = (error: Error) => {
          ws.off("open", onOpen);
          reject(new GeminiError(`Gemini Live API socket open failed: ${error.message}`, undefined, error));
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
      });
    };

    const nextMessage = async () => {
      if (queue.length > 0) {
        return queue.shift();
      }
      if (closed) {
        return { __closed: true };
      }
      return await new Promise<unknown>((resolve) => {
        messageWaiter = resolve;
      });
    };

    const nextMessageWithTimeout = async () => {
      return await Promise.race([
        nextMessage(),
        new Promise<unknown>((_resolve, reject) =>
          setTimeout(() => reject(new GeminiError("Gemini Live API timed out waiting for response")), timeoutMs)
        )
      ]);
    };

    const sendJson = (payload: Record<string, unknown>) => {
      if (ws.readyState !== WebSocket.OPEN) {
        throw new GeminiError("Gemini Live API socket is not open");
      }
      ws.send(JSON.stringify(payload));
    };

    try {
      await waitForOpen();
      if (vertexMode) {
        sendJson({
          setup: {
            model: modelName,
            generation_config: {
              response_modalities: ["TEXT"]
            },
            ...(request.systemInstruction && request.systemInstruction.trim().length > 0
              ? {
                  system_instruction: {
                    parts: [{ text: request.systemInstruction }]
                  }
                }
              : {}),
            ...(request.tools && request.tools.length > 0
              ? {
                  tools: [{ function_declarations: request.tools }]
                }
              : {})
          }
        });
      } else {
        sendJson({
          setup: {
            model: modelName,
            generationConfig: {
              responseModalities: ["TEXT"]
            },
            ...(request.systemInstruction && request.systemInstruction.trim().length > 0
              ? {
                  systemInstruction: {
                    parts: [{ text: request.systemInstruction }]
                  }
                }
              : {}),
            ...(request.tools && request.tools.length > 0
              ? {
                  tools: [{ functionDeclarations: request.tools }]
                }
              : {})
          }
        });
      }

      while (true) {
        const setupMessage = (await nextMessageWithTimeout()) as
          | {
              setupComplete?: unknown;
              setup_complete?: unknown;
              error?: { message?: unknown } | string;
              __closed?: boolean;
            }
          | undefined;

        if (setupMessage?.__closed) {
          throw closeError ?? new GeminiError("Gemini Live API socket closed before setup completed");
        }
        if (setupMessage?.error) {
          if (typeof setupMessage.error === "string") {
            throw new GeminiError(`Gemini Live API setup error: ${setupMessage.error}`);
          }
          if (typeof setupMessage.error.message === "string") {
            throw new GeminiError(`Gemini Live API setup error: ${setupMessage.error.message}`);
          }
        }
        if (setupMessage?.setupComplete !== undefined || setupMessage?.setup_complete !== undefined) {
          break;
        }
      }

      const turns = request.messages
        .map((message) => this.toLiveTurn(message))
        .filter((message): message is { role: "user" | "model"; parts: Array<Record<string, unknown>> } => Boolean(message));

      sendJson(
        vertexMode
          ? {
              client_content: {
                turns,
                turn_complete: true
              }
            }
          : {
              clientContent: {
                turns,
                turnComplete: true
              }
            }
      );

      let text = "";
      let finishReason: string | undefined = undefined;
      let usageMetadata: GeminiChatResponse["usageMetadata"] = undefined;

      while (true) {
        const envelope = (await nextMessageWithTimeout()) as
          | {
              serverContent?: {
                modelTurn?: { parts?: Array<Record<string, unknown>> };
                outputTranscription?: { text?: string };
                turnComplete?: boolean;
                interrupted?: boolean;
              };
              server_content?: {
                model_turn?: { parts?: Array<Record<string, unknown>> };
                output_transcription?: { text?: string };
                turn_complete?: boolean;
                interrupted?: boolean;
              };
              toolCall?: { functionCalls?: unknown };
              tool_call?: { function_calls?: unknown };
              usageMetadata?: unknown;
              usage_metadata?: unknown;
              error?: { message?: unknown } | string;
              __closed?: boolean;
            }
          | undefined;

        if (envelope?.__closed) {
          throw closeError ?? new GeminiError("Gemini Live API socket closed before turn completed");
        }
        if (envelope?.error) {
          if (typeof envelope.error === "string") {
            throw new GeminiError(`Gemini Live API error: ${envelope.error}`);
          }
          if (typeof envelope.error.message === "string") {
            throw new GeminiError(`Gemini Live API error: ${envelope.error.message}`);
          }
        }

        const nextUsage = this.toUsageMetadata(envelope?.usageMetadata ?? envelope?.usage_metadata);
        if (nextUsage) {
          usageMetadata = nextUsage;
        }

        const toolCalls = this.toLiveFunctionCalls(
          envelope?.toolCall?.functionCalls ?? envelope?.tool_call?.function_calls
        );
        if (toolCalls.length > 0) {
          if (!request.onToolCall) {
            throw new GeminiError("Gemini Live API requested tool calls but no onToolCall handler was provided");
          }
          const toolResponses = await request.onToolCall(toolCalls);
          const functionResponses = this.buildLiveFunctionResponses(toolCalls, toolResponses);
          sendJson(
            vertexMode
              ? {
                  tool_response: {
                    function_responses: functionResponses
                  }
                }
              : {
                  toolResponse: {
                    functionResponses
                  }
                }
          );
        }

        const serverContent = (envelope?.serverContent ?? envelope?.server_content) as
          | {
              modelTurn?: { parts?: Array<Record<string, unknown>> };
              model_turn?: { parts?: Array<Record<string, unknown>> };
              outputTranscription?: { text?: string };
              output_transcription?: { text?: string };
              turnComplete?: boolean;
              turn_complete?: boolean;
              interrupted?: boolean;
            }
          | undefined;
        const parts = serverContent?.modelTurn?.parts ?? serverContent?.model_turn?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            if (typeof part?.text === "string" && part.text.length > 0) {
              text += part.text;
              request.onTextChunk?.(part.text);
            }
          }
        }
        const transcriptionText =
          serverContent?.outputTranscription?.text ?? serverContent?.output_transcription?.text;
        if (typeof transcriptionText === "string" && transcriptionText.length > 0) {
          text += transcriptionText;
          request.onTextChunk?.(transcriptionText);
        }

        if (serverContent?.interrupted) {
          finishReason = "interrupted";
        }

        if (serverContent?.turnComplete || serverContent?.turn_complete) {
          if (!finishReason) {
            finishReason = "stop";
          }
          break;
        }
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1000);
      }

      return {
        text,
        finishReason,
        usageMetadata
      };
    } catch (error) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }

      const statusCode = this.extractStatusCode(error);
      if (statusCode === 429) {
        const providerMessage = error instanceof Error ? error.message : "Too many requests";
        throw new RateLimitError(`Gemini API rate limit exceeded: ${providerMessage}`, error);
      }
      if (statusCode === 401 || statusCode === 403) {
        throw new GeminiError("Invalid Gemini API key", statusCode, error);
      }
      if (error instanceof GeminiError) {
        throw error;
      }
      if (error instanceof Error) {
        throw new GeminiError(`Gemini Live API error: ${error.message}`, undefined, error);
      }
      throw new GeminiError("Unknown Gemini Live API error", undefined, error);
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
