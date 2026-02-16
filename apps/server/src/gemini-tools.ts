import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { RuntimeStore } from "./store.js";
import { Deadline, EmailDigest, JournalEntry, LectureEvent } from "./types.js";

/**
 * Function declarations for Gemini function calling.
 * These define the tools that Gemini can invoke to retrieve information on demand.
 */

export const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "getSchedule",
    description:
      "Get today's lecture schedule for the user. Returns list of lectures with times, durations, and course names. Use this when user asks about today's schedule, what lectures they have, or when they're free today.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "getDeadlines",
    description:
      "Get upcoming deadlines for assignments and tasks. Returns deadlines with due dates, priority levels, and completion status. Use this when user asks about upcoming work, deadlines, or what's due soon.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysAhead: {
          type: SchemaType.NUMBER,
          description: "Number of days ahead to fetch deadlines (default: 14 days)"
        }
      },
      required: []
    }
  },
  {
    name: "searchJournal",
    description:
      "Search journal entries by keywords or date range. Returns journal entries matching the search criteria. Use this when user wants to recall past entries, reflect on previous experiences, or find specific journal content.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: "Search query to match against journal content"
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of entries to return (default: 10)"
        }
      },
      required: []
    }
  },
  {
    name: "getEmails",
    description:
      "Get recent unread emails from Gmail. Returns email messages with subjects, senders, timestamps, snippets, unread count, and actionable items (Canvas notifications, deadline reminders from professors). Use this when user asks about emails, inbox, unread messages, or important emails.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of email messages to return (default: 5)"
        }
      },
      required: []
    }
  },
  {
    name: "getSocialDigest",
    description:
      "Get recent social media content digest from YouTube subscriptions and X (Twitter) feed. Returns recent videos and tweets. Use this when user asks about social media updates, YouTube videos, or X posts from accounts they follow.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        daysBack: {
          type: SchemaType.NUMBER,
          description: "Number of days to look back for content (default: 3)"
        }
      },
      required: []
    }
  }
];

/**
 * Function handlers that execute the actual function calls.
 */

export interface FunctionCallResult {
  name: string;
  response: unknown;
}

function isSameDay(dateA: Date, dateB: Date): boolean {
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() &&
    dateA.getUTCMonth() === dateB.getUTCMonth() &&
    dateA.getUTCDate() === dateB.getUTCDate()
  );
}

export function handleGetSchedule(store: RuntimeStore, _args: Record<string, unknown> = {}): LectureEvent[] {
  const now = new Date();
  const todaySchedule = store
    .getScheduleEvents()
    .filter((event) => isSameDay(new Date(event.startTime), now));

  return todaySchedule;
}

export function handleGetDeadlines(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): Deadline[] {
  const daysAhead = (args.daysAhead as number) ?? 14;
  const now = new Date();

  const deadlines = store.getDeadlines(now).filter((deadline) => {
    const due = new Date(deadline.dueDate);
    if (Number.isNaN(due.getTime())) {
      return false;
    }
    const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= daysAhead;
  });

  return deadlines;
}

export function handleSearchJournal(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): JournalEntry[] {
  const query = (args.query as string) ?? "";
  const limit = (args.limit as number) ?? 10;

  if (!query) {
    // If no query, return recent entries
    return store.getJournalEntries(limit);
  }

  const results = store.searchJournalEntries({
    query,
    limit
  });

  return results;
}

export function handleGetEmails(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { messages: unknown[]; unreadCount: number; actionableItems: unknown[] } {
  const limit = (args.limit as number) ?? 5;
  const gmailData = store.getGmailData();
  
  if (!gmailData) {
    return {
      messages: [],
      unreadCount: 0,
      actionableItems: []
    };
  }

  return {
    messages: gmailData.messages.slice(0, limit),
    unreadCount: gmailData.unreadCount,
    actionableItems: gmailData.actionableItems
  };
}

export function handleGetSocialDigest(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { youtube: unknown; x: unknown } {
  const daysBack = (args.daysBack as number) ?? 3;
  const now = new Date();
  const cutoffTime = now.getTime() - daysBack * 24 * 60 * 60 * 1000;

  // Get YouTube data
  const youtubeData = store.getYouTubeData();
  const recentVideos =
    youtubeData?.videos.filter((video) => {
      const publishedAt = new Date(video.publishedAt);
      return !Number.isNaN(publishedAt.getTime()) && publishedAt.getTime() >= cutoffTime;
    }) ?? [];

  // Get X data
  const xData = store.getXData();
  const recentTweets =
    xData?.tweets.filter((tweet) => {
      const createdAt = new Date(tweet.createdAt);
      return !Number.isNaN(createdAt.getTime()) && createdAt.getTime() >= cutoffTime;
    }) ?? [];

  return {
    youtube: {
      videos: recentVideos.slice(0, 10),
      total: recentVideos.length
    },
    x: {
      tweets: recentTweets.slice(0, 10),
      total: recentTweets.length
    }
  };
}

/**
 * Execute a function call by name with provided arguments.
 */
export function executeFunctionCall(
  name: string,
  args: Record<string, unknown>,
  store: RuntimeStore
): FunctionCallResult {
  let response: unknown;

  switch (name) {
    case "getSchedule":
      response = handleGetSchedule(store, args);
      break;
    case "getDeadlines":
      response = handleGetDeadlines(store, args);
      break;
    case "searchJournal":
      response = handleSearchJournal(store, args);
      break;
    case "getEmails":
      response = handleGetEmails(store, args);
      break;
    case "getSocialDigest":
      response = handleGetSocialDigest(store, args);
      break;
    default:
      throw new Error(`Unknown function: ${name}`);
  }

  return { name, response };
}
