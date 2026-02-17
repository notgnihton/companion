import { FunctionDeclaration, SchemaType } from "@google/generative-ai";
import { RuntimeStore } from "./store.js";
import {
  ChatActionType,
  ChatPendingAction,
  Deadline,
  GmailMessage,
  GoalWithStatus,
  GitHubCourseDocument,
  HabitWithStatus,
  JournalEntry,
  LectureEvent
} from "./types.js";

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
      "Get recent Gmail inbox messages. Returns sender, subject, snippet, read status, and received timestamp. Use this when user asks about emails, inbox, what their latest email said, or message contents.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of emails to return (default: 5, max: 20)"
        },
        unreadOnly: {
          type: SchemaType.BOOLEAN,
          description: "Set true to return only unread emails"
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
  },
  {
    name: "getHabitsGoalsStatus",
    description:
      "Get current habits and goals progress. Returns streaks, completion rates, and whether today's check-ins are done.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: "updateHabitCheckIn",
    description:
      "Update a habit check-in for today. Use this when the user asks to check in or uncheck a specific habit.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        habitId: {
          type: SchemaType.STRING,
          description: "Habit ID (preferred when known)."
        },
        habitName: {
          type: SchemaType.STRING,
          description: "Habit name hint (for name-based matching when ID is unknown)."
        },
        completed: {
          type: SchemaType.BOOLEAN,
          description: "Set true to check in, false to uncheck. Defaults to toggle if omitted."
        }
      },
      required: []
    }
  },
  {
    name: "updateGoalCheckIn",
    description:
      "Update a goal check-in for today. Use this when the user asks to log or undo progress on a specific goal.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        goalId: {
          type: SchemaType.STRING,
          description: "Goal ID (preferred when known)."
        },
        goalTitle: {
          type: SchemaType.STRING,
          description: "Goal title hint (for name-based matching when ID is unknown)."
        },
        completed: {
          type: SchemaType.BOOLEAN,
          description: "Set true to log progress today, false to remove today's check-in. Defaults to toggle."
        }
      },
      required: []
    }
  },
  {
    name: "getGitHubCourseContent",
    description:
      "Get synced GitHub syllabus/course-info documents. Use this for questions about course policies, deliverables, grading, exams, lab expectations, and repository-based course material.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        courseCode: {
          type: SchemaType.STRING,
          description: "Optional course code filter such as DAT560 or DAT520."
        },
        query: {
          type: SchemaType.STRING,
          description: "Optional keyword query to rank matching documents."
        },
        limit: {
          type: SchemaType.NUMBER,
          description: "Maximum number of documents to return (default: 5, max: 10)."
        }
      },
      required: []
    }
  },
  {
    name: "queueDeadlineAction",
    description:
      "Queue a deadline action that REQUIRES explicit user confirmation before execution. Use this to request complete or snooze for a specific deadline.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        deadlineId: {
          type: SchemaType.STRING,
          description: "Deadline ID to modify"
        },
        action: {
          type: SchemaType.STRING,
          description: "Action to queue: complete or snooze"
        },
        snoozeHours: {
          type: SchemaType.NUMBER,
          description: "When action is snooze, number of hours to delay (default: 24)"
        }
      },
      required: ["deadlineId", "action"]
    }
  },
  {
    name: "queueScheduleBlock",
    description:
      "Queue creation of a schedule block that REQUIRES explicit user confirmation before execution.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: {
          type: SchemaType.STRING,
          description: "Title for the schedule block"
        },
        startTime: {
          type: SchemaType.STRING,
          description: "ISO datetime when the block starts"
        },
        durationMinutes: {
          type: SchemaType.NUMBER,
          description: "Length of block in minutes (default: 60)"
        },
        workload: {
          type: SchemaType.STRING,
          description: "Workload level: low, medium, high (default: medium)"
        }
      },
      required: ["title", "startTime"]
    }
  },
  {
    name: "createJournalEntry",
    description:
      "Create and save a journal entry immediately. Use this when the user asks to save something to their journal right now.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: {
          type: SchemaType.STRING,
          description: "Journal text content to save immediately"
        }
      },
      required: ["content"]
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
): GmailMessage[] {
  const limit = clampNumber(args.limit, 5, 1, 20);
  const unreadOnly = args.unreadOnly === true;
  const messages = store
    .getGmailMessages()
    .filter((message) => (unreadOnly ? !message.isRead : true))
    .sort((left, right) => {
      const leftMs = new Date(left.receivedAt).getTime();
      const rightMs = new Date(right.receivedAt).getTime();
      const safeLeftMs = Number.isFinite(leftMs) ? leftMs : 0;
      const safeRightMs = Number.isFinite(rightMs) ? rightMs : 0;
      return safeRightMs - safeLeftMs;
    });

  return messages.slice(0, limit);
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

export function handleGetHabitsGoalsStatus(
  store: RuntimeStore
): {
  habits: HabitWithStatus[];
  goals: GoalWithStatus[];
  summary: {
    habitsCompletedToday: number;
    habitsTotal: number;
    goalsCompletedToday: number;
    goalsTotal: number;
  };
} {
  const habits = store.getHabitsWithStatus();
  const goals = store.getGoalsWithStatus();

  return {
    habits,
    goals,
    summary: {
      habitsCompletedToday: habits.filter((habit) => habit.todayCompleted).length,
      habitsTotal: habits.length,
      goalsCompletedToday: goals.filter((goal) => goal.todayCompleted).length,
      goalsTotal: goals.length
    }
  };
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function resolveHabitTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): HabitWithStatus | { error: string } {
  const habitId = asTrimmedString(args.habitId);
  if (habitId) {
    const byId = store.getHabitsWithStatus().find((habit) => habit.id === habitId);
    if (!byId) {
      return { error: `Habit not found: ${habitId}` };
    }
    return byId;
  }

  const habitName = asTrimmedString(args.habitName);
  const habits = store.getHabitsWithStatus();
  if (habits.length === 0) {
    return { error: "No habits are configured yet." };
  }

  if (!habitName) {
    if (habits.length === 1) {
      return habits[0];
    }
    return { error: "Provide habitId or habitName when multiple habits exist." };
  }

  const needle = normalizeSearchText(habitName);
  const matches = habits.filter((habit) => normalizeSearchText(habit.name).includes(needle));
  if (matches.length === 0) {
    return { error: `No habit matched "${habitName}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Habit name is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((habit) => habit.name)
        .join(", ")}`
    };
  }
  return matches[0];
}

function resolveGoalTarget(
  store: RuntimeStore,
  args: Record<string, unknown>
): GoalWithStatus | { error: string } {
  const goalId = asTrimmedString(args.goalId);
  if (goalId) {
    const byId = store.getGoalsWithStatus().find((goal) => goal.id === goalId);
    if (!byId) {
      return { error: `Goal not found: ${goalId}` };
    }
    return byId;
  }

  const goalTitle = asTrimmedString(args.goalTitle);
  const goals = store.getGoalsWithStatus();
  if (goals.length === 0) {
    return { error: "No goals are configured yet." };
  }

  if (!goalTitle) {
    if (goals.length === 1) {
      return goals[0];
    }
    return { error: "Provide goalId or goalTitle when multiple goals exist." };
  }

  const needle = normalizeSearchText(goalTitle);
  const matches = goals.filter((goal) => normalizeSearchText(goal.title).includes(needle));
  if (matches.length === 0) {
    return { error: `No goal matched "${goalTitle}".` };
  }
  if (matches.length > 1) {
    return {
      error: `Goal title is ambiguous. Matches: ${matches
        .slice(0, 4)
        .map((goal) => goal.title)
        .join(", ")}`
    };
  }
  return matches[0];
}

export function handleUpdateHabitCheckIn(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; habit: HabitWithStatus; message: string } | { error: string } {
  const resolved = resolveHabitTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const next = store.toggleHabitCheckIn(resolved.id, {
    completed: typeof args.completed === "boolean" ? args.completed : undefined
  });

  if (!next) {
    return { error: "Unable to update habit check-in." };
  }

  return {
    success: true,
    habit: next,
    message: next.todayCompleted
      ? `Checked in habit "${next.name}" for today.`
      : `Removed today's check-in for habit "${next.name}".`
  };
}

export function handleUpdateGoalCheckIn(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; goal: GoalWithStatus; message: string } | { error: string } {
  const resolved = resolveGoalTarget(store, args);
  if ("error" in resolved) {
    return resolved;
  }

  const next = store.toggleGoalCheckIn(resolved.id, {
    completed: typeof args.completed === "boolean" ? args.completed : undefined
  });

  if (!next) {
    return { error: "Unable to update goal check-in." };
  }

  return {
    success: true,
    goal: next,
    message: next.todayCompleted
      ? `Logged progress for goal "${next.title}" today.`
      : `Removed today's goal progress for "${next.title}".`
  };
}

export interface PendingActionToolResponse {
  requiresConfirmation: true;
  pendingAction: ChatPendingAction;
  confirmationCommand: string;
  cancelCommand: string;
  message: string;
}

export interface PendingActionExecutionResult {
  actionId: string;
  actionType: ChatActionType;
  success: boolean;
  message: string;
  deadline?: Deadline;
  lecture?: LectureEvent;
  journal?: JournalEntry;
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number.NaN;
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeSearchTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreGitHubCourseDocument(doc: GitHubCourseDocument, queryTokens: string[]): number {
  if (queryTokens.length === 0) {
    return 1;
  }

  const title = doc.title.toLowerCase();
  const summary = doc.summary.toLowerCase();
  const snippet = doc.snippet.toLowerCase();
  const path = doc.path.toLowerCase();
  const repo = `${doc.owner}/${doc.repo}`.toLowerCase();
  const highlights = doc.highlights.join(" ").toLowerCase();

  let score = 0;
  queryTokens.forEach((token) => {
    if (title.includes(token)) score += 6;
    if (summary.includes(token)) score += 5;
    if (snippet.includes(token)) score += 4;
    if (highlights.includes(token)) score += 3;
    if (path.includes(token)) score += 2;
    if (repo.includes(token)) score += 2;
    if (doc.courseCode.toLowerCase().includes(token)) score += 3;
  });

  return score;
}

export function handleGetGitHubCourseContent(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): GitHubCourseDocument[] {
  const githubData = store.getGitHubCourseData();
  if (!githubData || githubData.documents.length === 0) {
    return [];
  }

  const requestedCourseCode = asTrimmedString(args.courseCode)?.toUpperCase();
  const query = asTrimmedString(args.query);
  const limit = clampNumber(args.limit, 5, 1, 10);
  const queryTokens = query ? normalizeSearchTokens(query) : [];

  const filteredByCourse = githubData.documents.filter((doc) => {
    if (!requestedCourseCode) {
      return true;
    }
    return doc.courseCode.toUpperCase().includes(requestedCourseCode);
  });

  const scored = filteredByCourse
    .map((doc) => ({
      doc,
      score: scoreGitHubCourseDocument(doc, queryTokens)
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return new Date(right.doc.syncedAt).getTime() - new Date(left.doc.syncedAt).getTime();
    })
    .map((item) => item.doc);

  return scored.slice(0, limit);
}

function toPendingActionResponse(action: ChatPendingAction, message: string): PendingActionToolResponse {
  return {
    requiresConfirmation: true,
    pendingAction: action,
    confirmationCommand: `confirm ${action.id}`,
    cancelCommand: `cancel ${action.id}`,
    message
  };
}

export function handleQueueDeadlineAction(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const deadlineId = asTrimmedString(args.deadlineId);
  const action = asTrimmedString(args.action)?.toLowerCase();

  if (!deadlineId || !action) {
    return { error: "deadlineId and action are required." };
  }

  const deadline = store.getDeadlineById(deadlineId, false);
  if (!deadline) {
    return { error: `Deadline not found: ${deadlineId}` };
  }

  if (action !== "complete" && action !== "snooze") {
    return { error: "Unsupported deadline action. Use complete or snooze." };
  }

  if (action === "complete") {
    const pending = store.createPendingChatAction({
      actionType: "complete-deadline",
      summary: `Mark ${deadline.course} ${deadline.task} as completed`,
      payload: {
        deadlineId: deadline.id
      }
    });

    return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
  }

  const snoozeHours = clampNumber(args.snoozeHours, 24, 1, 168);
  const pending = store.createPendingChatAction({
    actionType: "snooze-deadline",
    summary: `Snooze ${deadline.course} ${deadline.task} by ${snoozeHours} hours`,
    payload: {
      deadlineId: deadline.id,
      snoozeHours
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleQueueScheduleBlock(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): PendingActionToolResponse | { error: string } {
  const title = asTrimmedString(args.title);
  const startTime = asTrimmedString(args.startTime);
  const workloadRaw = asTrimmedString(args.workload)?.toLowerCase();
  const durationMinutes = clampNumber(args.durationMinutes, 60, 15, 240);

  if (!title || !startTime) {
    return { error: "title and startTime are required." };
  }

  const startDate = new Date(startTime);
  if (Number.isNaN(startDate.getTime())) {
    return { error: "startTime must be a valid ISO datetime." };
  }

  const workload: LectureEvent["workload"] =
    workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

  const pending = store.createPendingChatAction({
    actionType: "create-schedule-block",
    summary: `Create schedule block "${title}" at ${startDate.toISOString()} (${durationMinutes} min)`,
    payload: {
      title,
      startTime: startDate.toISOString(),
      durationMinutes,
      workload
    }
  });

  return toPendingActionResponse(pending, "Action queued. Ask user for explicit confirmation before executing.");
}

export function handleCreateJournalEntry(
  store: RuntimeStore,
  args: Record<string, unknown> = {}
): { success: true; entry: JournalEntry; message: string } | { error: string } {
  const content = asTrimmedString(args.content);

  if (!content) {
    return { error: "content is required." };
  }

  const entry = store.recordJournalEntry(content);
  return {
    success: true,
    entry,
    message: "Journal entry saved."
  };
}

export function executePendingChatAction(
  pendingAction: ChatPendingAction,
  store: RuntimeStore
): PendingActionExecutionResult {
  switch (pendingAction.actionType) {
    case "complete-deadline": {
      const deadlineId = asTrimmedString(pendingAction.payload.deadlineId);
      if (!deadlineId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid deadline action payload."
        };
      }

      const updated = store.updateDeadline(deadlineId, { completed: true });
      if (!updated) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline not found for completion."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Marked ${updated.course} ${updated.task} as completed.`,
        deadline: updated
      };
    }
    case "snooze-deadline": {
      const deadlineId = asTrimmedString(pendingAction.payload.deadlineId);
      if (!deadlineId) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid snooze action payload."
        };
      }

      const existing = store.getDeadlineById(deadlineId, false);
      if (!existing) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline not found for snooze."
        };
      }

      const dueDate = new Date(existing.dueDate);
      if (Number.isNaN(dueDate.getTime())) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Deadline due date is invalid."
        };
      }

      const snoozeHours = clampNumber(pendingAction.payload.snoozeHours, 24, 1, 168);
      dueDate.setHours(dueDate.getHours() + snoozeHours);
      const updated = store.updateDeadline(deadlineId, { dueDate: dueDate.toISOString() });

      if (!updated) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Unable to snooze deadline."
        };
      }

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Snoozed ${updated.course} ${updated.task} by ${snoozeHours} hours.`,
        deadline: updated
      };
    }
    case "create-schedule-block": {
      const title = asTrimmedString(pendingAction.payload.title);
      const startTime = asTrimmedString(pendingAction.payload.startTime);
      if (!title || !startTime) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Invalid schedule block payload."
        };
      }

      const startDate = new Date(startTime);
      if (Number.isNaN(startDate.getTime())) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Schedule block start time is invalid."
        };
      }

      const durationMinutes = clampNumber(pendingAction.payload.durationMinutes, 60, 15, 240);
      const workloadRaw = asTrimmedString(pendingAction.payload.workload)?.toLowerCase();
      const workload: LectureEvent["workload"] =
        workloadRaw === "low" || workloadRaw === "medium" || workloadRaw === "high" ? workloadRaw : "medium";

      const lecture = store.createLectureEvent({
        title,
        startTime: startDate.toISOString(),
        durationMinutes,
        workload
      });

      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: `Created schedule block "${lecture.title}".`,
        lecture
      };
    }
    case "create-journal-draft": {
      const content = asTrimmedString(pendingAction.payload.content);
      if (!content) {
        return {
          actionId: pendingAction.id,
          actionType: pendingAction.actionType,
          success: false,
          message: "Journal draft content is missing."
        };
      }

      const journal = store.recordJournalEntry(content);
      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: true,
        message: "Saved journal draft entry.",
        journal
      };
    }
    default:
      return {
        actionId: pendingAction.id,
        actionType: pendingAction.actionType,
        success: false,
        message: "Unsupported pending action type."
      };
  }
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
    case "getHabitsGoalsStatus":
      response = handleGetHabitsGoalsStatus(store);
      break;
    case "updateHabitCheckIn":
      response = handleUpdateHabitCheckIn(store, args);
      break;
    case "updateGoalCheckIn":
      response = handleUpdateGoalCheckIn(store, args);
      break;
    case "getGitHubCourseContent":
      response = handleGetGitHubCourseContent(store, args);
      break;
    case "queueDeadlineAction":
      response = handleQueueDeadlineAction(store, args);
      break;
    case "queueScheduleBlock":
      response = handleQueueScheduleBlock(store, args);
      break;
    case "createJournalEntry":
      response = handleCreateJournalEntry(store, args);
      break;
    default:
      throw new Error(`Unknown function: ${name}`);
  }

  return { name, response };
}
