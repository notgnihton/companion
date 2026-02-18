import { GeminiClient, getGeminiClient } from "./gemini.js";
import { maybeGenerateAnalyticsVisual } from "./growth-visuals.js";
import { RuntimeStore } from "./store.js";
import {
  AnalyticsCoachInsight,
  AnalyticsCoachMetrics,
  ChatMessage,
  Deadline,
  GoalWithStatus,
  HabitWithStatus,
  JournalEntry
} from "./types.js";
import { nowIso } from "./utils.js";

interface GenerateAnalyticsCoachOptions {
  periodDays?: number;
  now?: Date;
  geminiClient?: GeminiClient;
}

interface ParsedCoachInsight {
  summary: string;
  strengths: string[];
  risks: string[];
  recommendations: string[];
}

interface AnalyticsDataset {
  periodDays: 7 | 14 | 30;
  windowStart: string;
  windowEnd: string;
  metrics: AnalyticsCoachMetrics;
  deadlinesInWindow: Deadline[];
  openUrgentDeadlines: Deadline[];
  habits: HabitWithStatus[];
  goals: GoalWithStatus[];
  journals: JournalEntry[];
  reflections: ChatMessage[];
}

const SUPPORTED_PERIODS: Array<7 | 14 | 30> = [7, 14, 30];
const MAX_JOURNAL_SNIPPETS = 8;
const MAX_REFLECTION_SNIPPETS = 8;
const MAX_DEADLINE_SNIPPETS = 8;
const MAX_HABIT_SNIPPETS = 6;
const MAX_GOAL_SNIPPETS = 6;

function coercePeriodDays(value?: number): 7 | 14 | 30 {
  if (value === 14 || value === 30) {
    return value;
  }
  return 7;
}

function toIsoDate(date: Date): string {
  return date.toISOString();
}

function normalizeText(text: string, maxLength: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength)}...`;
}

function enforceSecondPersonVoice(text: string): string {
  return text
    .replace(/\bthis user\b/gi, "you")
    .replace(/\bthe user\b/gi, "you")
    .replace(/\buser['’]s\b/gi, "your")
    .replace(/\bthis student\b/gi, "you")
    .replace(/\bthe student\b/gi, "you")
    .replace(/\bstudent['’]s\b/gi, "your")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function toMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function inWindow(value: string, startMs: number, endMs: number): boolean {
  const ms = toMs(value);
  return ms !== null && ms >= startMs && ms <= endMs;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round((values.reduce((sum, current) => sum + current, 0) / values.length) * 10) / 10;
}

function uniqueTrimmed(items: string[], maxItems: number): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  items.forEach((item) => {
    const cleaned = normalizeText(item, 220);
    if (!cleaned || seen.has(cleaned.toLowerCase())) {
      return;
    }
    seen.add(cleaned.toLowerCase());
    normalized.push(cleaned);
  });

  return normalized.slice(0, maxItems);
}

function mergeListWithFallback(primary: string[], fallback: string[], min: number, max: number): string[] {
  const merged = uniqueTrimmed([...primary, ...fallback], max);
  if (merged.length >= min) {
    return merged.slice(0, max);
  }
  return uniqueTrimmed([...merged, ...fallback], max).slice(0, Math.max(min, merged.length));
}

function sortDeadlinesAscending(deadlines: Deadline[]): Deadline[] {
  return [...deadlines].sort((a, b) => {
    const aMs = toMs(a.dueDate) ?? Number.MAX_SAFE_INTEGER;
    const bMs = toMs(b.dueDate) ?? Number.MAX_SAFE_INTEGER;
    return aMs - bMs;
  });
}

function buildDataset(store: RuntimeStore, periodDays: 7 | 14 | 30, now: Date): AnalyticsDataset {
  const nowMs = now.getTime();
  const windowStartDate = new Date(nowMs - periodDays * 24 * 60 * 60 * 1000);
  const windowStartMs = windowStartDate.getTime();
  const windowStartIso = toIsoDate(windowStartDate);
  const windowEndIso = toIsoDate(now);
  const nextWeekMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  const deadlines = store.getAcademicDeadlines(now);
  const deadlinesInWindow = sortDeadlinesAscending(deadlines).filter((deadline) =>
    inWindow(deadline.dueDate, windowStartMs, nowMs)
  );
  const openUrgentDeadlines = sortDeadlinesAscending(deadlines).filter((deadline) => {
    if (deadline.completed || (deadline.priority !== "high" && deadline.priority !== "critical")) {
      return false;
    }
    const dueMs = toMs(deadline.dueDate);
    return dueMs !== null && dueMs >= nowMs && dueMs <= nextWeekMs;
  });

  const habits = store.getHabitsWithStatus();
  const goals = store.getGoalsWithStatus();

  const journals = store
    .getJournalEntries(220)
    .filter((entry) => inWindow(entry.timestamp, windowStartMs, nowMs))
    .slice(0, MAX_JOURNAL_SNIPPETS);

  const reflections = store
    .getRecentChatMessages(300)
    .filter(
      (message) =>
        message.role === "user" &&
        message.content.trim().length > 0 &&
        inWindow(message.timestamp, windowStartMs, nowMs)
    )
    .slice(-MAX_REFLECTION_SNIPPETS);

  const adherence = store.getStudyPlanAdherenceMetrics({
    windowStart: windowStartIso,
    windowEnd: windowEndIso
  });
  const trends = store.getContextTrends();

  const metrics: AnalyticsCoachMetrics = {
    deadlinesDue: deadlinesInWindow.length,
    deadlinesCompleted: deadlinesInWindow.filter((deadline) => deadline.completed).length,
    openHighPriorityDeadlines: openUrgentDeadlines.length,
    habitsTracked: habits.length,
    habitsCompletedToday: habits.filter((habit) => habit.todayCompleted).length,
    averageHabitCompletion7d: Math.round(average(habits.map((habit) => habit.completionRate7d))),
    goalsTracked: goals.length,
    goalsCompletedToday: goals.filter((goal) => goal.todayCompleted).length,
    journalEntries: journals.length,
    userReflections: reflections.length,
    studySessionsPlanned: adherence.sessionsPlanned,
    studySessionsDone: adherence.sessionsDone,
    studyCompletionRate: adherence.completionRate,
    dominantEnergy: trends.latestContext.energyLevel,
    dominantStress: trends.latestContext.stressLevel
  };

  return {
    periodDays,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    metrics,
    deadlinesInWindow,
    openUrgentDeadlines,
    habits,
    goals,
    journals,
    reflections
  };
}

function buildFallbackInsight(dataset: AnalyticsDataset): AnalyticsCoachInsight {
  const { metrics } = dataset;
  const strengths: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (metrics.deadlinesDue > 0) {
    strengths.push(
      `You completed ${metrics.deadlinesCompleted}/${metrics.deadlinesDue} deadlines in the last ${dataset.periodDays} days.`
    );
  }

  if (metrics.averageHabitCompletion7d >= 60 && metrics.habitsTracked > 0) {
    strengths.push(`Habit consistency is solid at ${metrics.averageHabitCompletion7d}% average 7-day completion.`);
  }

  if (metrics.studySessionsPlanned > 0 && metrics.studyCompletionRate >= 60) {
    strengths.push(
      `Study execution is stable with ${metrics.studySessionsDone}/${metrics.studySessionsPlanned} planned sessions completed.`
    );
  }

  if (metrics.goalsTracked > 0 && metrics.goalsCompletedToday > 0) {
    strengths.push(`You checked in on ${metrics.goalsCompletedToday} goal(s) today, showing active follow-through.`);
  }

  if (strengths.length === 0) {
    strengths.push("You have active data across coursework and habits, giving a good base for incremental improvement.");
  }

  if (metrics.openHighPriorityDeadlines > 0) {
    risks.push(`${metrics.openHighPriorityDeadlines} high-priority deadline(s) are due within the next week.`);
    recommendations.push("Reserve one deep-work block in the next 24 hours for the nearest high-priority deadline.");
  }

  if (metrics.habitsTracked > 0 && metrics.averageHabitCompletion7d < 50) {
    risks.push(`Habit consistency is low (${metrics.averageHabitCompletion7d}% over the last 7 days).`);
    recommendations.push("Attach your key habit check-in to a fixed anchor, like right after your first lecture.");
  }

  if (metrics.studySessionsPlanned > 0 && metrics.studyCompletionRate < 50) {
    risks.push(
      `Study-plan follow-through is low (${metrics.studySessionsDone}/${metrics.studySessionsPlanned} sessions completed).`
    );
    recommendations.push("Mark each study session as done/skipped immediately after it ends to keep plans realistic.");
  }

  if (metrics.journalEntries + metrics.userReflections < 3) {
    risks.push("Reflection volume is low, which weakens pattern detection and coaching quality.");
    recommendations.push("Add a two-line end-of-day reflection to make tomorrow's coaching more precise.");
  }

  if (metrics.goalsTracked > 0 && metrics.goalsCompletedToday === 0) {
    risks.push("Goals are active but not being checked in today.");
    recommendations.push("Pick one goal and complete a small measurable step before your next break.");
  }

  if (risks.length === 0) {
    risks.push("No severe risk pattern is currently dominant; main opportunity is tighter consistency.");
    recommendations.push("Keep momentum by planning tomorrow's top task tonight.");
  }

  const summary =
    metrics.deadlinesDue === 0 && metrics.habitsTracked === 0 && metrics.goalsTracked === 0
      ? `Not enough tracked activity in the last ${dataset.periodDays} days to infer strong patterns yet.`
      : `Over the last ${dataset.periodDays} days, you completed ${metrics.deadlinesCompleted}/${metrics.deadlinesDue} deadlines, maintained ${metrics.averageHabitCompletion7d}% average habit consistency, and finished ${metrics.studySessionsDone}/${metrics.studySessionsPlanned} planned study sessions.`;

  return {
    periodDays: dataset.periodDays,
    windowStart: dataset.windowStart,
    windowEnd: dataset.windowEnd,
    generatedAt: nowIso(),
    source: "fallback",
    summary: normalizeText(summary, 500),
    strengths: uniqueTrimmed(strengths, 5),
    risks: uniqueTrimmed(risks, 5),
    recommendations: mergeListWithFallback(recommendations, [
      "Define one non-negotiable study block for tomorrow before ending today.",
      "Do a quick habit and goal check-in before bed to preserve streak awareness.",
      "Prioritize tasks that are both urgent and high-impact before optional work."
    ], 3, 5),
    metrics
  };
}

function buildPrompt(dataset: AnalyticsDataset): string {
  const deadlineLines = dataset.deadlinesInWindow
    .slice(0, MAX_DEADLINE_SNIPPETS)
    .map((deadline) => {
      const status = deadline.completed ? "completed" : "open";
      return `- ${deadline.course}: ${normalizeText(deadline.task, 90)} | due=${deadline.dueDate} | priority=${deadline.priority} | ${status}`;
    })
    .join("\n");

  const urgentLines = dataset.openUrgentDeadlines
    .slice(0, MAX_DEADLINE_SNIPPETS)
    .map((deadline) => `- ${deadline.course}: ${normalizeText(deadline.task, 90)} | due=${deadline.dueDate}`)
    .join("\n");

  const habitLines = dataset.habits
    .slice(0, MAX_HABIT_SNIPPETS)
    .map(
      (habit) =>
        `- ${habit.name}: completion7d=${habit.completionRate7d}% streak=${habit.streak} today=${habit.todayCompleted ? "done" : "not-done"}`
    )
    .join("\n");

  const goalLines = dataset.goals
    .slice(0, MAX_GOAL_SNIPPETS)
    .map(
      (goal) =>
        `- ${goal.title}: progress=${goal.progressCount}/${goal.targetCount} remaining=${goal.remaining} today=${goal.todayCompleted ? "done" : "not-done"} due=${goal.dueDate ?? "none"}`
    )
    .join("\n");

  const journalLines = dataset.journals
    .map((entry) => `- [${entry.timestamp}] ${normalizeText(entry.content, 180)}`)
    .join("\n");

  const reflectionLines = dataset.reflections
    .map((message) => `- [${message.timestamp}] ${normalizeText(message.content, 180)}`)
    .join("\n");

  return `Analyze behavior patterns for the last ${dataset.periodDays} days.
Address Lucy directly in second person (you/your). Never refer to "the user" or "the student".

Return strict JSON only:
{
  "summary": "2-4 sentence narrative",
  "strengths": ["2-5 concise strengths"],
  "risks": ["2-5 concise risks"],
  "recommendations": ["3-5 concrete behavior recommendations"]
}

Rules:
- No markdown.
- No extra keys.
- Keep recommendations specific and immediately actionable.
- Prioritize habits, deadlines, and study-plan execution.

Metrics:
- deadlinesDue=${dataset.metrics.deadlinesDue}
- deadlinesCompleted=${dataset.metrics.deadlinesCompleted}
- openHighPriorityDeadlines=${dataset.metrics.openHighPriorityDeadlines}
- habitsTracked=${dataset.metrics.habitsTracked}
- averageHabitCompletion7d=${dataset.metrics.averageHabitCompletion7d}
- goalsTracked=${dataset.metrics.goalsTracked}
- journalEntries=${dataset.metrics.journalEntries}
- userReflections=${dataset.metrics.userReflections}
- studySessionsPlanned=${dataset.metrics.studySessionsPlanned}
- studySessionsDone=${dataset.metrics.studySessionsDone}
- studyCompletionRate=${dataset.metrics.studyCompletionRate}
- dominantEnergy=${dataset.metrics.dominantEnergy}
- dominantStress=${dataset.metrics.dominantStress}

Deadlines in analysis window:
${deadlineLines || "- none"}

Urgent open deadlines (next 7 days):
${urgentLines || "- none"}

Habits:
${habitLines || "- none"}

Goals:
${goalLines || "- none"}

Journal reflections:
${journalLines || "- none"}

User chat reflections:
${reflectionLines || "- none"}`;
}

function parseInsightJson(raw: string): ParsedCoachInsight | null {
  const trimmed = raw.trim();
  const direct = (() => {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  })();

  const candidate = direct ?? (() => {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as unknown;
    } catch {
      return null;
    }
  })();

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? normalizeText(record.summary, 500) : "";
  const strengths = Array.isArray(record.strengths)
    ? record.strengths.filter((value): value is string => typeof value === "string")
    : [];
  const risks = Array.isArray(record.risks)
    ? record.risks.filter((value): value is string => typeof value === "string")
    : [];
  const recommendations = Array.isArray(record.recommendations)
    ? record.recommendations.filter((value): value is string => typeof value === "string")
    : [];

  if (!summary) {
    return null;
  }

  return {
    summary: enforceSecondPersonVoice(summary),
    strengths: uniqueTrimmed(strengths.map((item) => enforceSecondPersonVoice(item)), 5),
    risks: uniqueTrimmed(risks.map((item) => enforceSecondPersonVoice(item)), 5),
    recommendations: uniqueTrimmed(recommendations.map((item) => enforceSecondPersonVoice(item)), 5)
  };
}

export async function generateAnalyticsCoachInsight(
  store: RuntimeStore,
  options: GenerateAnalyticsCoachOptions = {}
): Promise<AnalyticsCoachInsight> {
  const now = options.now ?? new Date();
  const periodDays = coercePeriodDays(options.periodDays);
  const dataset = buildDataset(store, periodDays, now);
  const fallback = buildFallbackInsight(dataset);

  const gemini = options.geminiClient ?? getGeminiClient();
  if (!gemini.isConfigured()) {
    return fallback;
  }

  let insight: AnalyticsCoachInsight = fallback;
  try {
    const response = await gemini.generateChatResponse({
      systemInstruction:
        "You are an academic habit coach. Return strict JSON only, grounded exclusively in provided data, and address Lucy directly in second person.",
      messages: [
        {
          role: "user",
          parts: [{ text: buildPrompt(dataset) }]
        }
      ]
    });

    const parsed = parseInsightJson(response.text);
    if (!parsed) {
      insight = fallback;
    } else {
      insight = {
        ...fallback,
        generatedAt: nowIso(),
        source: "gemini",
        summary: enforceSecondPersonVoice(parsed.summary),
        strengths: mergeListWithFallback(parsed.strengths, fallback.strengths, 2, 5),
        risks: mergeListWithFallback(parsed.risks, fallback.risks, 2, 5),
        recommendations: mergeListWithFallback(parsed.recommendations, fallback.recommendations, 3, 5)
      };
    }
  } catch {
    insight = fallback;
  }

  const visual = await maybeGenerateAnalyticsVisual(gemini, insight);
  if (!visual) {
    return insight;
  }

  return {
    ...insight,
    visual
  };
}
