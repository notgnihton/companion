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
import { Part } from "@google/generative-ai";
import { functionDeclarations, executeFunctionCall, executePendingChatAction } from "./gemini-tools.js";
import { generateContentRecommendations } from "./content-recommendations.js";
import { RuntimeStore } from "./store.js";
import {
  ChatCitation,
  ChatHistoryPage,
  ChatMessage,
  ChatMessageMetadata,
  ChatPendingAction,
  UserContext
} from "./types.js";

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

function buildCanvasContextSummary(store: RuntimeStore, now: Date = new Date()): string {
  const canvasData = store.getCanvasData();
  
  if (!canvasData || canvasData.announcements.length === 0) {
    return "Canvas data: no synced courses yet. Connect Canvas to enrich responses with assignments, modules, and announcements.";
  }

  const recentAnnouncements = canvasData.announcements
    .filter((ann) => {
      const postedAt = new Date(ann.posted_at);
      if (Number.isNaN(postedAt.getTime())) {
        return false;
      }
      const daysSincePosted = (now.getTime() - postedAt.getTime()) / (1000 * 60 * 60 * 24);
      return daysSincePosted <= 7;
    })
    .sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime())
    .slice(0, 5);

  if (recentAnnouncements.length === 0) {
    return "Canvas: No recent announcements (last 7 days).";
  }

  const parts = ["**Canvas Announcements (last 7 days):**"];
  recentAnnouncements.forEach((ann) => {
    const postedDate = new Date(ann.posted_at).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric"
    });
    const preview = ann.message.replace(/<[^>]*>/g, "").slice(0, 80);
    parts.push(`- ${ann.title} (${postedDate}): ${preview}${ann.message.length > 80 ? "..." : ""}`);
  });

  return parts.join("\n");
}

function buildGmailContextSummary(store: RuntimeStore, now: Date = new Date()): string {
  const gmailData = store.getGmailData();

  if (!gmailData.messages || gmailData.messages.length === 0) {
    return "Gmail: No emails synced yet. Connect Gmail to see inbox summary.";
  }

  const messages = gmailData.messages;
  const unreadMessages = messages.filter((msg) => !msg.isRead);
  const unreadCount = unreadMessages.length;

  // Identify important senders (Canvas, UiS, course-related)
  const importantKeywords = [
    "instructure.com",
    "canvas",
    "uis.no",
    "stavanger",
    "github",
    "noreply",
    "notification"
  ];

  const importantMessages = unreadMessages.filter((msg) => {
    const fromLower = msg.from.toLowerCase();
    const subjectLower = msg.subject.toLowerCase();
    return importantKeywords.some((keyword) => fromLower.includes(keyword) || subjectLower.includes(keyword));
  });

  // Identify actionable items (Canvas notifications, deadline reminders)
  const actionableKeywords = [
    "graded",
    "due",
    "deadline",
    "reminder",
    "assignment",
    "submission",
    "posted",
    "announced",
    "updated"
  ];

  const actionableMessages = unreadMessages.filter((msg) => {
    const subjectLower = msg.subject.toLowerCase();
    const snippetLower = msg.snippet.toLowerCase();
    return actionableKeywords.some((keyword) => subjectLower.includes(keyword) || snippetLower.includes(keyword));
  });

  const parts = [`**Gmail Inbox:** ${unreadCount} unread message${unreadCount !== 1 ? "s" : ""}`];

  if (importantMessages.length > 0) {
    parts.push("");
    parts.push("**Important senders:**");
    importantMessages.slice(0, 3).forEach((msg) => {
      const receivedDate = new Date(msg.receivedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
      const fromName = msg.from.includes("<") ? msg.from.split("<")[0].trim() : msg.from;
      const subjectPreview = msg.subject.length > 60 ? msg.subject.slice(0, 60) + "..." : msg.subject;
      parts.push(`- ${fromName}: "${subjectPreview}" (${receivedDate})`);
    });
  }

  if (actionableMessages.length > 0) {
    parts.push("");
    parts.push("**Actionable items:**");
    actionableMessages.slice(0, 3).forEach((msg) => {
      const receivedDate = new Date(msg.receivedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      });
      const snippetPreview = msg.snippet.length > 80 ? msg.snippet.slice(0, 80) + "..." : msg.snippet;
      parts.push(`- ${msg.subject} (${receivedDate}): ${snippetPreview}`);
    });
  }

  return parts.join("\n");
}

function buildSocialMediaContextSummary(store: RuntimeStore, now: Date = new Date()): string {
  const parts: string[] = [];
  
  // YouTube context
  const youtubeData = store.getYouTubeData();
  if (youtubeData && youtubeData.videos.length > 0) {
    const recentVideos = youtubeData.videos
      .filter((video) => {
        const publishedAt = new Date(video.publishedAt);
        if (Number.isNaN(publishedAt.getTime())) {
          return false;
        }
        const hoursSincePublished = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
        return hoursSincePublished <= 72; // Last 3 days
      })
      .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
      .slice(0, 5);

    if (recentVideos.length > 0) {
      parts.push("**Recent YouTube Videos (last 3 days):**");
      recentVideos.forEach((video) => {
        const publishedDate = new Date(video.publishedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        const titlePreview = video.title.length > 60 ? video.title.slice(0, 60) + "..." : video.title;
        parts.push(`- ${video.channelTitle}: "${titlePreview}" (${publishedDate})`);
      });
    }
  }

  // X/Twitter context
  const xData = store.getXData();
  if (xData && xData.tweets.length > 0) {
    const recentTweets = xData.tweets
      .filter((tweet) => {
        const createdAt = new Date(tweet.createdAt);
        if (Number.isNaN(createdAt.getTime())) {
          return false;
        }
        const hoursSinceCreated = (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        return hoursSinceCreated <= 48; // Last 2 days
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);

    if (recentTweets.length > 0) {
      if (parts.length > 0) {
        parts.push("");
      }
      parts.push("**Recent Posts on X (last 2 days):**");
      recentTweets.forEach((tweet) => {
        const createdDate = new Date(tweet.createdAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric"
        });
        const textPreview = tweet.text.length > 80 ? tweet.text.slice(0, 80) + "..." : tweet.text;
        parts.push(`- @${tweet.authorUsername} (${createdDate}): ${textPreview}`);
      });
    }
  }

  if (parts.length === 0) {
    return "Social media: No recent data synced. Enable YouTube or X integrations to get updates.";
  }

  return parts.join("\n");
}

function buildContentRecommendationSummary(store: RuntimeStore, now: Date = new Date()): string {
  const result = generateContentRecommendations(
    store.getDeadlines(now),
    store.getScheduleEvents(),
    store.getYouTubeData(),
    store.getXData(),
    {
      now,
      horizonDays: 7,
      limit: 3
    }
  );

  if (result.recommendations.length === 0) {
    return "";
  }

  const parts = ["**Recommended content for upcoming work:**"];
  result.recommendations.slice(0, 3).forEach((recommendation) => {
    const platform = recommendation.content.platform === "youtube" ? "YouTube" : "X";
    const targetLabel = recommendation.target.type === "deadline"
      ? `${recommendation.target.course} ${recommendation.target.title}`
      : recommendation.target.title;
    parts.push(`- ${platform}: ${recommendation.content.title} -> ${targetLabel}`);
  });

  return parts.join("\n");
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
  const canvasContext = buildCanvasContextSummary(store, now);
  const gmailContext = buildGmailContextSummary(store, now);
  const socialMediaContext = buildSocialMediaContextSummary(store, now);
  const recommendationContext = buildContentRecommendationSummary(store, now);

  const contextWindow = buildContextWindow({
    todaySchedule,
    upcomingDeadlines,
    recentJournals,
    userState,
    customContext: [canvasContext, gmailContext, socialMediaContext, recommendationContext]
      .filter((section) => section.length > 0)
      .join("\n\n")
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

interface ParsedActionCommand {
  type: "confirm" | "cancel";
  actionId: string;
}

interface ExecutedFunctionResponse {
  name: string;
  rawResponse: unknown;
  modelResponse: unknown;
}

function parseActionCommand(input: string): ParsedActionCommand | null {
  const match = input.trim().match(/^(confirm|cancel)\s+([a-zA-Z0-9_-]+)$/i);
  if (!match) {
    return null;
  }

  return {
    type: match[1].toLowerCase() as ParsedActionCommand["type"],
    actionId: match[2]
  };
}

function extractPendingActions(value: unknown): ChatPendingAction[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const candidate = value as { pendingAction?: unknown; requiresConfirmation?: unknown };
  if (!candidate.requiresConfirmation || !candidate.pendingAction) {
    return [];
  }

  const pendingAction = candidate.pendingAction as Partial<ChatPendingAction>;
  if (
    typeof pendingAction.id !== "string" ||
    typeof pendingAction.actionType !== "string" ||
    typeof pendingAction.summary !== "string" ||
    typeof pendingAction.createdAt !== "string" ||
    typeof pendingAction.expiresAt !== "string" ||
    typeof pendingAction.payload !== "object" ||
    pendingAction.payload === null
  ) {
    return [];
  }

  return [pendingAction as ChatPendingAction];
}

function buildPendingActionFallbackReply(actions: ChatPendingAction[]): string {
  if (actions.length === 0) {
    return "I couldn't complete that request. Please try again.";
  }

  const lines = ["I prepared actions that need your confirmation before execution:"];
  actions.forEach((action) => {
    lines.push(`- ${action.summary}`);
    lines.push(`  Confirm: confirm ${action.id}`);
    lines.push(`  Cancel: cancel ${action.id}`);
  });
  return lines.join("\n");
}

function buildScheduleFallbackSection(response: unknown): string | null {
  if (!Array.isArray(response)) {
    return null;
  }
  if (response.length === 0) {
    return "Schedule: no events found for today.";
  }

  const lines: string[] = [`Schedule today (${response.length}):`];
  response.slice(0, 4).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const title = asNonEmptyString(record.title) ?? "Untitled event";
    const start = asNonEmptyString(record.startTime) ?? "unknown time";
    lines.push(`- ${title} (${start})`);
  });
  if (response.length > 4) {
    lines.push(`- +${response.length - 4} more`);
  }
  return lines.join("\n");
}

function buildDeadlinesFallbackSection(response: unknown): string | null {
  if (!Array.isArray(response)) {
    return null;
  }
  if (response.length === 0) {
    return "Deadlines: no upcoming items found.";
  }

  const lines: string[] = [`Upcoming deadlines (${response.length}):`];
  response.slice(0, 5).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const course = asNonEmptyString(record.course) ?? "Course";
    const task = asNonEmptyString(record.task) ?? "Task";
    const dueDate = asNonEmptyString(record.dueDate) ?? "unknown due date";
    lines.push(`- ${course}: ${textSnippet(task, 90)} (due ${dueDate})`);
  });
  if (response.length > 5) {
    lines.push(`- +${response.length - 5} more`);
  }
  return lines.join("\n");
}

function buildEmailsFallbackSection(response: unknown): string | null {
  if (!Array.isArray(response)) {
    return null;
  }
  if (response.length === 0) {
    return "Emails: no recent messages found.";
  }

  const lines: string[] = [`Recent emails (${response.length}):`];
  response.slice(0, 4).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const subject = asNonEmptyString(record.subject) ?? "No subject";
    lines.push(`- ${textSnippet(subject, 100)}`);
  });
  if (response.length > 4) {
    lines.push(`- +${response.length - 4} more`);
  }
  return lines.join("\n");
}

function buildSocialFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }

  const youtube = asRecord(payload.youtube);
  const videos = Array.isArray(youtube?.videos) ? youtube.videos : [];
  const x = asRecord(payload.x);
  const tweets = Array.isArray(x?.tweets) ? x.tweets : [];

  const sections: string[] = [];
  if (videos.length > 0) {
    const lines = [`Recent YouTube videos (${videos.length}):`];
    videos.slice(0, 3).forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const title = asNonEmptyString(record.title) ?? "Untitled video";
      const channel = asNonEmptyString(record.channelTitle);
      lines.push(`- ${channel ? `${channel}: ` : ""}${textSnippet(title, 100)}`);
    });
    if (videos.length > 3) {
      lines.push(`- +${videos.length - 3} more`);
    }
    sections.push(lines.join("\n"));
  }

  if (tweets.length > 0) {
    const lines = [`Recent X posts (${tweets.length}):`];
    tweets.slice(0, 3).forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const author = asNonEmptyString(record.authorUsername);
      const text = asNonEmptyString(record.text) ?? "";
      lines.push(`- ${author ? `@${author}: ` : ""}${textSnippet(text, 100)}`);
    });
    if (tweets.length > 3) {
      lines.push(`- +${tweets.length - 3} more`);
    }
    sections.push(lines.join("\n"));
  }

  if (sections.length === 0) {
    return "Social media: no recent items found.";
  }
  return sections.join("\n");
}

function buildJournalFallbackSection(response: unknown): string | null {
  if (!Array.isArray(response)) {
    return null;
  }
  if (response.length === 0) {
    return "Journal: no matching entries found.";
  }

  const lines: string[] = [`Journal matches (${response.length}):`];
  response.slice(0, 3).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const content = asNonEmptyString(record.content) ?? "";
    lines.push(`- ${textSnippet(content, 110)}`);
  });
  if (response.length > 3) {
    lines.push(`- +${response.length - 3} more`);
  }
  return lines.join("\n");
}

function buildToolRateLimitFallbackReply(
  functionResponses: ExecutedFunctionResponse[],
  pendingActions: ChatPendingAction[]
): string {
  return buildToolDataFallbackReply(
    functionResponses,
    pendingActions,
    "Gemini hit a temporary rate limit, but I fetched your data:"
  );
}

function buildToolDataFallbackReply(
  functionResponses: ExecutedFunctionResponse[],
  pendingActions: ChatPendingAction[],
  introLine: string
): string {
  if (pendingActions.length > 0) {
    return buildPendingActionFallbackReply(pendingActions);
  }

  const sections: string[] = [];
  functionResponses.forEach((result) => {
    let section: string | null = null;
    switch (result.name) {
      case "getSchedule":
        section = buildScheduleFallbackSection(result.rawResponse);
        break;
      case "getDeadlines":
        section = buildDeadlinesFallbackSection(result.rawResponse);
        break;
      case "getEmails":
        section = buildEmailsFallbackSection(result.rawResponse);
        break;
      case "getSocialDigest":
        section = buildSocialFallbackSection(result.rawResponse);
        break;
      case "searchJournal":
        section = buildJournalFallbackSection(result.rawResponse);
        break;
      default:
        section = null;
        break;
    }

    if (section) {
      sections.push(section);
    }
  });

  if (sections.length === 0) {
    return "I couldn't finish the response from tool data right now. Please try again in a moment.";
  }

  return [
    introLine,
    "",
    sections.join("\n\n")
  ].join("\n");
}

const MAX_CHAT_CITATIONS = 8;
const FUNCTION_CALL_HISTORY_LIMIT = 6;
const MAX_FUNCTION_CALL_ROUNDS = 4;
const TOOL_RESULT_ITEM_LIMIT = 6;
const TOOL_RESULT_TEXT_MAX_CHARS = 220;
const TOOL_RESULT_MAX_DEPTH = 3;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function textSnippet(value: string, maxLength = 80): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function citationKey(citation: ChatCitation): string {
  return `${citation.type}:${citation.id}`;
}

function addCitation(citations: Map<string, ChatCitation>, citation: ChatCitation): void {
  if (!citation.id || !citation.label) {
    return;
  }
  const key = citationKey(citation);
  if (!citations.has(key)) {
    citations.set(key, citation);
  }
}

function compactTextValue(value: unknown, maxLength = TOOL_RESULT_TEXT_MAX_CHARS): unknown {
  return typeof value === "string" ? textSnippet(value, maxLength) : value;
}

function compactGenericValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return compactTextValue(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (depth >= TOOL_RESULT_MAX_DEPTH) {
    if (Array.isArray(value)) {
      return `[truncated array length=${value.length}]`;
    }
    return "[truncated object]";
  }

  if (Array.isArray(value)) {
    const limitedItems = value
      .slice(0, TOOL_RESULT_ITEM_LIMIT)
      .map((item) => compactGenericValue(item, depth + 1));
    if (value.length > TOOL_RESULT_ITEM_LIMIT) {
      limitedItems.push(`[${value.length - TOOL_RESULT_ITEM_LIMIT} more items omitted]`);
    }
    return limitedItems;
  }

  const record = asRecord(value);
  if (!record) {
    return "[unsupported value]";
  }

  const entries = Object.entries(record).slice(0, 14);
  const compacted: Record<string, unknown> = {};
  entries.forEach(([key, entryValue]) => {
    compacted[key] = compactGenericValue(entryValue, depth + 1);
  });
  if (Object.keys(record).length > entries.length) {
    compacted.__truncated = true;
  }
  return compacted;
}

function compactScheduleForModel(response: unknown): unknown {
  if (!Array.isArray(response)) {
    return compactGenericValue(response);
  }

  return {
    total: response.length,
    events: response.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        title: compactTextValue(asNonEmptyString(record.title) ?? "", 120),
        startTime: asNonEmptyString(record.startTime) ?? null,
        durationMinutes: record.durationMinutes ?? null,
        workload: asNonEmptyString(record.workload) ?? null,
        source: asNonEmptyString(record.source) ?? null
      };
    }),
    truncated: response.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactDeadlinesForModel(response: unknown): unknown {
  if (!Array.isArray(response)) {
    return compactGenericValue(response);
  }

  return {
    total: response.length,
    deadlines: response.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        course: compactTextValue(asNonEmptyString(record.course) ?? "", 40),
        task: compactTextValue(asNonEmptyString(record.task) ?? "", 120),
        dueDate: asNonEmptyString(record.dueDate) ?? null,
        priority: asNonEmptyString(record.priority) ?? null,
        completed: Boolean(record.completed)
      };
    }),
    truncated: response.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactJournalForModel(response: unknown): unknown {
  if (!Array.isArray(response)) {
    return compactGenericValue(response);
  }

  return {
    total: response.length,
    entries: response.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        timestamp: asNonEmptyString(record.timestamp) ?? null,
        contentSnippet: compactTextValue(asNonEmptyString(record.content) ?? "", 180)
      };
    }),
    truncated: response.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactEmailsForModel(response: unknown): unknown {
  if (!Array.isArray(response)) {
    return compactGenericValue(response);
  }

  return {
    total: response.length,
    emails: response.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        from: compactTextValue(asNonEmptyString(record.from) ?? "", 70),
        subject: compactTextValue(asNonEmptyString(record.subject) ?? "", 120),
        generatedAt: asNonEmptyString(record.generatedAt) ?? null,
        snippet: compactTextValue(asNonEmptyString(record.snippet) ?? "", 180)
      };
    }),
    truncated: response.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactSocialDigestForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  const youtube = asRecord(payload.youtube);
  const youtubeVideos = Array.isArray(youtube?.videos) ? youtube.videos : [];
  const x = asRecord(payload.x);
  const xTweets = Array.isArray(x?.tweets) ? x.tweets : [];

  return {
    youtube: {
      total: typeof youtube?.total === "number" ? youtube.total : youtubeVideos.length,
      videos: youtubeVideos.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
        const record = asRecord(value);
        if (!record) {
          return {};
        }
        return {
          id: asNonEmptyString(record.id) ?? "",
          channelTitle: compactTextValue(asNonEmptyString(record.channelTitle) ?? "", 60),
          title: compactTextValue(asNonEmptyString(record.title) ?? "", 120),
          publishedAt: asNonEmptyString(record.publishedAt) ?? null
        };
      }),
      truncated: youtubeVideos.length > TOOL_RESULT_ITEM_LIMIT
    },
    x: {
      total: typeof x?.total === "number" ? x.total : xTweets.length,
      tweets: xTweets.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
        const record = asRecord(value);
        if (!record) {
          return {};
        }
        return {
          id: asNonEmptyString(record.id) ?? "",
          authorUsername: asNonEmptyString(record.authorUsername) ?? null,
          text: compactTextValue(asNonEmptyString(record.text) ?? "", 180),
          createdAt: asNonEmptyString(record.createdAt) ?? null
        };
      }),
      truncated: xTweets.length > TOOL_RESULT_ITEM_LIMIT
    }
  };
}

function compactFunctionResponseForModel(functionName: string, response: unknown): unknown {
  switch (functionName) {
    case "getSchedule":
      return compactScheduleForModel(response);
    case "getDeadlines":
      return compactDeadlinesForModel(response);
    case "searchJournal":
      return compactJournalForModel(response);
    case "getEmails":
      return compactEmailsForModel(response);
    case "getSocialDigest":
      return compactSocialDigestForModel(response);
    default:
      return compactGenericValue(response);
  }
}

function collectToolCitations(
  store: RuntimeStore,
  functionName: string,
  response: unknown
): ChatCitation[] {
  if (functionName === "getSchedule" && Array.isArray(response)) {
    const next: ChatCitation[] = [];
    response.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const title = asNonEmptyString(record.title);
      const startTime = asNonEmptyString(record.startTime);
      if (!id || !title) {
        return;
      }
      next.push({
        id,
        type: "schedule",
        label: startTime ? `${title} (${startTime})` : title,
        timestamp: startTime ?? undefined
      });
    });
    return next;
  }

  if (functionName === "getDeadlines" && Array.isArray(response)) {
    const next: ChatCitation[] = [];
    response.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const course = asNonEmptyString(record.course);
      const task = asNonEmptyString(record.task);
      const dueDate = asNonEmptyString(record.dueDate);
      if (!id || !course || !task) {
        return;
      }
      next.push({
        id,
        type: "deadline",
        label: dueDate ? `${course} ${task} (due ${dueDate})` : `${course} ${task}`,
        timestamp: dueDate ?? undefined
      });
    });
    return next;
  }

  if (functionName === "searchJournal" && Array.isArray(response)) {
    const next: ChatCitation[] = [];
    response.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const content = asNonEmptyString(record.content);
      const timestamp = asNonEmptyString(record.timestamp);
      if (!id || !content) {
        return;
      }
      next.push({
        id,
        type: "journal",
        label: textSnippet(content),
        timestamp: timestamp ?? undefined
      });
    });
    return next;
  }

  if (functionName === "getEmails" && Array.isArray(response)) {
    const next: ChatCitation[] = [];
    response.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const subject = asNonEmptyString(record.subject);
      const generatedAt = asNonEmptyString(record.generatedAt);
      if (!id || !subject) {
        return;
      }
      next.push({
        id,
        type: "email",
        label: textSnippet(subject),
        timestamp: generatedAt ?? undefined
      });
    });
    return next;
  }

  if (functionName === "getSocialDigest") {
    const payload = asRecord(response);
    if (!payload) {
      return [];
    }

    const next: ChatCitation[] = [];
    const youtube = asRecord(payload.youtube);
    const videos = youtube?.videos;
    if (Array.isArray(videos)) {
      videos.forEach((value) => {
        const record = asRecord(value);
        if (!record) {
          return;
        }
        const id = asNonEmptyString(record.id);
        const title = asNonEmptyString(record.title);
        const channelTitle = asNonEmptyString(record.channelTitle);
        const publishedAt = asNonEmptyString(record.publishedAt);
        if (!id || !title) {
          return;
        }
        next.push({
          id,
          type: "social-youtube",
          label: channelTitle ? `${channelTitle}: ${title}` : title,
          timestamp: publishedAt ?? undefined
        });
      });
    }

    const x = asRecord(payload.x);
    const tweets = x?.tweets;
    if (Array.isArray(tweets)) {
      tweets.forEach((value) => {
        const record = asRecord(value);
        if (!record) {
          return;
        }
        const id = asNonEmptyString(record.id);
        const text = asNonEmptyString(record.text);
        const authorUsername = asNonEmptyString(record.authorUsername);
        const createdAt = asNonEmptyString(record.createdAt);
        if (!id || !text) {
          return;
        }
        const label = authorUsername
          ? `@${authorUsername}: ${textSnippet(text)}`
          : textSnippet(text);
        next.push({
          id,
          type: "social-x",
          label,
          timestamp: createdAt ?? undefined
        });
      });
    }

    return next;
  }

  if (functionName === "queueDeadlineAction") {
    const payload = asRecord(response);
    const pendingAction = asRecord(payload?.pendingAction);
    const actionPayload = asRecord(pendingAction?.payload);
    const deadlineId = asNonEmptyString(actionPayload?.deadlineId);
    if (!deadlineId) {
      return [];
    }
    const deadline = store.getDeadlineById(deadlineId, false);
    if (!deadline) {
      return [];
    }
    return [
      {
        id: deadline.id,
        type: "deadline",
        label: `${deadline.course} ${deadline.task} (due ${deadline.dueDate})`,
        timestamp: deadline.dueDate
      }
    ];
  }

  return [];
}

export interface SendChatResult {
  reply: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  finishReason?: string;
  usage?: ChatMessageMetadata["usage"];
  citations: ChatCitation[];
  history: ChatHistoryPage;
}

export async function sendChatMessage(
  store: RuntimeStore,
  userInput: string,
  options: { now?: Date; geminiClient?: GeminiClient; useFunctionCalling?: boolean } = {}
): Promise<SendChatResult> {
  const now = options.now ?? new Date();
  const actionCommand = parseActionCommand(userInput);

  if (actionCommand) {
    const userMessage = store.recordChatMessage("user", userInput);
    const pendingAction = store.getPendingChatActionById(actionCommand.actionId, now);

    let assistantReply: string;
    let assistantMetadata: ChatMessageMetadata;

    if (!pendingAction) {
      assistantReply = `No pending action found for "${actionCommand.actionId}".`;
      assistantMetadata = {
        contextWindow: "",
        pendingActions: store.getPendingChatActions(now)
      };
    } else if (actionCommand.type === "cancel") {
      store.deletePendingChatAction(pendingAction.id);
      assistantReply = `Cancelled action "${pendingAction.summary}".`;
      assistantMetadata = {
        contextWindow: "",
        actionExecution: {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          status: "cancelled",
          message: "Cancelled by user confirmation command."
        },
        pendingActions: store.getPendingChatActions(now)
      };
    } else {
      const execution = executePendingChatAction(pendingAction, store);
      store.deletePendingChatAction(pendingAction.id);

      assistantReply = execution.message;
      assistantMetadata = {
        contextWindow: "",
        actionExecution: {
          actionId: execution.actionId,
          actionType: execution.actionType,
          status: execution.success ? "confirmed" : "failed",
          message: execution.message
        },
        pendingActions: store.getPendingChatActions(now)
      };
    }

    const assistantMessage = store.recordChatMessage("assistant", assistantReply, assistantMetadata);
    const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });
    const citations = assistantMessage.metadata?.citations ?? [];

    return {
      reply: assistantMessage.content,
      userMessage,
      assistantMessage,
      finishReason: "stop",
      citations,
      history: historyPage
    };
  }

  const gemini = options.geminiClient ?? getGeminiClient();
  const useFunctionCalling = options.useFunctionCalling ?? true;
  
  // Build lightweight context for function calling mode (or full context for legacy mode)
  const { contextWindow, history } = useFunctionCalling 
    ? { contextWindow: "", history: store.getRecentChatMessages(FUNCTION_CALL_HISTORY_LIMIT) }
    : buildChatContext(store, now);

  const systemInstruction = useFunctionCalling
    ? `You are Companion, a personal AI assistant for ${config.USER_NAME}, a university student at UiS (University of Stavanger). 

When you need information about the user's schedule, deadlines, journal entries, emails, or social media, use the available tools to fetch that data on demand.
For actions that change data, use queue* action tools and clearly request explicit user confirmation.
Keep responses concise, encouraging, and conversational.`
    : buildSystemPrompt(config.USER_NAME, contextWindow);

  const messages = toGeminiMessages(history, userInput);

  // First request with function calling enabled
  let response = await gemini.generateChatResponse({
    messages,
    systemInstruction,
    tools: useFunctionCalling ? functionDeclarations : undefined
  });

  const userMessage = store.recordChatMessage("user", userInput);
  let totalUsage = response.usageMetadata
    ? {
        promptTokens: response.usageMetadata.promptTokenCount,
        responseTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount
      }
    : undefined;
  let pendingActionsFromTooling: ChatPendingAction[] = [];
  let executedFunctionResponses: ExecutedFunctionResponse[] = [];
  const citations = new Map<string, ChatCitation>();

  // Handle function calls with iterative tool rounds.
  let functionCallRounds = 0;
  while (response.functionCalls && response.functionCalls.length > 0 && functionCallRounds < MAX_FUNCTION_CALL_ROUNDS) {
    functionCallRounds += 1;

    const roundFunctionResponses = response.functionCalls.map((fnCall) => {
      const result = executeFunctionCall(fnCall.name, fnCall.args as Record<string, unknown>, store);
      const nextCitations = collectToolCitations(store, result.name, result.response);
      nextCitations.forEach((citation) => addCitation(citations, citation));
      return {
        name: result.name,
        rawResponse: result.response,
        modelResponse: compactFunctionResponseForModel(result.name, result.response)
      };
    });
    executedFunctionResponses = [...executedFunctionResponses, ...roundFunctionResponses];
    pendingActionsFromTooling = [
      ...pendingActionsFromTooling,
      ...roundFunctionResponses.flatMap((fnResp) => extractPendingActions(fnResp.rawResponse))
    ];

    // Build function response messages
    const functionResponseParts = roundFunctionResponses.map((fnResp) => ({
      functionResponse: {
        name: fnResp.name,
        response: fnResp.modelResponse
      }
    })) as Part[];

    // Continue conversation with function results
    messages.push({
      role: "model" as const,
      parts: response.functionCalls.map((fnCall) => ({
        functionCall: fnCall
      })) as Part[]
    });

    messages.push({
      role: "user" as const,
      parts: functionResponseParts
    });

    // Get final response from Gemini with function results
    try {
      response = await gemini.generateChatResponse({
        messages,
        systemInstruction,
        tools: useFunctionCalling ? functionDeclarations : undefined
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        const fallbackReply = buildToolRateLimitFallbackReply(executedFunctionResponses, pendingActionsFromTooling);
        const assistantMetadata: ChatMessageMetadata = {
          contextWindow,
          finishReason: "rate_limit_fallback",
          usage: totalUsage,
          ...(pendingActionsFromTooling.length > 0 ? { pendingActions: store.getPendingChatActions(now) } : {}),
          ...(citations.size > 0
            ? { citations: Array.from(citations.values()).slice(0, MAX_CHAT_CITATIONS) }
            : {})
        };
        const assistantMessage = store.recordChatMessage("assistant", fallbackReply, assistantMetadata);
        const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

        return {
          reply: assistantMessage.content,
          userMessage,
          assistantMessage,
          finishReason: assistantMetadata.finishReason,
          usage: assistantMetadata.usage,
          citations: assistantMetadata.citations ?? [],
          history: historyPage
        };
      }
      throw error;
    }

    // Accumulate usage metrics
    if (response.usageMetadata && totalUsage) {
      totalUsage.promptTokens += response.usageMetadata.promptTokenCount;
      totalUsage.responseTokens += response.usageMetadata.candidatesTokenCount;
      totalUsage.totalTokens += response.usageMetadata.totalTokenCount;
    } else if (response.usageMetadata && !totalUsage) {
      totalUsage = {
        promptTokens: response.usageMetadata.promptTokenCount,
        responseTokens: response.usageMetadata.candidatesTokenCount,
        totalTokens: response.usageMetadata.totalTokenCount
      };
    }
  }

  if (response.functionCalls && response.functionCalls.length > 0 && functionCallRounds >= MAX_FUNCTION_CALL_ROUNDS) {
    const fallbackReply = buildToolDataFallbackReply(
      executedFunctionResponses,
      pendingActionsFromTooling,
      "I fetched your data, but couldn't finish the final response after several tool steps:"
    );
    const assistantMetadata: ChatMessageMetadata = {
      contextWindow,
      finishReason: "tool_call_round_limit_fallback",
      usage: totalUsage,
      ...(pendingActionsFromTooling.length > 0 ? { pendingActions: store.getPendingChatActions(now) } : {}),
      ...(citations.size > 0
        ? { citations: Array.from(citations.values()).slice(0, MAX_CHAT_CITATIONS) }
        : {})
    };
    const assistantMessage = store.recordChatMessage("assistant", fallbackReply, assistantMetadata);
    const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

    return {
      reply: assistantMessage.content,
      userMessage,
      assistantMessage,
      finishReason: assistantMetadata.finishReason,
      usage: assistantMetadata.usage,
      citations: assistantMetadata.citations ?? [],
      history: historyPage
    };
  }

  const finalReply = response.text.trim().length > 0
    ? response.text
    : executedFunctionResponses.length > 0
      ? buildToolDataFallbackReply(
          executedFunctionResponses,
          pendingActionsFromTooling,
          "I fetched your data:"
        )
      : buildPendingActionFallbackReply(pendingActionsFromTooling);

  const assistantMetadata: ChatMessageMetadata = {
    contextWindow,
    finishReason: response.finishReason,
    usage: totalUsage,
    ...(pendingActionsFromTooling.length > 0 ? { pendingActions: store.getPendingChatActions(now) } : {}),
    ...(citations.size > 0 ? { citations: Array.from(citations.values()).slice(0, MAX_CHAT_CITATIONS) } : {})
  };

  const assistantMessage = store.recordChatMessage("assistant", finalReply, assistantMetadata);

  const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

  return {
    reply: assistantMessage.content,
    userMessage,
    assistantMessage,
    finishReason: response.finishReason,
    usage: assistantMetadata.usage,
    citations: assistantMetadata.citations ?? [],
    history: historyPage
  };
}

export { GeminiError, RateLimitError };
