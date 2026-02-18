import { config } from "./config.js";
import {
  GeminiClient,
  GeminiError,
  RateLimitError,
  GeminiMessage,
  buildContextWindow,
  getGeminiClient
} from "./gemini.js";
import { Part } from "@google/generative-ai";
import { functionDeclarations, executeFunctionCall, executePendingChatAction } from "./gemini-tools.js";
import { generateContentRecommendations } from "./content-recommendations.js";
import { RuntimeStore } from "./store.js";
import {
  ChatCitation,
  ChatHistoryPage,
  ChatImageAttachment,
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

function buildContentRecommendationSummary(store: RuntimeStore, now: Date = new Date()): string {
  const result = generateContentRecommendations(
    store.getAcademicDeadlines(now),
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

function buildNutritionContextSummary(store: RuntimeStore, now: Date = new Date()): string {
  const summary = store.getNutritionDailySummary(now);
  if (summary.mealsLogged === 0) {
    return "Nutrition: no meals logged for today yet.";
  }

  const parts: string[] = [
    `**Nutrition today:** ${summary.totals.calories} kcal, ${summary.totals.proteinGrams}g protein, ${summary.totals.carbsGrams}g carbs, ${summary.totals.fatGrams}g fat`
  ];

  if (summary.meals.length > 0) {
    parts.push("");
    parts.push("**Recent meals:**");
    summary.meals.slice(0, 4).forEach((meal) => {
      parts.push(`- ${meal.name}: ${meal.calories} kcal (${meal.proteinGrams}P/${meal.carbsGrams}C/${meal.fatGrams}F)`);
    });
  }

  return parts.join("\n");
}

function buildGitHubCourseContextSummary(store: RuntimeStore): string {
  const githubData = store.getGitHubCourseData();

  if (!githubData || githubData.documents.length === 0) {
    return "GitHub course materials: no syllabus/course-info docs synced yet.";
  }

  const parts = ["**GitHub Course Materials:**"];
  githubData.documents.slice(0, 4).forEach((doc) => {
    const label = `${doc.courseCode} ${doc.title}`.trim();
    const summary = doc.summary.length > 140 ? `${doc.summary.slice(0, 140)}...` : doc.summary;
    parts.push(`- ${label} (${doc.owner}/${doc.repo}/${doc.path}): ${summary}`);
  });

  if (githubData.documents.length > 4) {
    parts.push(`- +${githubData.documents.length - 4} more course docs`);
  }

  return parts.join("\n");
}

export function buildChatContext(store: RuntimeStore, now: Date = new Date(), historyLimit = 10): ChatContextResult {
  const todaySchedule = store
    .getScheduleEvents()
    .filter((event) => isSameDay(new Date(event.startTime), now));

  const upcomingDeadlines = store
    .getAcademicDeadlines(now)
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
  const recommendationContext = buildContentRecommendationSummary(store, now);
  const githubCourseContext = buildGitHubCourseContextSummary(store);
  const nutritionContext = buildNutritionContextSummary(store, now);

  const contextWindow = buildContextWindow({
    todaySchedule,
    upcomingDeadlines,
    recentJournals,
    userState,
    customContext: [
      canvasContext,
      gmailContext,
      recommendationContext,
      githubCourseContext,
      nutritionContext
    ]
      .filter((section) => section.length > 0)
      .join("\n\n")
  });

  const history = store.getRecentChatMessages(historyLimit);

  return { contextWindow, history };
}

function parseImageDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    return null;
  }

  const mimeType = match[1];
  const base64 = match[2].replace(/\s+/g, "");
  if (!mimeType || !base64) {
    return null;
  }

  return { mimeType, base64 };
}

function toGeminiMessages(
  history: ChatMessage[],
  userInput: string,
  attachments: ChatImageAttachment[] = []
): GeminiMessage[] {
  const formatted: GeminiMessage[] = history.map((message) => {
    const parts: Part[] = [];

    if (message.content.trim().length > 0) {
      parts.push({ text: message.content });
    }

    const messageAttachments = message.metadata?.attachments ?? [];
    if (messageAttachments.length > 0) {
      parts.push({ text: `[Attached ${messageAttachments.length} image(s)]` });
    }

    if (parts.length === 0) {
      parts.push({ text: " " });
    }

    return {
      role: message.role === "assistant" ? "model" : "user",
      parts
    };
  });

  const userParts: Part[] = [];
  if (userInput.trim().length > 0) {
    userParts.push({ text: userInput });
  } else {
    userParts.push({ text: "[User sent image attachment(s)]" });
  }

  attachments.forEach((attachment) => {
    const parsed = parseImageDataUrl(attachment.dataUrl);
    if (!parsed) {
      return;
    }
    userParts.push({
      inlineData: {
        mimeType: parsed.mimeType,
        data: parsed.base64
      }
    });
  });

  formatted.push({
    role: "user" as const,
    parts: userParts
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

const ACTION_ID_REGEX = /\baction-[a-zA-Z0-9_-]+\b/i;
const AFFIRMATIVE_ACTION_REGEX = /^(yes|yep|yeah|sure|ok|okay|go ahead|do it|please do|save it|sounds good)\b/i;
const NEGATIVE_ACTION_REGEX = /^(no|nope|cancel|stop|do not|don't|never mind|not now)\b/i;

function isAffirmativeActionReply(input: string): boolean {
  return AFFIRMATIVE_ACTION_REGEX.test(input.trim());
}

function isNegativeActionReply(input: string): boolean {
  return NEGATIVE_ACTION_REGEX.test(input.trim());
}

function isImplicitActionSignal(input: string): boolean {
  const normalized = input.trim();
  if (!normalized) {
    return false;
  }
  return (
    /\b(confirm|cancel)\b/i.test(normalized) ||
    isAffirmativeActionReply(normalized) ||
    isNegativeActionReply(normalized)
  );
}

function parseActionCommand(input: string, pendingActions: ChatPendingAction[]): ParsedActionCommand | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const explicitMatch = trimmed.match(/^(confirm|cancel)\s+([a-zA-Z0-9_-]+)$/i);
  if (explicitMatch) {
    return {
      type: explicitMatch[1].toLowerCase() as ParsedActionCommand["type"],
      actionId: explicitMatch[2]
    };
  }

  // If user says just "confirm"/"cancel" and there is exactly one pending action, apply to that action.
  const bareVerbMatch = trimmed.match(/^(confirm|cancel)$/i);
  if (bareVerbMatch && pendingActions.length === 1) {
    return {
      type: bareVerbMatch[1].toLowerCase() as ParsedActionCommand["type"],
      actionId: pendingActions[0].id
    };
  }

  const actionIdMatch = trimmed.match(ACTION_ID_REGEX);
  const actionId = actionIdMatch?.[0];
  if (actionId) {
    if (/\bcancel\b/i.test(trimmed)) {
      return { type: "cancel", actionId };
    }
    if (/\bconfirm\b/i.test(trimmed)) {
      return { type: "confirm", actionId };
    }

    const pendingAction = pendingActions.find((action) => action.id === actionId);
    if (pendingAction) {
      return { type: "confirm", actionId };
    }
  }

  if (pendingActions.length === 1) {
    if (isAffirmativeActionReply(trimmed)) {
      return { type: "confirm", actionId: pendingActions[0].id };
    }
    if (isNegativeActionReply(trimmed)) {
      return { type: "cancel", actionId: pendingActions[0].id };
    }

    if (trimmed === pendingActions[0].id) {
      return { type: "confirm", actionId: pendingActions[0].id };
    }
  }

  return null;
}

interface HabitGoalAutocaptureSuggestion {
  actionType: "create-habit" | "update-habit" | "create-goal" | "update-goal";
  summary: string;
  payload: Record<string, unknown>;
  rationale: string;
  prompt: string;
}

const COMMITMENT_CUE_REGEX =
  /\b(i (?:keep|always|often|usually)\s+(?:missing|miss|skipping|skip|forgetting|forget)|i (?:want|need|plan|will|should|wish)(?:\s+to)?|i(?:'d| would) like to)\b/i;
const EXPLICIT_HABIT_GOAL_REQUEST_REGEX =
  /\b(create|delete|remove|check[\s-]?in|mark|status|progress|list|show|what|how)\b/i;
const HABIT_FOCUS_REGEX =
  /\b(habit|routine|daily|nightly|morning|evening|streak|consistent|consistently|keep missing|keep skipping)\b/i;
const GOAL_FOCUS_REGEX =
  /\b(goal|finish|complete|submit|deliver|assignment|exam|project|report|deadline|by\b|before\b)\b/i;

function toCommitmentTokens(value: string): string[] {
  const stopwords = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "have",
    "from",
    "into",
    "want",
    "need",
    "keep",
    "miss",
    "missing",
    "skip",
    "skipping",
    "should",
    "will",
    "plan",
    "would",
    "like",
    "every",
    "daily",
    "nightly"
  ]);

  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopwords.has(token));
}

function extractCommitmentPhrase(input: string): string | null {
  const matchers = [
    /\bi (?:keep|always|often|usually)\s+(?:missing|miss|skipping|skip|forgetting|forget)\s+([^.!?\n]{3,100})/i,
    /\bi (?:want|need|plan|will|should|wish)(?:\s+to)?\s+([^.!?\n]{3,100})/i,
    /\bi(?:'d| would) like to\s+([^.!?\n]{3,100})/i
  ];

  for (const matcher of matchers) {
    const match = input.match(matcher);
    if (!match?.[1]) {
      continue;
    }
    return match[1];
  }

  return null;
}

function normalizeCommitmentLabel(rawPhrase: string): string | null {
  const cleaned = rawPhrase
    .replace(/\b(please|thanks|thank you)\b/gi, " ")
    .replace(/[.?!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length < 3) {
    return null;
  }

  const normalized = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return normalized.slice(0, 80);
}

function countCommitmentMentions(messages: string[], tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }

  return messages.reduce((count, message) => {
    const normalized = message.toLowerCase();
    if (!COMMITMENT_CUE_REGEX.test(normalized)) {
      return count;
    }
    const tokenHits = tokens.filter((token) => normalized.includes(token)).length;
    return tokenHits > 0 ? count + 1 : count;
  }, 0);
}

function findBestNameMatch<T extends { id: string }>(
  records: T[],
  textAccessor: (record: T) => string,
  tokens: string[]
): T | null {
  if (records.length === 0 || tokens.length === 0) {
    return null;
  }

  const scored = records
    .map((record) => {
      const candidate = textAccessor(record).toLowerCase();
      const score = tokens.filter((token) => candidate.includes(token)).length;
      return { record, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0].score > 0 ? scored[0].record : null;
}

function detectHabitGoalAutocaptureSuggestion(
  store: RuntimeStore,
  userInput: string,
  history: ChatMessage[],
  pendingActions: ChatPendingAction[]
): HabitGoalAutocaptureSuggestion | null {
  const input = userInput.trim();
  if (!input || input.length < 8) {
    return null;
  }
  if (pendingActions.length > 0) {
    return null;
  }
  if (input.includes("?")) {
    return null;
  }
  if (EXPLICIT_HABIT_GOAL_REQUEST_REGEX.test(input)) {
    return null;
  }
  if (!COMMITMENT_CUE_REGEX.test(input)) {
    return null;
  }

  const rawPhrase = extractCommitmentPhrase(input);
  if (!rawPhrase) {
    return null;
  }
  const label = normalizeCommitmentLabel(rawPhrase);
  if (!label) {
    return null;
  }

  const tokens = toCommitmentTokens(label);
  if (tokens.length === 0) {
    return null;
  }

  const recentUserMessages = history
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => message.content);
  const mentionCount = countCommitmentMentions([...recentUserMessages, input], tokens);
  if (mentionCount < 2) {
    return null;
  }

  const struggleSignal = /\b(keep|always|often|usually).*(missing|miss|skipping|skip|forgetting|forget)|\bstruggl/i.test(
    input.toLowerCase()
  );
  const habitFocused = HABIT_FOCUS_REGEX.test(input);
  const goalFocused = GOAL_FOCUS_REGEX.test(input);
  const treatAsGoal = goalFocused && !habitFocused;
  const rationale = `You expressed this commitment ${mentionCount} times recently, so I can turn it into trackable follow-through.`;

  if (!treatAsGoal) {
    const existingHabit = findBestNameMatch(
      store.getHabitsWithStatus(),
      (habit) => habit.name,
      tokens
    );

    if (existingHabit) {
      const nextTargetPerWeek = struggleSignal
        ? Math.max(1, existingHabit.targetPerWeek - 1)
        : existingHabit.targetPerWeek;
      const shouldAdjustTarget = nextTargetPerWeek !== existingHabit.targetPerWeek;
      const payload: Record<string, unknown> = {
        habitId: existingHabit.id,
        motivation: label
      };
      if (shouldAdjustTarget) {
        payload.targetPerWeek = nextTargetPerWeek;
      }

      return {
        actionType: "update-habit",
        summary: shouldAdjustTarget
          ? `Adjust habit "${existingHabit.name}" to ${nextTargetPerWeek}/week`
          : `Update habit "${existingHabit.name}" motivation`,
        payload,
        rationale,
        prompt: shouldAdjustTarget
          ? `I can adjust **${existingHabit.name}** to ${nextTargetPerWeek}/week so it is easier to stay consistent.`
          : `I can keep **${existingHabit.name}** and update its motivation from what you just said.`
      };
    }

    const cadence = /\b(weekly|week)\b/i.test(input) ? "weekly" : "daily";
    const targetPerWeek = cadence === "daily" ? 5 : 3;
    return {
      actionType: "create-habit",
      summary: `Create habit "${label}" (${cadence}, ${targetPerWeek}/week)`,
      payload: {
        name: label,
        cadence,
        targetPerWeek,
        motivation: label
      },
      rationale,
      prompt: `I can create a new habit **${label}** (${cadence}, ${targetPerWeek}/week) and track it from today.`
    };
  }

  const existingGoal = findBestNameMatch(
    store.getGoalsWithStatus(),
    (goal) => goal.title,
    tokens
  );

  if (existingGoal) {
    const nextTargetCount = struggleSignal
      ? Math.max(1, existingGoal.targetCount - 1)
      : existingGoal.targetCount;
    const shouldAdjustTarget = nextTargetCount !== existingGoal.targetCount;
    const payload: Record<string, unknown> = {
      goalId: existingGoal.id,
      motivation: label
    };
    if (shouldAdjustTarget) {
      payload.targetCount = nextTargetCount;
    }

    return {
      actionType: "update-goal",
      summary: shouldAdjustTarget
        ? `Adjust goal "${existingGoal.title}" to ${nextTargetCount} check-ins`
        : `Update goal "${existingGoal.title}" motivation`,
      payload,
      rationale,
      prompt: shouldAdjustTarget
        ? `I can adjust **${existingGoal.title}** to ${nextTargetCount} check-ins so it is more realistic right now.`
        : `I can keep **${existingGoal.title}** and refresh its motivation based on your commitment.`
    };
  }

  const cadence = /\b(daily|every day)\b/i.test(input) ? "daily" : "weekly";
  const targetCount = cadence === "daily" ? 7 : 5;
  return {
    actionType: "create-goal",
    summary: `Create goal "${label}" (${targetCount} check-ins)`,
    payload: {
      title: label,
      cadence,
      targetCount,
      motivation: label,
      dueDate: null
    },
    rationale,
    prompt: `I can create a goal **${label}** (${targetCount} check-ins) so we can track progress clearly.`
  };
}

function buildFunctionCallingSystemInstruction(userName: string): string {
  return `You are Companion, a personal AI assistant for ${userName}, a university student at UiS (University of Stavanger).

Core behavior:
- For factual questions about schedule, deadlines, journal, email, social updates, or GitHub course materials, use tools before answering.
- For habits and goals questions, call getHabitsGoalsStatus first. For create/delete requests, use createHabit/deleteHabit/createGoal/deleteGoal. For check-ins, use updateHabitCheckIn/updateGoalCheckIn.
- For nutrition requests, use nutrition tools and focus on macro tracking only: calories, protein, carbs, and fat.
- Do not hallucinate user-specific data. If data is unavailable, say so explicitly and suggest the next sync step.
- For email follow-ups like "what did it contain?" after inbox discussion, call getEmails again and answer from sender/subject/snippet.
- For mutating requests that change schedule/deadlines, use queue* action tools and require explicit user confirmation.
- For journal-save requests, call createJournalEntry directly and do not ask for confirm/cancel commands.
- If a tool call is needed, emit tool calls only first and wait to write user-facing text until tool results are available.
- Keep replies practical and conversational, and adapt response length to user intent:
  - be brief for quick operational questions
  - be fuller and reflective when the user wants to talk things through
- For emotional or personal check-ins, respond with empathy first, then offer one helpful next question or step.
- Mention priority only when it is high or critical. Do not explicitly call out medium priority unless the user asks.
- Use only lightweight Markdown that the chat UI supports:
  - **bold** for key facts and warnings
  - *italic* for gentle emphasis
  - '-' or '*' bullet lists for schedules and checklists
  - plain paragraphs separated by blank lines
- Do not use HTML, tables, headings (#), blockquotes, or code fences.
- If multiple intents are present, choose the smallest useful set of tools and then synthesize one clear answer.
- Tool routing is model-driven: decide what tools to call based on the user request and tool descriptions.`;
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
  response.slice(0, 8).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const course = asNonEmptyString(record.course) ?? "Course";
    const task = asNonEmptyString(record.task) ?? "Task";
    const dueDate = asNonEmptyString(record.dueDate) ?? "unknown due date";
    lines.push(`- ${course}: ${textSnippet(task, 90)} (due ${dueDate})`);
  });
  if (response.length > 8) {
    lines.push(`- +${response.length - 8} more`);
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
    const from = asNonEmptyString(record.from);
    const snippet = asNonEmptyString(record.snippet);
    const receivedAt = asNonEmptyString(record.receivedAt) ?? asNonEmptyString(record.generatedAt);
    const readSuffix = record.isRead === false ? " [unread]" : "";

    lines.push(`- ${textSnippet(subject, 100)}${from ? ` — ${textSnippet(from, 70)}` : ""}${readSuffix}`);
    if (snippet) {
      lines.push(`  ${textSnippet(snippet, 160)}`);
    }
    if (receivedAt) {
      lines.push(`  Received: ${receivedAt}`);
    }
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

function buildJournalCreateFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }

  const message = asNonEmptyString(payload.message) ?? "Journal entry saved.";
  const entry = asRecord(payload.entry);
  const content = asNonEmptyString(entry?.content);

  if (!content) {
    return message;
  }

  return `${message}\n- ${textSnippet(content, 110)}`;
}

function buildHabitsGoalsFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }

  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const goals = Array.isArray(payload.goals) ? payload.goals : [];
  const summary = asRecord(payload.summary);

  const habitsTotal = typeof summary?.habitsTotal === "number" ? summary.habitsTotal : habits.length;
  const habitsDone = typeof summary?.habitsCompletedToday === "number"
    ? summary.habitsCompletedToday
    : habits.filter((habit) => Boolean(asRecord(habit)?.todayCompleted)).length;
  const goalsTotal = typeof summary?.goalsTotal === "number" ? summary.goalsTotal : goals.length;
  const goalsDone = typeof summary?.goalsCompletedToday === "number"
    ? summary.goalsCompletedToday
    : goals.filter((goal) => Boolean(asRecord(goal)?.todayCompleted)).length;

  const lines: string[] = [
    `Habits & goals: ${habitsDone}/${habitsTotal} habits checked in, ${goalsDone}/${goalsTotal} goals logged today.`
  ];

  if (habits.length > 0) {
    const habitNames = habits
      .slice(0, 3)
      .map((habit) => asNonEmptyString(asRecord(habit)?.name))
      .filter((value): value is string => Boolean(value));
    if (habitNames.length > 0) {
      lines.push(`Habits: ${habitNames.join(", ")}${habits.length > 3 ? ", ..." : ""}`);
    }
  }

  if (goals.length > 0) {
    const goalNames = goals
      .slice(0, 3)
      .map((goal) => asNonEmptyString(asRecord(goal)?.title))
      .filter((value): value is string => Boolean(value));
    if (goalNames.length > 0) {
      lines.push(`Goals: ${goalNames.join(", ")}${goals.length > 3 ? ", ..." : ""}`);
    }
  }

  return lines.join("\n");
}

function buildHabitUpdateFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }
  if (typeof payload.error === "string") {
    return `Habit update failed: ${payload.error}`;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return null;
}

function buildGoalUpdateFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }
  if (typeof payload.error === "string") {
    return `Goal update failed: ${payload.error}`;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return null;
}

function buildNutritionSummaryFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }

  const totals = asRecord(payload.totals);
  const calories = typeof totals?.calories === "number" ? totals.calories : null;
  const protein = typeof totals?.proteinGrams === "number" ? totals.proteinGrams : null;
  const carbs = typeof totals?.carbsGrams === "number" ? totals.carbsGrams : null;
  const fat = typeof totals?.fatGrams === "number" ? totals.fatGrams : null;
  const mealsLogged = typeof payload.mealsLogged === "number" ? payload.mealsLogged : null;

  if (calories === null || protein === null || carbs === null || fat === null) {
    return null;
  }

  return `Nutrition today: ${calories} kcal, ${protein}g protein, ${carbs}g carbs, ${fat}g fat${mealsLogged !== null ? ` (${mealsLogged} meals)` : ""}.`;
}

function buildNutritionCustomFoodsFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }

  const foods = Array.isArray(payload.foods) ? payload.foods : [];
  if (foods.length === 0) {
    return "Custom foods: none found.";
  }

  const lines: string[] = [`Custom foods (${foods.length}):`];
  foods.slice(0, 4).forEach((value) => {
    const food = asRecord(value);
    if (!food) {
      return;
    }
    const name = asNonEmptyString(food.name) ?? "Custom food";
    const unitLabel = asNonEmptyString(food.unitLabel) ?? "serving";
    const calories = typeof food.caloriesPerUnit === "number" ? food.caloriesPerUnit : 0;
    lines.push(`- ${name}: ${calories} kcal/${unitLabel}`);
  });
  if (foods.length > 4) {
    lines.push(`- +${foods.length - 4} more`);
  }
  return lines.join("\n");
}

function buildNutritionMutationFallbackSection(response: unknown): string | null {
  const payload = asRecord(response);
  if (!payload) {
    return null;
  }
  if (typeof payload.error === "string") {
    return `Nutrition update failed: ${payload.error}`;
  }
  if (typeof payload.message === "string") {
    return payload.message;
  }
  return null;
}

function buildGitHubCourseFallbackSection(response: unknown): string | null {
  if (!Array.isArray(response)) {
    return null;
  }
  if (response.length === 0) {
    return "GitHub course materials: no matching syllabus/course-info documents found.";
  }

  const lines: string[] = [`GitHub course docs (${response.length}):`];
  response.slice(0, 3).forEach((value) => {
    const record = asRecord(value);
    if (!record) {
      return;
    }
    const courseCode = asNonEmptyString(record.courseCode) ?? "COURSE";
    const title = asNonEmptyString(record.title) ?? "Course document";
    const owner = asNonEmptyString(record.owner) ?? "owner";
    const repo = asNonEmptyString(record.repo) ?? "repo";
    const path = asNonEmptyString(record.path) ?? "path";
    const snippet = asNonEmptyString(record.snippet);
    lines.push(`- ${courseCode} ${title} (${owner}/${repo}/${path})`);
    if (snippet) {
      lines.push(`  ${textSnippet(snippet, 120)}`);
    }
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
      case "createJournalEntry":
        section = buildJournalCreateFallbackSection(result.rawResponse);
        break;
      case "getHabitsGoalsStatus":
        section = buildHabitsGoalsFallbackSection(result.rawResponse);
        break;
      case "updateHabitCheckIn":
        section = buildHabitUpdateFallbackSection(result.rawResponse);
        break;
      case "updateGoalCheckIn":
        section = buildGoalUpdateFallbackSection(result.rawResponse);
        break;
      case "createHabit":
      case "deleteHabit":
        section = buildHabitUpdateFallbackSection(result.rawResponse);
        break;
      case "createGoal":
      case "deleteGoal":
        section = buildGoalUpdateFallbackSection(result.rawResponse);
        break;
      case "getNutritionSummary":
        section = buildNutritionSummaryFallbackSection(result.rawResponse);
        break;
      case "getNutritionCustomFoods":
        section = buildNutritionCustomFoodsFallbackSection(result.rawResponse);
        break;
      case "logMeal":
      case "deleteMeal":
      case "createNutritionCustomFood":
      case "updateNutritionCustomFood":
      case "deleteNutritionCustomFood":
        section = buildNutritionMutationFallbackSection(result.rawResponse);
        break;
      case "getGitHubCourseContent":
        section = buildGitHubCourseFallbackSection(result.rawResponse);
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

const MAX_CHAT_CITATIONS = 16;
const FUNCTION_CALL_HISTORY_LIMIT = 12;
const TOOL_RESULT_ITEM_LIMIT = 12;
const DEADLINE_TOOL_RESULT_LIMIT = 24;
const TOOL_RESULT_TEXT_MAX_CHARS = 480;
const TOOL_RESULT_MAX_DEPTH = 5;

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
    deadlines: response.slice(0, DEADLINE_TOOL_RESULT_LIMIT).map((value) => {
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
    truncated: response.length > DEADLINE_TOOL_RESULT_LIMIT
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

function compactJournalCreateForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  const entry = asRecord(payload.entry);
  return {
    success: Boolean(payload.success),
    message: asNonEmptyString(payload.message) ?? null,
    entry: entry
      ? {
          id: asNonEmptyString(entry.id) ?? "",
          timestamp: asNonEmptyString(entry.timestamp) ?? null,
          contentSnippet: compactTextValue(asNonEmptyString(entry.content) ?? "", 180)
        }
      : null
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
        receivedAt: asNonEmptyString(record.receivedAt) ?? asNonEmptyString(record.generatedAt) ?? null,
        snippet: compactTextValue(asNonEmptyString(record.snippet) ?? "", 180),
        isRead: typeof record.isRead === "boolean" ? record.isRead : null
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

function compactHabitsGoalsForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  const habits = Array.isArray(payload.habits) ? payload.habits : [];
  const goals = Array.isArray(payload.goals) ? payload.goals : [];
  const summary = asRecord(payload.summary);

  return {
    summary: {
      habitsCompletedToday: typeof summary?.habitsCompletedToday === "number" ? summary.habitsCompletedToday : 0,
      habitsTotal: typeof summary?.habitsTotal === "number" ? summary.habitsTotal : habits.length,
      goalsCompletedToday: typeof summary?.goalsCompletedToday === "number" ? summary.goalsCompletedToday : 0,
      goalsTotal: typeof summary?.goalsTotal === "number" ? summary.goalsTotal : goals.length
    },
    habits: habits.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        name: compactTextValue(asNonEmptyString(record.name) ?? "", 80),
        todayCompleted: Boolean(record.todayCompleted),
        streak: typeof record.streak === "number" ? record.streak : 0,
        completionRate7d: typeof record.completionRate7d === "number" ? record.completionRate7d : 0
      };
    }),
    goals: goals.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      return {
        id: asNonEmptyString(record.id) ?? "",
        title: compactTextValue(asNonEmptyString(record.title) ?? "", 100),
        todayCompleted: Boolean(record.todayCompleted),
        progressCount: typeof record.progressCount === "number" ? record.progressCount : 0,
        targetCount: typeof record.targetCount === "number" ? record.targetCount : 0,
        remaining: typeof record.remaining === "number" ? record.remaining : 0
      };
    })
  };
}

function compactHabitUpdateForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  if (payload.error) {
    return {
      success: false,
      error: compactTextValue(payload.error, 180)
    };
  }

  const habit = asRecord(payload.habit);
  return {
    success: Boolean(payload.success),
    created: typeof payload.created === "boolean" ? payload.created : undefined,
    deleted: typeof payload.deleted === "boolean" ? payload.deleted : undefined,
    message: asNonEmptyString(payload.message) ?? null,
    habit: habit
      ? {
          id: asNonEmptyString(habit.id) ?? "",
          name: compactTextValue(asNonEmptyString(habit.name) ?? "", 80),
          todayCompleted: Boolean(habit.todayCompleted),
          streak: typeof habit.streak === "number" ? habit.streak : 0,
          completionRate7d: typeof habit.completionRate7d === "number" ? habit.completionRate7d : 0
        }
      : null
  };
}

function compactGoalUpdateForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  if (payload.error) {
    return {
      success: false,
      error: compactTextValue(payload.error, 180)
    };
  }

  const goal = asRecord(payload.goal);
  return {
    success: Boolean(payload.success),
    created: typeof payload.created === "boolean" ? payload.created : undefined,
    deleted: typeof payload.deleted === "boolean" ? payload.deleted : undefined,
    message: asNonEmptyString(payload.message) ?? null,
    goal: goal
      ? {
          id: asNonEmptyString(goal.id) ?? "",
          title: compactTextValue(asNonEmptyString(goal.title) ?? "", 100),
          todayCompleted: Boolean(goal.todayCompleted),
          progressCount: typeof goal.progressCount === "number" ? goal.progressCount : 0,
          targetCount: typeof goal.targetCount === "number" ? goal.targetCount : 0,
          remaining: typeof goal.remaining === "number" ? goal.remaining : 0
        }
      : null
  };
}

function compactNutritionSummaryForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  const totals = asRecord(payload.totals);
  const meals = Array.isArray(payload.meals) ? payload.meals : [];

  return {
    date: asNonEmptyString(payload.date) ?? null,
    totals: {
      calories: typeof totals?.calories === "number" ? totals.calories : 0,
      proteinGrams: typeof totals?.proteinGrams === "number" ? totals.proteinGrams : 0,
      carbsGrams: typeof totals?.carbsGrams === "number" ? totals.carbsGrams : 0,
      fatGrams: typeof totals?.fatGrams === "number" ? totals.fatGrams : 0
    },
    mealsLogged: typeof payload.mealsLogged === "number" ? payload.mealsLogged : meals.length,
    meals: meals.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const meal = asRecord(value);
      if (!meal) {
        return {};
      }
      return {
        id: asNonEmptyString(meal.id) ?? "",
        name: compactTextValue(asNonEmptyString(meal.name) ?? "", 100),
        mealType: asNonEmptyString(meal.mealType) ?? "other",
        consumedAt: asNonEmptyString(meal.consumedAt) ?? null,
        calories: typeof meal.calories === "number" ? meal.calories : 0,
        proteinGrams: typeof meal.proteinGrams === "number" ? meal.proteinGrams : 0,
        carbsGrams: typeof meal.carbsGrams === "number" ? meal.carbsGrams : 0,
        fatGrams: typeof meal.fatGrams === "number" ? meal.fatGrams : 0
      };
    }),
    mealsTruncated: meals.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactNutritionCustomFoodsForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  const foods = Array.isArray(payload.foods) ? payload.foods : [];
  return {
    total: typeof payload.total === "number" ? payload.total : foods.length,
    foods: foods.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const food = asRecord(value);
      if (!food) {
        return {};
      }
      return {
        id: asNonEmptyString(food.id) ?? "",
        name: compactTextValue(asNonEmptyString(food.name) ?? "", 100),
        unitLabel: asNonEmptyString(food.unitLabel) ?? "serving",
        caloriesPerUnit: typeof food.caloriesPerUnit === "number" ? food.caloriesPerUnit : 0,
        proteinGramsPerUnit: typeof food.proteinGramsPerUnit === "number" ? food.proteinGramsPerUnit : 0,
        carbsGramsPerUnit: typeof food.carbsGramsPerUnit === "number" ? food.carbsGramsPerUnit : 0,
        fatGramsPerUnit: typeof food.fatGramsPerUnit === "number" ? food.fatGramsPerUnit : 0
      };
    }),
    truncated: foods.length > TOOL_RESULT_ITEM_LIMIT
  };
}

function compactNutritionMutationForModel(response: unknown): unknown {
  const payload = asRecord(response);
  if (!payload) {
    return compactGenericValue(response);
  }

  if (payload.error) {
    return {
      success: false,
      error: compactTextValue(payload.error, 180)
    };
  }

  const meal = asRecord(payload.meal);
  const block = asRecord(payload.block);
  const food = asRecord(payload.food);
  return {
    success: Boolean(payload.success),
    created: typeof payload.created === "boolean" ? payload.created : undefined,
    deleted: typeof payload.deleted === "boolean" ? payload.deleted : undefined,
    message: asNonEmptyString(payload.message) ?? null,
    meal: meal
      ? {
          id: asNonEmptyString(meal.id) ?? "",
          name: compactTextValue(asNonEmptyString(meal.name) ?? "", 100),
          consumedAt: asNonEmptyString(meal.consumedAt) ?? null
        }
      : null,
    block: block
      ? {
          id: asNonEmptyString(block.id) ?? "",
          title: compactTextValue(asNonEmptyString(block.title) ?? "", 100),
          scheduledFor: asNonEmptyString(block.scheduledFor) ?? null
        }
      : null,
    food: food
      ? {
          id: asNonEmptyString(food.id) ?? "",
          name: compactTextValue(asNonEmptyString(food.name) ?? "", 100),
          unitLabel: asNonEmptyString(food.unitLabel) ?? "serving"
        }
      : null
  };
}

function compactGitHubCourseContentForModel(response: unknown): unknown {
  if (!Array.isArray(response)) {
    return compactGenericValue(response);
  }

  return {
    total: response.length,
    documents: response.slice(0, TOOL_RESULT_ITEM_LIMIT).map((value) => {
      const record = asRecord(value);
      if (!record) {
        return {};
      }
      const owner = asNonEmptyString(record.owner) ?? "";
      const repo = asNonEmptyString(record.repo) ?? "";
      const path = asNonEmptyString(record.path) ?? "";
      return {
        id: asNonEmptyString(record.id) ?? "",
        courseCode: asNonEmptyString(record.courseCode) ?? "",
        title: compactTextValue(asNonEmptyString(record.title) ?? "", 100),
        source: `${owner}/${repo}/${path}`,
        summary: compactTextValue(asNonEmptyString(record.summary) ?? "", 200),
        snippet: compactTextValue(asNonEmptyString(record.snippet) ?? "", 220),
        url: asNonEmptyString(record.url) ?? null
      };
    }),
    truncated: response.length > TOOL_RESULT_ITEM_LIMIT
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
    case "createJournalEntry":
      return compactJournalCreateForModel(response);
    case "getEmails":
      return compactEmailsForModel(response);
    case "getSocialDigest":
      return compactSocialDigestForModel(response);
    case "getHabitsGoalsStatus":
      return compactHabitsGoalsForModel(response);
    case "updateHabitCheckIn":
      return compactHabitUpdateForModel(response);
    case "updateGoalCheckIn":
      return compactGoalUpdateForModel(response);
    case "createHabit":
    case "deleteHabit":
      return compactHabitUpdateForModel(response);
    case "createGoal":
    case "deleteGoal":
      return compactGoalUpdateForModel(response);
    case "getNutritionSummary":
      return compactNutritionSummaryForModel(response);
    case "getNutritionCustomFoods":
      return compactNutritionCustomFoodsForModel(response);
    case "logMeal":
    case "deleteMeal":
    case "createNutritionCustomFood":
    case "updateNutritionCustomFood":
    case "deleteNutritionCustomFood":
      return compactNutritionMutationForModel(response);
    case "getGitHubCourseContent":
      return compactGitHubCourseContentForModel(response);
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

  if (functionName === "createJournalEntry") {
    const payload = asRecord(response);
    const entry = asRecord(payload?.entry);
    const id = asNonEmptyString(entry?.id);
    const content = asNonEmptyString(entry?.content);
    const timestamp = asNonEmptyString(entry?.timestamp);

    if (!id || !content) {
      return [];
    }

    return [
      {
        id,
        type: "journal",
        label: textSnippet(content),
        timestamp: timestamp ?? undefined
      }
    ];
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
      const receivedAt = asNonEmptyString(record.receivedAt) ?? asNonEmptyString(record.generatedAt);
      if (!id || !subject) {
        return;
      }
      next.push({
        id,
        type: "email",
        label: textSnippet(subject),
        timestamp: receivedAt ?? undefined
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

  if (functionName === "getHabitsGoalsStatus") {
    const payload = asRecord(response);
    if (!payload) {
      return [];
    }

    const next: ChatCitation[] = [];
    const habits = Array.isArray(payload.habits) ? payload.habits : [];
    habits.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const name = asNonEmptyString(record.name);
      if (!id || !name) {
        return;
      }
      const streak = typeof record.streak === "number" ? ` (${record.streak} day streak)` : "";
      next.push({
        id,
        type: "habit",
        label: `${name}${streak}`
      });
    });

    const goals = Array.isArray(payload.goals) ? payload.goals : [];
    goals.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }
      const id = asNonEmptyString(record.id);
      const title = asNonEmptyString(record.title);
      if (!id || !title) {
        return;
      }
      const progressCount = typeof record.progressCount === "number" ? record.progressCount : null;
      const targetCount = typeof record.targetCount === "number" ? record.targetCount : null;
      const progressSuffix =
        progressCount !== null && targetCount !== null ? ` (${progressCount}/${targetCount})` : "";
      next.push({
        id,
        type: "goal",
        label: `${title}${progressSuffix}`
      });
    });

    return next;
  }

  if (functionName === "updateHabitCheckIn" || functionName === "createHabit") {
    const payload = asRecord(response);
    const habit = asRecord(payload?.habit);
    const id = asNonEmptyString(habit?.id);
    const name = asNonEmptyString(habit?.name);
    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        type: "habit",
        label: name
      }
    ];
  }

  if (functionName === "deleteHabit") {
    const payload = asRecord(response);
    const id = asNonEmptyString(payload?.habitId);
    const name = asNonEmptyString(payload?.habitName);
    if (!id || !name) {
      return [];
    }

    return [
      {
        id,
        type: "habit",
        label: name
      }
    ];
  }

  if (functionName === "updateGoalCheckIn" || functionName === "createGoal") {
    const payload = asRecord(response);
    const goal = asRecord(payload?.goal);
    const id = asNonEmptyString(goal?.id);
    const title = asNonEmptyString(goal?.title);
    if (!id || !title) {
      return [];
    }

    return [
      {
        id,
        type: "goal",
        label: title
      }
    ];
  }

  if (functionName === "deleteGoal") {
    const payload = asRecord(response);
    const id = asNonEmptyString(payload?.goalId);
    const title = asNonEmptyString(payload?.goalTitle);
    if (!id || !title) {
      return [];
    }

    return [
      {
        id,
        type: "goal",
        label: title
      }
    ];
  }

  if (functionName === "getNutritionSummary") {
    const payload = asRecord(response);
    if (!payload) {
      return [];
    }

    const next: ChatCitation[] = [];
    const meals = Array.isArray(payload.meals) ? payload.meals : [];
    meals.forEach((value) => {
      const meal = asRecord(value);
      if (!meal) {
        return;
      }
      const id = asNonEmptyString(meal.id);
      const name = asNonEmptyString(meal.name);
      const consumedAt = asNonEmptyString(meal.consumedAt);
      if (!id || !name) {
        return;
      }
      next.push({
        id,
        type: "nutrition-meal",
        label: name,
        timestamp: consumedAt ?? undefined
      });
    });

    return next;
  }

  if (functionName === "getNutritionCustomFoods") {
    const payload = asRecord(response);
    const foods = Array.isArray(payload?.foods) ? payload.foods : [];
    const next: ChatCitation[] = [];
    foods.forEach((value) => {
      const food = asRecord(value);
      if (!food) {
        return;
      }
      const id = asNonEmptyString(food.id);
      const name = asNonEmptyString(food.name);
      if (!id || !name) {
        return;
      }
      next.push({
        id,
        type: "nutrition-custom-food",
        label: name
      });
    });
    return next;
  }

  if (functionName === "logMeal") {
    const payload = asRecord(response);
    const meal = asRecord(payload?.meal);
    const id = asNonEmptyString(meal?.id);
    const name = asNonEmptyString(meal?.name);
    const consumedAt = asNonEmptyString(meal?.consumedAt);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        type: "nutrition-meal",
        label: name,
        timestamp: consumedAt ?? undefined
      }
    ];
  }

  if (functionName === "deleteMeal") {
    const payload = asRecord(response);
    const id = asNonEmptyString(payload?.mealId);
    const name = asNonEmptyString(payload?.mealName);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        type: "nutrition-meal",
        label: name
      }
    ];
  }

  if (functionName === "createNutritionCustomFood" || functionName === "updateNutritionCustomFood") {
    const payload = asRecord(response);
    const food = asRecord(payload?.food);
    const id = asNonEmptyString(food?.id);
    const name = asNonEmptyString(food?.name);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        type: "nutrition-custom-food",
        label: name
      }
    ];
  }

  if (functionName === "deleteNutritionCustomFood") {
    const payload = asRecord(response);
    const id = asNonEmptyString(payload?.customFoodId);
    const name = asNonEmptyString(payload?.customFoodName);
    if (!id || !name) {
      return [];
    }
    return [
      {
        id,
        type: "nutrition-custom-food",
        label: name
      }
    ];
  }

  if (functionName === "getGitHubCourseContent" && Array.isArray(response)) {
    const next: ChatCitation[] = [];
    response.forEach((value) => {
      const record = asRecord(value);
      if (!record) {
        return;
      }

      const id = asNonEmptyString(record.id);
      const courseCode = asNonEmptyString(record.courseCode);
      const title = asNonEmptyString(record.title);
      const owner = asNonEmptyString(record.owner);
      const repo = asNonEmptyString(record.repo);
      const path = asNonEmptyString(record.path);
      const url = asNonEmptyString(record.url);
      const snippet = asNonEmptyString(record.snippet);
      const syncedAt = asNonEmptyString(record.syncedAt);

      if (!id || !title || !owner || !repo || !path) {
        return;
      }

      const sourceRef = `${owner}/${repo}/${path}`;
      next.push({
        id,
        type: "github-course-doc",
        label: `${courseCode ?? "COURSE"} ${title} (${sourceRef})`,
        timestamp: syncedAt ?? undefined,
        metadata: {
          courseCode: courseCode ?? null,
          owner,
          repo,
          path,
          source: sourceRef,
          url: url ?? null,
          snippet: snippet ? textSnippet(snippet, 220) : null
        }
      });
    });
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

interface ChatUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

function usageFromGeminiResponse(
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } | undefined
): ChatUsage | undefined {
  if (!usageMetadata) {
    return undefined;
  }

  return {
    promptTokens: usageMetadata.promptTokenCount,
    responseTokens: usageMetadata.candidatesTokenCount,
    totalTokens: usageMetadata.totalTokenCount
  };
}

function addGeminiUsage(
  current: ChatUsage | undefined,
  usageMetadata: { promptTokenCount: number; candidatesTokenCount: number; totalTokenCount: number } | undefined
): ChatUsage | undefined {
  if (!usageMetadata) {
    return current;
  }

  if (!current) {
    return usageFromGeminiResponse(usageMetadata);
  }

  return {
    promptTokens: current.promptTokens + usageMetadata.promptTokenCount,
    responseTokens: current.responseTokens + usageMetadata.candidatesTokenCount,
    totalTokens: current.totalTokens + usageMetadata.totalTokenCount
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function normalizeChatSnippet(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength)}...`;
}

function truncateText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.length <= maxLength ? trimmed : `${trimmed.slice(0, maxLength - 3)}...`;
}

function buildCompressionTranscript(messages: ChatMessage[]): string {
  if (messages.length === 0) {
    return "(no messages)";
  }

  return messages
    .map((message) => {
      const roleLabel = message.role === "assistant" ? "assistant" : "user";
      return `[${message.timestamp}] ${roleLabel}: ${normalizeChatSnippet(message.content, 420)}`;
    })
    .join("\n");
}

function buildHeuristicContextCompression(messages: ChatMessage[], targetSummaryChars: number): string {
  if (messages.length === 0) {
    return "No chat context available yet.";
  }

  const recentUserPoints = messages
    .filter((message) => message.role === "user")
    .slice(-8)
    .map((message) => normalizeChatSnippet(message.content, 180))
    .filter((value) => value.length > 0);

  const recentAssistantPoints = messages
    .filter((message) => message.role === "assistant")
    .slice(-6)
    .map((message) => normalizeChatSnippet(message.content, 180))
    .filter((value) => value.length > 0);

  const lines: string[] = ["Compressed context snapshot:", "", "User focus:"];
  if (recentUserPoints.length === 0) {
    lines.push("- No explicit user requests captured.");
  } else {
    recentUserPoints.forEach((point) => lines.push(`- ${point}`));
  }

  lines.push("", "Recent assistant guidance:");
  if (recentAssistantPoints.length === 0) {
    lines.push("- No assistant responses captured.");
  } else {
    recentAssistantPoints.forEach((point) => lines.push(`- ${point}`));
  }

  const summary = lines.join("\n");
  return summary.length <= targetSummaryChars ? summary : `${summary.slice(0, targetSummaryChars - 3)}...`;
}

export interface CompressChatContextOptions {
  now?: Date;
  geminiClient?: GeminiClient;
  maxMessages?: number;
  preserveRecentMessages?: number;
  targetSummaryChars?: number;
}

export interface CompressChatContextResult {
  summary: string;
  sourceMessageCount: number;
  compressedMessageCount: number;
  preservedMessageCount: number;
  fromTimestamp?: string;
  toTimestamp?: string;
  usedModelMode: "live" | "standard" | "fallback";
}

export async function compressChatContext(
  store: RuntimeStore,
  options: CompressChatContextOptions = {}
): Promise<CompressChatContextResult> {
  const now = options.now ?? new Date();
  const maxMessages = clampNumber(options.maxMessages ?? 180, 10, 500);
  const preserveRecentMessages = clampNumber(options.preserveRecentMessages ?? 16, 0, 100);
  const targetSummaryChars = clampNumber(options.targetSummaryChars ?? 2800, 300, 12000);
  const allMessages = store.getRecentChatMessages(maxMessages);

  if (allMessages.length === 0) {
    return {
      summary: "No chat history available yet.",
      sourceMessageCount: 0,
      compressedMessageCount: 0,
      preservedMessageCount: 0,
      usedModelMode: "fallback"
    };
  }

  const compressionBoundary = Math.max(0, allMessages.length - preserveRecentMessages);
  const compressibleMessages = allMessages.slice(0, compressionBoundary);
  const preservedMessages = allMessages.slice(compressionBoundary);
  const summarySource = compressibleMessages.length > 0 ? compressibleMessages : allMessages;

  if (summarySource.length === 0) {
    return {
      summary: "No older context to compress yet.",
      sourceMessageCount: allMessages.length,
      compressedMessageCount: 0,
      preservedMessageCount: preservedMessages.length,
      usedModelMode: "fallback"
    };
  }

  const transcript = buildCompressionTranscript(summarySource);
  const pendingActions = store.getPendingChatActions(now).slice(0, 5);
  const pendingActionContext =
    pendingActions.length === 0
      ? "No pending explicit confirmation actions."
      : pendingActions
          .map((action) => `- ${action.summary} (id: ${action.id}, expires: ${action.expiresAt})`)
          .join("\n");

  const systemInstruction = [
    "You compress chat context for future model turns.",
    "Output plain text only.",
    "Write concise bullets that preserve only durable, user-specific facts.",
    "Keep concrete commitments, dates, deadlines, constraints, and preferences.",
    "Avoid fluff and avoid repeating conversational filler.",
    `Keep output under ${targetSummaryChars} characters.`
  ].join("\n");

  const userPrompt = [
    "Create a context compression summary with these exact sections:",
    "1) Active objectives",
    "2) Deadlines and dates",
    "3) Commitments and habits",
    "4) Preferences and constraints",
    "5) Open loops",
    "",
    "Rules:",
    "- Use '-' bullets under each section",
    "- If unknown, write '- none'",
    "- Keep it factual and actionable",
    "",
    "Pending actions:",
    pendingActionContext,
    "",
    "Conversation transcript to compress:",
    transcript
  ].join("\n");

  const gemini = options.geminiClient ?? getGeminiClient();
  let modelSummary: string | null = null;
  let usedModelMode: CompressChatContextResult["usedModelMode"] = "fallback";

  const maybeLiveClient = gemini as GeminiClient & {
    generateLiveChatResponse?: (request: {
      messages: GeminiMessage[];
      systemInstruction?: string;
      timeoutMs?: number;
    }) => Promise<{ text: string }>;
  };

  if (
    config.GEMINI_USE_LIVE_API &&
    config.GEMINI_LIVE_MODEL.toLowerCase().includes("live") &&
    typeof maybeLiveClient.generateLiveChatResponse === "function"
  ) {
    try {
      const liveResponse = await maybeLiveClient.generateLiveChatResponse({
        messages: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        systemInstruction
      });

      const liveText = truncateText(liveResponse.text ?? "", targetSummaryChars);
      if (liveText.length > 0) {
        modelSummary = liveText;
        usedModelMode = "live";
      }
    } catch {
      // Fall through to standard model path.
    }
  }

  if (!modelSummary) {
    try {
      const standardResponse = await gemini.generateChatResponse({
        messages: [
          {
            role: "user",
            parts: [{ text: userPrompt }]
          }
        ],
        systemInstruction
      });
      const standardText = truncateText(standardResponse.text ?? "", targetSummaryChars);
      if (standardText.length > 0) {
        modelSummary = standardText;
        usedModelMode = "standard";
      }
    } catch (error) {
      if (!(error instanceof GeminiError) && !(error instanceof RateLimitError)) {
        throw error;
      }
      modelSummary = null;
    }
  }

  const summary = modelSummary ?? buildHeuristicContextCompression(summarySource, targetSummaryChars);

  return {
    summary,
    sourceMessageCount: allMessages.length,
    compressedMessageCount: summarySource.length,
    preservedMessageCount: preservedMessages.length,
    fromTimestamp: summarySource[0]?.timestamp,
    toTimestamp: summarySource[summarySource.length - 1]?.timestamp,
    usedModelMode
  };
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

interface SendChatOptions {
  now?: Date;
  geminiClient?: GeminiClient;
  attachments?: ChatImageAttachment[];
  onTextChunk?: (chunk: string) => void;
}

function emitTextChunks(text: string, onTextChunk?: (chunk: string) => void): void {
  if (!onTextChunk || text.length === 0) {
    return;
  }

  const chunks = text.match(/.{1,32}/g) ?? [text];
  chunks.forEach((chunk) => {
    if (chunk.length > 0) {
      onTextChunk(chunk);
    }
  });
}

export async function sendChatMessage(
  store: RuntimeStore,
  userInput: string,
  options: SendChatOptions = {}
): Promise<SendChatResult> {
  const now = options.now ?? new Date();
  const attachments = (options.attachments ?? []).slice(0, 3);
  const userMetadata: ChatMessageMetadata | undefined =
    attachments.length > 0
      ? {
          attachments
        }
      : undefined;
  const pendingActionsAtStart = store.getPendingChatActions(now);
  const actionCommand = parseActionCommand(userInput, pendingActionsAtStart);

  if (!actionCommand && pendingActionsAtStart.length > 1 && isImplicitActionSignal(userInput)) {
    const userMessage = store.recordChatMessage("user", userInput, userMetadata);
    const lines = ["Multiple pending actions found. Please confirm with a specific action ID:"];
    pendingActionsAtStart.forEach((action) => {
      lines.push(`- ${action.summary}`);
      lines.push(`  Confirm: confirm ${action.id}`);
      lines.push(`  Cancel: cancel ${action.id}`);
    });

    const assistantMessage = store.recordChatMessage("assistant", lines.join("\n"), {
      contextWindow: "",
      pendingActions: pendingActionsAtStart
    });
    const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

    return {
      reply: assistantMessage.content,
      userMessage,
      assistantMessage,
      finishReason: "stop",
      citations: [],
      history: historyPage
    };
  }

  if (actionCommand) {
    const userMessage = store.recordChatMessage("user", userInput, userMetadata);
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

  const recentHistoryForIntent = store.getRecentChatMessages(FUNCTION_CALL_HISTORY_LIMIT);
  const habitGoalAutocapture = detectHabitGoalAutocaptureSuggestion(
    store,
    userInput,
    recentHistoryForIntent,
    pendingActionsAtStart
  );

  if (habitGoalAutocapture) {
    const userMessage = store.recordChatMessage("user", userInput, userMetadata);
    const pendingAction = store.createPendingChatAction({
      actionType: habitGoalAutocapture.actionType,
      summary: habitGoalAutocapture.summary,
      payload: {
        ...habitGoalAutocapture.payload,
        rationale: habitGoalAutocapture.rationale
      }
    });

    const assistantReply = [
      habitGoalAutocapture.prompt,
      `Why this suggestion: ${habitGoalAutocapture.rationale}`,
      "Use the Confirm/Cancel buttons below, or type:",
      `- confirm ${pendingAction.id}`,
      `- cancel ${pendingAction.id}`
    ].join("\n");
    const assistantMessage = store.recordChatMessage("assistant", assistantReply, {
      contextWindow: "",
      pendingActions: store.getPendingChatActions(now)
    });
    const historyPage = store.getChatHistory({ page: 1, pageSize: 20 });

    return {
      reply: assistantMessage.content,
      userMessage,
      assistantMessage,
      finishReason: "stop",
      citations: [],
      history: historyPage
    };
  }

  const gemini = options.geminiClient ?? getGeminiClient();
  const streamCapableGemini = gemini as GeminiClient & {
    generateChatResponseStream?: (request: {
      messages: GeminiMessage[];
      systemInstruction?: string;
      tools?: typeof functionDeclarations;
      onTextChunk?: (chunk: string) => void;
    }) => Promise<Awaited<ReturnType<GeminiClient["generateChatResponse"]>>>;
  };
  const useNativeStreaming =
    Boolean(options.onTextChunk) && typeof streamCapableGemini.generateChatResponseStream === "function";
  let streamedTokenChars = 0;
  const contextWindow = "";
  const history = recentHistoryForIntent;
  const systemInstruction = buildFunctionCallingSystemInstruction(config.USER_NAME);

  const messages = toGeminiMessages(history, userInput, attachments);
  const userMessage = store.recordChatMessage("user", userInput, userMetadata);
  let response: Awaited<ReturnType<GeminiClient["generateChatResponse"]>> | null = null;
  let totalUsage: ChatUsage | undefined = undefined;
  let pendingActionsFromTooling: ChatPendingAction[] = [];
  let executedFunctionResponses: ExecutedFunctionResponse[] = [];
  const citations = new Map<string, ChatCitation>();
  const maxFunctionRounds = 8;
  const workingMessages: GeminiMessage[] = [...messages];

  try {
    for (let round = 0; round < maxFunctionRounds; round += 1) {
      const roundResponse = useNativeStreaming
        ? await streamCapableGemini.generateChatResponseStream!({
            messages: workingMessages,
            systemInstruction,
            tools: functionDeclarations,
            onTextChunk: (chunk: string) => {
              if (chunk.length === 0) {
                return;
              }
              streamedTokenChars += chunk.length;
              options.onTextChunk?.(chunk);
            }
          })
        : await gemini.generateChatResponse({
            messages: workingMessages,
            systemInstruction,
            tools: functionDeclarations
          });
      totalUsage = addGeminiUsage(totalUsage, roundResponse.usageMetadata);

      const functionCalls = roundResponse.functionCalls ?? [];
      if (functionCalls.length === 0) {
        response = roundResponse;
        break;
      }

      const roundResponses = functionCalls.map((call, callIndex) => {
        const args =
          call.args && typeof call.args === "object" && !Array.isArray(call.args)
            ? (call.args as Record<string, unknown>)
            : {};
        const result = executeFunctionCall(call.name, args, store);
        const nextCitations = collectToolCitations(store, result.name, result.response);
        nextCitations.forEach((citation) => addCitation(citations, citation));
        return {
          id: `${round + 1}-${callIndex}`,
          name: result.name,
          rawResponse: result.response,
          modelResponse: compactFunctionResponseForModel(result.name, result.response)
        };
      });
      executedFunctionResponses = [...executedFunctionResponses, ...roundResponses];
      pendingActionsFromTooling = [
        ...pendingActionsFromTooling,
        ...roundResponses.flatMap((fnResp) => extractPendingActions(fnResp.rawResponse))
      ];

      workingMessages.push({
        role: "model",
        parts: functionCalls.map((call) => ({ functionCall: call })) as Part[]
      });
      workingMessages.push({
        role: "function",
        parts: roundResponses.map((responseEntry) => ({
          functionResponse: {
            name: responseEntry.name,
            response: responseEntry.modelResponse
          }
        })) as Part[]
      });
    }
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

  const finalReply = response && response.text.trim().length > 0
    ? response.text
    : executedFunctionResponses.length > 0
      ? buildToolDataFallbackReply(
          executedFunctionResponses,
          pendingActionsFromTooling,
          "I fetched your data:"
        )
      : buildPendingActionFallbackReply(pendingActionsFromTooling);

  if (!useNativeStreaming || streamedTokenChars === 0) {
    emitTextChunks(finalReply, options.onTextChunk);
  }

  const assistantMetadata: ChatMessageMetadata = {
    contextWindow,
    finishReason: response?.finishReason,
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
    finishReason: response?.finishReason,
    usage: assistantMetadata.usage,
    citations: assistantMetadata.citations ?? [],
    history: historyPage
  };
}

export { GeminiError, RateLimitError };
