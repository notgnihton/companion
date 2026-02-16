import { config } from "./config.js";
import {
  GeminiClient,
  GeminiError,
  RateLimitError,
  GeminiMessage,
  buildContextWindow,
  buildSystemPrompt,
  getGeminiClient
} from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { ChatHistoryPage, ChatMessage, ChatMessageMetadata, UserContext } from "./types.js";

interface ChatContextResult {
  contextWindow: string;
  history: ChatMessage[];
}

function isSameDay(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() &&
    dateA.getUTCMonth() === dateB.getUTCMonth() &&
    dateA.getUTCDate() === dateB.getUTCDate()
  );
}

function buildCanvasContextSummary(): string {
  return "Canvas data: no synced courses yet. Connect Canvas to enrich responses with assignments, modules, and announcements.";
}

export function buildChatContext(store: RuntimeStore, now: Date = new Date(), historyLimit = 10): ChatContextResult {
  const todaySchedule = store
    .getScheduleEvents()
    .filter((event) => isSameDay(new Date(event.startTime), now));

  const upcomingDeadlines = store
    .getDeadlines(now)
    .filter((deadline) => {
      const due = new Date(deadline.dueDate);
      if (Number.isNaN(due.getTime())) {
        return false;
      }
      const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= 7;
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const recentJournals = store.getJournalEntries(3);
  const userState: UserContext = store.getUserContext();
  const canvasContext = buildCanvasContextSummary();

  const contextWindow = buildContextWindow({
    todaySchedule,
    upcomingDeadlines,
    recentJournals,
    userState,
    customContext: canvasContext
  });

  const history = store.getRecentChatMessages(historyLimit);

  return { contextWindow, history };
}

function toGeminiMessages(history: ChatMessage[], userInput: string): GeminiMessage[] {
  const formatted: GeminiMessage[] = history.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));

  formatted.push({
    role: "user" as const,
    parts: [{ text: userInput }]
  });

  return formatted;
}

export interface SendChatResult {
  reply: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  finishReason?: string;
  usage?: ChatMessageMetadata["usage"];
  history: ChatHistoryPage;
}

export async function sendChatMessage(
  store: RuntimeStore,
  userInput: string,
  options: { now?: Date; geminiClient?: GeminiClient } = {}
): Promise<SendChatResult> {
  const now = options.now ?? new Date();
  const gemini = options.geminiClient ?? getGeminiClient();
  const { contextWindow, history } = buildChatContext(store, now);

  const systemInstruction = buildSystemPrompt(config.AXIS_USER_NAME, contextWindow);
  const messages = toGeminiMessages(history, userInput);

  const response = await gemini.generateChatResponse({
    messages,
    systemInstruction
  });

  const userMessage = store.recordChatMessage("user", userInput);

  const assistantMetadata: ChatMessageMetadata = {
    contextWindow,
    finishReason: response.finishReason,
    usage: response.usageMetadata
      ? {
          promptTokens: response.usageMetadata.promptTokenCount,
          responseTokens: response.usageMetadata.candidatesTokenCount,
          totalTokens: response.usageMetadata.totalTokenCount
        }
      : undefined
  };

  const assistantMessage = store.recordChatMessage("assistant", response.text, assistantMetadata);

  const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

  return {
    reply: assistantMessage.content,
    userMessage,
    assistantMessage,
    finishReason: response.finishReason,
    usage: assistantMetadata.usage,
    history: historyPage
  };
}

export { GeminiError, RateLimitError };
