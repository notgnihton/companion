import { GoogleGenerativeAI, GenerativeModel, GenerateContentResult, FunctionDeclaration, FunctionCall, Part } from "@google/generative-ai";
import { google } from "googleapis";
import WebSocket, { RawData } from "ws";
import { config } from "./config.js";
import { Deadline, LectureEvent, UserContext } from "./types.js";

export interface GeminiMessage {
  role: "user" | "model" | "function";
  parts: Part[];
}

export interface GeminiChatRequest {
  messages: GeminiMessage[];
  systemInstruction?: string;
  tools?: FunctionDeclaration[];
  /** Enable Google Search grounding — lets Gemini search the web for real-time info */
  googleSearchGrounding?: boolean;
}

export interface GroundingSearchSource {
  uri: string;
  title: string;
}

export interface GroundingMetadata {
  searchEntryPoint?: { renderedContent?: string };
  groundingChunks?: Array<{ web?: GroundingSearchSource }>;
  groundingSupports?: Array<{
    segment?: { startIndex?: number; endIndex?: number; text?: string };
    groundingChunkIndices?: number[];
    confidenceScores?: number[];
  }>;
  webSearchQueries?: string[];
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
  groundingMetadata?: GroundingMetadata;
}

export interface GeminiImageGenerationResponse {
  dataUrl: string;
  mimeType: string;
  model: string;
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

export interface GeminiStreamChatRequest extends GeminiChatRequest {
  onTextChunk?: (chunk: string) => void;
}

export interface ContextWindow {
  todaySchedule: LectureEvent[];
  upcomingDeadlines: Deadline[];
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
  private readonly fallbackModelName = "gemini-2.5-flash";
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
    return Boolean(config.GEMINI_VERTEX_PROJECT_ID?.trim()) || (this.client !== null && this.model !== null);
  }

  canUseLiveApi(): boolean {
    return true;
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

  private buildVertexModelNotFoundMessage(errorBody: string, statusText: string): string {
    const base = `Gemini API error (404): ${errorBody || statusText}`;
    const model = this.liveModelName.trim().toLowerCase();
    const location = config.GEMINI_VERTEX_LOCATION.trim().toLowerCase();
    if (model.startsWith("gemini-3") && location !== "global") {
      return `${base}. Gemini 3 preview models on Vertex require GEMINI_VERTEX_LOCATION=global.`;
    }
    return base;
  }

  private resolveGrowthImageModelAlias(modelName: string): string {
    const normalized = modelName.trim().toLowerCase().replace(/\s+/g, "-");
    if (normalized === "nano-banana-pro") {
      return "gemini-3-pro-image-preview";
    }
    return modelName.trim();
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

  private normalizeVertexModelNameForGenerateContent(
    modelName: string,
    locationOverride?: string
  ): string {
    const trimmed = modelName.trim();
    if (trimmed.startsWith("projects/")) {
      return trimmed;
    }

    const projectId = config.GEMINI_VERTEX_PROJECT_ID?.trim();
    if (!projectId) {
      throw new GeminiError(
        "GEMINI_VERTEX_PROJECT_ID is required for Vertex chat requests when model is not a full model resource path."
      );
    }

    const location = locationOverride?.trim() || config.GEMINI_VERTEX_LOCATION.trim();
    return `projects/${projectId}/locations/${location}/publishers/google/models/${trimmed}`;
  }

  private resolveVertexApiHost(location: string): string {
    const normalizedLocation = location.trim().toLowerCase();
    if (normalizedLocation === "global") {
      return "aiplatform.googleapis.com";
    }
    return `${location}-aiplatform.googleapis.com`;
  }

  private resolveVertexLiveEndpoint(): string {
    if (config.GEMINI_LIVE_ENDPOINT) {
      return config.GEMINI_LIVE_ENDPOINT;
    }
    const location = config.GEMINI_VERTEX_LOCATION.trim();
    const host = this.resolveVertexApiHost(location);
    return `wss://${host}/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
  }

  private async getVertexAccessToken(): Promise<string> {
    let credentials:
      | {
          client_email: string;
          private_key: string;
        }
      | undefined;

    if (config.GOOGLE_SERVICE_ACCOUNT_JSON && config.GOOGLE_SERVICE_ACCOUNT_JSON.trim().length > 0) {
      try {
        const parsed = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_JSON) as {
          client_email?: unknown;
          private_key?: unknown;
        };
        if (typeof parsed.client_email === "string" && typeof parsed.private_key === "string") {
          credentials = {
            client_email: parsed.client_email,
            private_key: parsed.private_key.replace(/\\n/g, "\n")
          };
        } else {
          throw new GeminiError(
            "GOOGLE_SERVICE_ACCOUNT_JSON must include string fields: client_email and private_key."
          );
        }
      } catch (error) {
        if (error instanceof GeminiError) {
          throw error;
        }
        throw new GeminiError("Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON.", undefined, error);
      }
    }

    const auth = new google.auth.GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      ...(credentials ? { credentials } : {})
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    const token = typeof accessToken === "string" ? accessToken : accessToken?.token;
    if (!token || token.trim().length === 0) {
      throw new GeminiError("Failed to acquire Vertex IAM access token. Check GOOGLE_APPLICATION_CREDENTIALS/ADC.");
    }
    return token;
  }

  private normalizeVertexModelNameForCurrentChatModel(): string {
    return this.normalizeVertexModelNameForGenerateContent(this.liveModelName);
  }

  getGrowthImageModel(): { configured: string; resolved: string } {
    const configured = config.GEMINI_GROWTH_IMAGE_MODEL.trim();
    const resolved = this.resolveGrowthImageModelAlias(configured);
    return {
      configured,
      resolved
    };
  }

  private toVertexPart(part: Part): Record<string, unknown> | null {
    if (typeof part.text === "string") {
      return { text: part.text };
    }

    if (part.inlineData?.mimeType && part.inlineData?.data) {
      return {
        inline_data: {
          mime_type: part.inlineData.mimeType,
          data: part.inlineData.data
        }
      };
    }

    const maybeFunctionCall = (part as unknown as { functionCall?: unknown; function_call?: unknown }).functionCall
      ?? (part as unknown as { functionCall?: unknown; function_call?: unknown }).function_call;
    if (maybeFunctionCall && typeof maybeFunctionCall === "object") {
      const call = maybeFunctionCall as {
        id?: unknown;
        name?: unknown;
        args?: unknown;
        thoughtSignature?: unknown;
        thought_signature?: unknown;
      };
      if (typeof call.name === "string" && call.name.trim().length > 0) {
        const thoughtSignature =
          typeof call.thought_signature === "string"
            ? call.thought_signature
            : typeof call.thoughtSignature === "string"
              ? call.thoughtSignature
              : undefined;
        return {
          function_call: {
            ...(typeof call.id === "string" && call.id.trim().length > 0 ? { id: call.id } : {}),
            name: call.name,
            args: call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {}
          },
          ...(thoughtSignature ? { thought_signature: thoughtSignature } : {})
        };
      }
    }

    const maybeFunctionResponse = (part as unknown as { functionResponse?: unknown; function_response?: unknown }).functionResponse
      ?? (part as unknown as { functionResponse?: unknown; function_response?: unknown }).function_response;
    if (maybeFunctionResponse && typeof maybeFunctionResponse === "object") {
      const response = maybeFunctionResponse as { name?: unknown; response?: unknown };
      if (typeof response.name === "string" && response.name.trim().length > 0) {
        const responsePayload =
          response.response && typeof response.response === "object" && !Array.isArray(response.response)
            ? response.response
            : { result: response.response ?? null };
        return {
          function_response: {
            name: response.name,
            response: responsePayload
          }
        };
      }
    }

    return null;
  }

  private toVertexContents(
    messages: GeminiMessage[]
  ): Array<{ role: GeminiMessage["role"]; parts: Array<Record<string, unknown>> }> {
    const contents: Array<{ role: GeminiMessage["role"]; parts: Array<Record<string, unknown>> }> = [];

    messages.forEach((message) => {
      const parts = message.parts
        .map((part) => this.toVertexPart(part))
        .filter((part): part is Record<string, unknown> => part !== null);
      if (parts.length === 0) {
        return;
      }
      contents.push({
        role: message.role,
        parts
      });
    });

    return contents;
  }

  private parseFunctionCallsFromParts(parts: unknown[]): FunctionCall[] {
    const calls: FunctionCall[] = [];

    parts.forEach((part) => {
      if (!part || typeof part !== "object") {
        return;
      }
      const record = part as {
        thoughtSignature?: unknown;
        thought_signature?: unknown;
        functionCall?: {
          id?: unknown;
          name?: unknown;
          args?: unknown;
          thoughtSignature?: unknown;
          thought_signature?: unknown;
        };
        function_call?: {
          id?: unknown;
          name?: unknown;
          args?: unknown;
          thoughtSignature?: unknown;
          thought_signature?: unknown;
        };
      };
      const functionCall = record.functionCall ?? record.function_call;
      if (!functionCall || typeof functionCall.name !== "string" || functionCall.name.trim().length === 0) {
        return;
      }
      const args =
        functionCall.args && typeof functionCall.args === "object" && !Array.isArray(functionCall.args)
          ? (functionCall.args as Record<string, unknown>)
          : {};
      const thoughtSignature =
        typeof record.thought_signature === "string"
          ? record.thought_signature
          : typeof record.thoughtSignature === "string"
            ? record.thoughtSignature
            : typeof functionCall.thought_signature === "string"
              ? functionCall.thought_signature
              : typeof functionCall.thoughtSignature === "string"
                ? functionCall.thoughtSignature
                : undefined;
      calls.push({
        ...(typeof functionCall.id === "string" && functionCall.id.trim().length > 0
          ? { id: functionCall.id }
          : {}),
        name: functionCall.name,
        args,
        ...(thoughtSignature ? { thought_signature: thoughtSignature } : {})
      } as FunctionCall);
    });

    return calls;
  }

  async generateChatResponse(request: GeminiChatRequest): Promise<GeminiChatResponse> {
    if (request.messages.length === 0) {
      throw new GeminiError("At least one message is required");
    }

    const modelName = this.normalizeVertexModelNameForCurrentChatModel();
    const location = config.GEMINI_VERTEX_LOCATION.trim();
    const host = this.resolveVertexApiHost(location);
    const url = `https://${host}/v1/${modelName}:generateContent`;
    const contents = this.toVertexContents(request.messages);
    const body: Record<string, unknown> = {
      contents
    };
    if (request.systemInstruction && request.systemInstruction.trim().length > 0) {
      body.system_instruction = {
        parts: [{ text: request.systemInstruction }]
      };
    }
    // Build tools array: function declarations + optional Google Search grounding
    const toolsArray: Record<string, unknown>[] = [];
    if (request.tools && request.tools.length > 0) {
      toolsArray.push({ function_declarations: request.tools });
    }
    if (request.googleSearchGrounding) {
      toolsArray.push({ google_search: {} });
    }
    if (toolsArray.length > 0) {
      body.tools = toolsArray;
    }

    try {
      const maxAttempts = 3;
      let rawResponse: Response | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const accessToken = await this.getVertexAccessToken();
        rawResponse = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body)
        });

        if (rawResponse.ok || rawResponse.status !== 429 || attempt === maxAttempts - 1) {
          break;
        }

        const backoffMs = 200 * 2 ** attempt + Math.floor(Math.random() * 120);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      if (!rawResponse) {
        throw new GeminiError("Gemini API error: no response generated");
      }

      if (!rawResponse.ok) {
        const errorBody = await rawResponse.text();
        if (rawResponse.status === 429) {
          throw new RateLimitError(
            `Gemini API rate limit exceeded: ${errorBody || rawResponse.statusText}`,
            errorBody
          );
        }
        if (rawResponse.status === 401 || rawResponse.status === 403) {
          throw new GeminiError(
            `Invalid Vertex credentials or missing IAM permissions: ${errorBody || rawResponse.statusText}`,
            rawResponse.status,
            errorBody
          );
        }
        if (rawResponse.status === 404) {
          throw new GeminiError(
            this.buildVertexModelNotFoundMessage(errorBody, rawResponse.statusText),
            rawResponse.status,
            errorBody
          );
        }
        throw new GeminiError(
          `Gemini API error (${rawResponse.status}): ${errorBody || rawResponse.statusText}`,
          rawResponse.status,
          errorBody
        );
      }

      const payload = (await rawResponse.json()) as {
        candidates?: Array<{
          finishReason?: string;
          finish_reason?: string;
          content?: { parts?: unknown[] };
          groundingMetadata?: GroundingMetadata;
          grounding_metadata?: GroundingMetadata;
        }>;
        usageMetadata?: unknown;
        usage_metadata?: unknown;
      };
      const firstCandidate = payload.candidates?.[0];
      const parts = firstCandidate?.content?.parts ?? [];
      const text = parts
        .map((part) => {
          if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
            return (part as { text: string }).text;
          }
          return "";
        })
        .join("");
      const functionCalls = this.parseFunctionCallsFromParts(parts);

      const grounding = firstCandidate?.groundingMetadata ?? firstCandidate?.grounding_metadata;

      return {
        text,
        finishReason: firstCandidate?.finishReason ?? firstCandidate?.finish_reason,
        usageMetadata: this.toUsageMetadata(payload.usageMetadata ?? payload.usage_metadata),
        functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
        groundingMetadata: grounding ?? undefined
      };
    } catch (error) {
      if (error instanceof RateLimitError || error instanceof GeminiError) {
        throw error;
      }

      const statusCode = this.extractStatusCode(error);
      if (statusCode === 429) {
        const providerMessage = error instanceof Error ? error.message : "Too many requests";
        throw new RateLimitError(`Gemini API rate limit exceeded: ${providerMessage}`, error);
      }
      if (statusCode === 401 || statusCode === 403) {
        throw new GeminiError("Invalid Vertex credentials or missing IAM permissions", statusCode, error);
      }
      if (error instanceof Error) {
        throw new GeminiError(`Gemini API error: ${error.message}`, statusCode, error);
      }
      throw new GeminiError("Unknown Gemini API error", statusCode, error);
    }
  }

  async generateGrowthImage(
    prompt: string,
    options: {
      model?: string;
    } = {}
  ): Promise<GeminiImageGenerationResponse | null> {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) {
      throw new GeminiError("Image generation prompt cannot be empty");
    }

    const configuredModel = (options.model?.trim() || config.GEMINI_GROWTH_IMAGE_MODEL.trim());
    const resolvedModel = this.resolveGrowthImageModelAlias(configuredModel);
    const effectiveLocation =
      !resolvedModel.startsWith("projects/") && resolvedModel.toLowerCase().startsWith("gemini-3")
        ? "global"
        : config.GEMINI_VERTEX_LOCATION.trim();
    const modelName = this.normalizeVertexModelNameForGenerateContent(resolvedModel, effectiveLocation);
    const host = this.resolveVertexApiHost(effectiveLocation);
    const url = `https://${host}/v1/${modelName}:generateContent`;
    const body = {
      contents: [
        {
          role: "user",
          parts: [{ text: trimmedPrompt }]
        }
      ],
      generation_config: {
        response_modalities: ["IMAGE"]
      }
    };

    const maxAttempts = 3;
    let rawResponse: Response | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const accessToken = await this.getVertexAccessToken();
      rawResponse = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (rawResponse.ok || rawResponse.status !== 429 || attempt === maxAttempts - 1) {
        break;
      }

      const backoffMs = 200 * 2 ** attempt + Math.floor(Math.random() * 120);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }

    if (!rawResponse) {
      throw new GeminiError("Gemini image API error: no response generated");
    }

    if (!rawResponse.ok) {
      const errorBody = await rawResponse.text();
      if (rawResponse.status === 429) {
        throw new RateLimitError(
          `Gemini image API rate limit exceeded: ${errorBody || rawResponse.statusText}`,
          errorBody
        );
      }
      if (rawResponse.status === 401 || rawResponse.status === 403) {
        throw new GeminiError(
          `Invalid Vertex credentials or missing IAM permissions: ${errorBody || rawResponse.statusText}`,
          rawResponse.status,
          errorBody
        );
      }
      if (rawResponse.status === 404) {
        throw new GeminiError(
          this.buildVertexModelNotFoundMessage(errorBody, rawResponse.statusText),
          rawResponse.status,
          errorBody
        );
      }
      throw new GeminiError(
        `Gemini image API error (${rawResponse.status}): ${errorBody || rawResponse.statusText}`,
        rawResponse.status,
        errorBody
      );
    }

    const payload = (await rawResponse.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };

    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    for (const part of parts) {
      const inlineData = part.inlineData;
      const inlineDataSnake = part.inline_data;
      const mimeType = inlineData?.mimeType ?? inlineDataSnake?.mime_type;
      const data = inlineData?.data ?? inlineDataSnake?.data;
      if (typeof mimeType === "string" && mimeType.trim().length > 0 && typeof data === "string" && data.length > 0) {
        return {
          dataUrl: `data:${mimeType};base64,${data}`,
          mimeType,
          model: resolvedModel
        };
      }
    }

    return null;
  }

  async generateChatResponseStream(request: GeminiStreamChatRequest): Promise<GeminiChatResponse> {
    if (request.messages.length === 0) {
      throw new GeminiError("At least one message is required");
    }

    const modelName = this.normalizeVertexModelNameForCurrentChatModel();
    const location = config.GEMINI_VERTEX_LOCATION.trim();
    const host = this.resolveVertexApiHost(location);
    const url = `https://${host}/v1/${modelName}:streamGenerateContent?alt=sse`;
    const contents = this.toVertexContents(request.messages);
    const body: Record<string, unknown> = {
      contents
    };

    if (request.systemInstruction && request.systemInstruction.trim().length > 0) {
      body.system_instruction = {
        parts: [{ text: request.systemInstruction }]
      };
    }

    // Build tools array: function declarations + optional Google Search grounding
    const streamToolsArray: Record<string, unknown>[] = [];
    if (request.tools && request.tools.length > 0) {
      streamToolsArray.push({ function_declarations: request.tools });
    }
    if (request.googleSearchGrounding) {
      streamToolsArray.push({ google_search: {} });
    }
    if (streamToolsArray.length > 0) {
      body.tools = streamToolsArray;
    }

    const maxAttempts = 3;
    const timeoutMs = config.GEMINI_LIVE_TIMEOUT_MS;
    const timeoutController = new AbortController();
    const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs);

    try {
      let rawResponse: Response | null = null;

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const accessToken = await this.getVertexAccessToken();
        rawResponse = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(body),
          signal: timeoutController.signal
        });

        if (rawResponse.ok || rawResponse.status !== 429 || attempt === maxAttempts - 1) {
          break;
        }

        const backoffMs = 200 * 2 ** attempt + Math.floor(Math.random() * 120);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }

      if (!rawResponse) {
        throw new GeminiError("Gemini API error: no response generated");
      }

      if (!rawResponse.ok) {
        const errorBody = await rawResponse.text();
        if (rawResponse.status === 429) {
          throw new RateLimitError(
            `Gemini API rate limit exceeded: ${errorBody || rawResponse.statusText}`,
            errorBody
          );
        }
        if (rawResponse.status === 401 || rawResponse.status === 403) {
          throw new GeminiError(
            `Invalid Vertex credentials or missing IAM permissions: ${errorBody || rawResponse.statusText}`,
            rawResponse.status,
            errorBody
          );
        }
        if (rawResponse.status === 404) {
          throw new GeminiError(
            this.buildVertexModelNotFoundMessage(errorBody, rawResponse.statusText),
            rawResponse.status,
            errorBody
          );
        }
        throw new GeminiError(
          `Gemini API error (${rawResponse.status}): ${errorBody || rawResponse.statusText}`,
          rawResponse.status,
          errorBody
        );
      }

      if (!rawResponse.body) {
        throw new GeminiError("Gemini stream response body is not available.");
      }

      const reader = rawResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let finishReason: string | undefined;
      let usageMetadata: GeminiChatResponse["usageMetadata"] | undefined;
      let groundingMetadata: GroundingMetadata | undefined;
      const functionCalls: FunctionCall[] = [];

      const consumeSseBlock = (block: string): void => {
        const lines = block.split(/\r?\n/);
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trimStart());
          }
        }

        if (dataLines.length === 0) {
          return;
        }

        const data = dataLines.join("\n").trim();
        if (!data || data === "[DONE]") {
          return;
        }

        let payload: {
          candidates?: Array<{
            finishReason?: string;
            finish_reason?: string;
            content?: { parts?: unknown[] };
            groundingMetadata?: GroundingMetadata;
            grounding_metadata?: GroundingMetadata;
          }>;
          usageMetadata?: unknown;
          usage_metadata?: unknown;
        };

        try {
          payload = JSON.parse(data) as {
            candidates?: Array<{
              finishReason?: string;
              finish_reason?: string;
              content?: { parts?: unknown[] };
              groundingMetadata?: GroundingMetadata;
              grounding_metadata?: GroundingMetadata;
            }>;
            usageMetadata?: unknown;
            usage_metadata?: unknown;
          };
        } catch {
          return;
        }

        const firstCandidate = payload.candidates?.[0];
        const parts = firstCandidate?.content?.parts ?? [];
        const combinedChunkText = parts
          .map((part) => {
            if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
              return (part as { text: string }).text;
            }
            return "";
          })
          .join("");

        if (combinedChunkText.length > 0) {
          let delta = combinedChunkText;
          if (combinedChunkText.startsWith(text)) {
            delta = combinedChunkText.slice(text.length);
            text = combinedChunkText;
          } else if (!text.endsWith(combinedChunkText)) {
            text += combinedChunkText;
          } else {
            delta = "";
          }

          if (delta.length > 0) {
            request.onTextChunk?.(delta);
          }
        }

        const parsedFunctionCalls = this.parseFunctionCallsFromParts(parts);
        parsedFunctionCalls.forEach((call) => {
          const args = call.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {};
          const signature = (call as unknown as { thought_signature?: unknown; thoughtSignature?: unknown })
            .thought_signature
            ?? (call as unknown as { thought_signature?: unknown; thoughtSignature?: unknown }).thoughtSignature;
          const callId = (call as unknown as { id?: unknown }).id;
          const normalizedArgs = JSON.stringify(args);
          const nextCall = {
            ...(typeof callId === "string" && callId.trim().length > 0 ? { id: callId } : {}),
            name: call.name,
            args,
            ...(typeof signature === "string" && signature.length > 0 ? { thought_signature: signature } : {})
          } as FunctionCall;

          let existingIndex = -1;
          if (typeof callId === "string" && callId.trim().length > 0) {
            existingIndex = functionCalls.findIndex((existing) => {
              const existingId = (existing as unknown as { id?: unknown }).id;
              return typeof existingId === "string" && existingId === callId;
            });
          }
          if (existingIndex < 0) {
            existingIndex = functionCalls.findIndex((existing) => {
              if (existing.name !== call.name) {
                return false;
              }
              const existingArgs =
                existing.args && typeof existing.args === "object" && !Array.isArray(existing.args)
                  ? JSON.stringify(existing.args)
                  : "{}";
              return existingArgs === normalizedArgs;
            });
          }
          if (existingIndex < 0 && typeof callId === "string" && callId.trim().length > 0) {
            existingIndex = functionCalls.findIndex((existing) => {
              if (existing.name !== call.name) {
                return false;
              }
              const existingId = (existing as unknown as { id?: unknown }).id;
              if (typeof existingId === "string" && existingId.trim().length > 0) {
                return false;
              }
              const existingArgs =
                existing.args && typeof existing.args === "object" && !Array.isArray(existing.args)
                  ? JSON.stringify(existing.args)
                  : "{}";
              return existingArgs === "{}" || normalizedArgs === "{}";
            });
          }

          if (existingIndex < 0) {
            functionCalls.push(nextCall);
            return;
          }

          const merged = {
            ...(functionCalls[existingIndex] as unknown as Record<string, unknown>)
          } as Record<string, unknown>;
          if (!merged.id && typeof callId === "string" && callId.trim().length > 0) {
            merged.id = callId;
          }

          const nextSignature =
            typeof (nextCall as unknown as { thought_signature?: unknown }).thought_signature === "string" &&
              ((nextCall as unknown as { thought_signature?: string }).thought_signature?.length ?? 0) > 0
              ? (nextCall as unknown as { thought_signature: string }).thought_signature
              : undefined;
          if (nextSignature) {
            merged.thought_signature = nextSignature;
          }

          const mergedArgs =
            merged.args && typeof merged.args === "object" && !Array.isArray(merged.args)
              ? JSON.stringify(merged.args)
              : "{}";
          if (mergedArgs === "{}" && normalizedArgs !== "{}") {
            merged.args = args;
          }
          if (!("args" in merged)) {
            merged.args = args;
          }

          functionCalls[existingIndex] = merged as unknown as FunctionCall;
        });

        const nextUsage = this.toUsageMetadata(payload.usageMetadata ?? payload.usage_metadata);
        if (nextUsage) {
          usageMetadata = nextUsage;
        }

        const nextFinishReason = firstCandidate?.finishReason ?? firstCandidate?.finish_reason;
        if (typeof nextFinishReason === "string" && nextFinishReason.length > 0) {
          finishReason = nextFinishReason;
        }

        const nextGrounding = firstCandidate?.groundingMetadata ?? firstCandidate?.grounding_metadata;
        if (nextGrounding) {
          groundingMetadata = nextGrounding;
        }
      };

      const processBuffer = (): void => {
        while (true) {
          const separatorMatch = buffer.match(/\r?\n\r?\n/);
          if (!separatorMatch || separatorMatch.index === undefined) {
            return;
          }

          const separatorIndex = separatorMatch.index;
          const separatorLength = separatorMatch[0].length;
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + separatorLength);
          consumeSseBlock(block);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }

      buffer += decoder.decode();
      processBuffer();
      if (buffer.trim().length > 0) {
        consumeSseBlock(buffer);
      }

      const hasThoughtSignature = (call: FunctionCall): boolean => {
        const signature = (call as unknown as { thought_signature?: unknown; thoughtSignature?: unknown })
          .thought_signature
          ?? (call as unknown as { thought_signature?: unknown; thoughtSignature?: unknown }).thoughtSignature;
        return typeof signature === "string" && signature.trim().length > 0;
      };
      const argsJson = (call: FunctionCall): string =>
        call.args && typeof call.args === "object" && !Array.isArray(call.args)
          ? JSON.stringify(call.args)
          : "{}";
      const sanitizedFunctionCalls = functionCalls.filter((call, index) => {
        if (hasThoughtSignature(call)) {
          return true;
        }
        const callArgs = argsJson(call);
        return !functionCalls.some((candidate, candidateIndex) => {
          if (candidateIndex === index || candidate.name !== call.name || !hasThoughtSignature(candidate)) {
            return false;
          }
          const candidateArgs = argsJson(candidate);
          return candidateArgs === callArgs || candidateArgs === "{}" || callArgs === "{}";
        });
      });

      return {
        text,
        finishReason,
        usageMetadata,
        functionCalls: sanitizedFunctionCalls.length > 0 ? sanitizedFunctionCalls : undefined,
        groundingMetadata: groundingMetadata ?? undefined
      };
    } catch (error) {
      clearTimeout(timeoutHandle);
      if (timeoutController?.signal.aborted) {
        throw new GeminiError("Gemini API stream timed out waiting for a response", 504, error);
      }
      if (error instanceof RateLimitError || error instanceof GeminiError) {
        throw error;
      }

      const statusCode = this.extractStatusCode(error);
      if (statusCode === 429) {
        const providerMessage = error instanceof Error ? error.message : "Too many requests";
        throw new RateLimitError(`Gemini API rate limit exceeded: ${providerMessage}`, error);
      }
      if (statusCode === 401 || statusCode === 403) {
        throw new GeminiError("Invalid Vertex credentials or missing IAM permissions", statusCode, error);
      }
      if (error instanceof Error) {
        throw new GeminiError(`Gemini API streaming error: ${error.message}`, statusCode, error);
      }
      throw new GeminiError("Unknown Gemini API streaming error", statusCode, error);
    } finally {
      clearTimeout(timeoutHandle);
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
      throw new GeminiError("Vertex Live API is enabled but configuration is incomplete.");
    }
    if (request.messages.length === 0) {
      throw new GeminiError("At least one message is required");
    }

    const nativeAudioModel = this.liveModelName.toLowerCase().includes("native-audio");
    const responseModalities = nativeAudioModel ? ["AUDIO"] : ["TEXT"];
    const liveUrl = this.resolveVertexLiveEndpoint();
    const modelName = this.normalizeVertexLiveModelName();
    const wsHeaders: Record<string, string> = {
      Authorization: `Bearer ${await this.getVertexAccessToken()}`
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
      sendJson({
        setup: {
          model: modelName,
          generation_config: {
            response_modalities: responseModalities
          },
          ...(nativeAudioModel ? { output_audio_transcription: {} } : {}),
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

      sendJson({
        client_content: {
          turns,
          turn_complete: true
        }
      });

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
          sendJson({
            tool_response: {
              function_responses: functionResponses
            }
          });
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
        throw new GeminiError("Invalid Vertex credentials or missing IAM permissions", statusCode, error);
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
      const dueObj = new Date(deadline.dueDate);
      const dueLocal = dueObj.toLocaleString("en-US", {
        timeZone: config.TIMEZONE,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const status = deadline.completed ? "✅" : "⬜";
      parts.push(`- ${status} [${deadline.id}] ${deadline.course}: ${deadline.task} (Due ${dueLocal} local / ${dueObj.toISOString()} UTC, Priority: ${deadline.priority})`);
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
  return `You are Companion, a personal AI assistant for ${userName}, a university student at UiS (University of Stavanger). You have access to their full academic context including schedule and deadlines.

${contextWindow}

Your role is to be encouraging, conversational, and proactive. Help ${userName} plan their day, reflect on progress, work through problems, and stay on top of deadlines. Keep responses concise and friendly.

**Tool usage rules:**
- When the user asks to complete, reschedule, or edit a deadline, ALWAYS use the queueDeadlineAction tool. First call getDeadlines to find the deadline ID if you don't have it, then call queueDeadlineAction with the deadlineId and action ("complete" or "reschedule"). For reschedule, include newDueDate in ISO 8601 format.
- Do NOT just describe what you would do — actually call the tool to perform the action.
- Deadline IDs from the context window (in brackets like [deadline-xxx]) can be used directly without calling getDeadlines first.`;
}

let defaultClient: GeminiClient | null = null;

export function getGeminiClient(): GeminiClient {
  if (!defaultClient) {
    defaultClient = new GeminiClient();
  }
  return defaultClient;
}
