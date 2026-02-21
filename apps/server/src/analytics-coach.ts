import { GeminiClient, getGeminiClient } from "./gemini.js";
import { config } from "./config.js";
import { maybeGenerateAnalyticsVisual } from "./growth-visuals.js";
import { RuntimeStore } from "./store.js";
import {
  AnalyticsCoachInsight,
  AnalyticsCoachMetrics,
  ChallengePrompt,
  Deadline,
  GoalWithStatus,
  HabitWithStatus,
  LectureEvent,
  NutritionDayHistoryEntry,
  ReflectionEntry,
  WithingsSleepSummaryEntry,
  WithingsWeightEntry
} from "./types.js";
import { nowIso } from "./utils.js";

interface GenerateAnalyticsCoachOptions {
  periodDays?: number;
  now?: Date;
  geminiClient?: GeminiClient;
}

interface ParsedCoachInsight {
  summary: string;
  correlations: string[];
  strengths: string[];
  risks: string[];
  recommendations: string[];
  challenges: ChallengePrompt[];
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
  reflections: ReflectionEntry[];
  nutritionHistory: NutritionDayHistoryEntry[];
  bodyComp: WithingsWeightEntry[];
  sleepHistory: WithingsSleepSummaryEntry[];
  scheduleEvents: LectureEvent[];
}

const SUPPORTED_PERIODS: Array<7 | 14 | 30> = [7, 14, 30];
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
  // Never truncate output text — only compress whitespace
  return compact;
}

/** Truncate input data for prompts only (not user-facing output) */
function truncateForPrompt(text: string, maxLength: number): string {
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
    const cleaned = item.replace(/\s+/g, " ").trim();
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

function buildDataset(store: RuntimeStore, userId: string, periodDays: 7 | 14 | 30, now: Date): AnalyticsDataset {
  const nowMs = now.getTime();
  const windowStartDate = new Date(nowMs - periodDays * 24 * 60 * 60 * 1000);
  const windowStartMs = windowStartDate.getTime();
  const windowStartIso = toIsoDate(windowStartDate);
  const windowEndIso = toIsoDate(now);
  const nextWeekMs = nowMs + 7 * 24 * 60 * 60 * 1000;

  const deadlines = store.getAcademicDeadlines(userId, now);
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

  const habits = store.getHabitsWithStatus(userId);
  const goals = store.getGoalsWithStatus(userId);

  const reflections = store
    .getReflectionEntriesInRange(userId, windowStartIso, windowEndIso, 300)
    .slice(0, MAX_REFLECTION_SNIPPETS);

  const adherence = store.getStudyPlanAdherenceMetrics(userId, {
    windowStart: windowStartIso,
    windowEnd: windowEndIso
  });
  const trends = store.getContextTrends(userId);

  const metrics: AnalyticsCoachMetrics = {
    deadlinesDue: deadlinesInWindow.length,
    deadlinesCompleted: deadlinesInWindow.filter((deadline) => deadline.completed).length,
    openHighPriorityDeadlines: openUrgentDeadlines.length,
    habitsTracked: habits.length,
    habitsCompletedToday: habits.filter((habit) => habit.todayCompleted).length,
    averageHabitCompletion7d: Math.round(average(habits.map((habit) => habit.completionRate7d))),
    goalsTracked: goals.length,
    goalsCompletedToday: goals.filter((goal) => goal.todayCompleted).length,
    reflectionEntries: reflections.length,
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
    reflections,
    nutritionHistory: store.getNutritionDailyHistory(userId, windowStartDate, now, { eatenOnly: true }),
    bodyComp: store.getWithingsData(userId).weight.filter((w) => inWindow(w.measuredAt, windowStartMs, nowMs)),
    sleepHistory: store.getWithingsData(userId).sleepSummary.filter((s) => inWindow(s.date, windowStartMs, nowMs)),
    scheduleEvents: store.getScheduleEvents(userId).filter((e) => inWindow(e.startTime, windowStartMs, nowMs))
  };
}

function buildFallbackInsight(dataset: AnalyticsDataset): AnalyticsCoachInsight {
  const { metrics } = dataset;
  const strengths: string[] = [];
  const risks: string[] = [];
  const recommendations: string[] = [];

  if (metrics.deadlinesDue > 0) {
    strengths.push(
      `You knocked out ${metrics.deadlinesCompleted} of ${metrics.deadlinesDue} deadlines in the last ${dataset.periodDays} days.`
    );
  }

  const habitDaysHit = Math.round((metrics.averageHabitCompletion7d / 100) * 7);
  if (habitDaysHit >= 4 && metrics.habitsTracked > 0) {
    strengths.push(`Solid habit rhythm — hitting ${habitDaysHit}/7 days this week.`);
  }

  if (metrics.studySessionsPlanned > 0 && metrics.studyCompletionRate >= 60) {
    strengths.push(
      `Study execution is holding — ${metrics.studySessionsDone} of ${metrics.studySessionsPlanned} planned sessions done.`
    );
  }

  if (metrics.goalsTracked > 0 && metrics.goalsCompletedToday > 0) {
    strengths.push("You checked in on your goals today — that follow-through matters.");
  }

  if (strengths.length === 0) {
    strengths.push("You have active data across coursework and habits — that's the foundation for progress.");
  }

  if (metrics.openHighPriorityDeadlines > 0) {
    risks.push(`${metrics.openHighPriorityDeadlines} high-priority deadline${metrics.openHighPriorityDeadlines > 1 ? "s" : ""} coming up this week.`);
    recommendations.push("Block one deep-work session in the next 24 hours for the nearest deadline.");
  }

  if (metrics.habitsTracked > 0 && habitDaysHit < 4) {
    risks.push(`Habits only hit ${habitDaysHit}/7 days this week — the streak needs protecting.`);
    recommendations.push("Anchor your key habit to something fixed, like right after your first lecture.");
  }

  if (metrics.studySessionsPlanned > 0 && metrics.studyCompletionRate < 50) {
    risks.push(
      `Only ${metrics.studySessionsDone} of ${metrics.studySessionsPlanned} study sessions actually happened.`
    );
    recommendations.push("Mark each study session done/skipped right away to keep plans honest.");
  }

  if (metrics.goalsTracked > 0 && metrics.goalsCompletedToday === 0) {
    risks.push("Goals are set but no check-in today.");
    recommendations.push("Pick one goal and do one small step before your next break.");
  }

  if (risks.length === 0) {
    risks.push("No major risk patterns right now — focus on building consistency.");
    recommendations.push("Plan tomorrow's top task tonight to keep momentum.");
  }

  const summary =
    metrics.deadlinesDue === 0 && metrics.habitsTracked === 0 && metrics.goalsTracked === 0
      ? `Not enough tracked activity in the last ${dataset.periodDays} days to surface patterns yet.`
      : `Over the last ${dataset.periodDays} days you completed ${metrics.deadlinesCompleted} of ${metrics.deadlinesDue} deadlines and hit your habits ${habitDaysHit}/7 days this week.`;

  // Build fallback correlations from cross-domain signals
  const correlations: string[] = [];
  const gymDays = dataset.nutritionHistory.filter((d) => d.gymCheckedIn);
  const nonGymDays = dataset.nutritionHistory.filter((d) => !d.gymCheckedIn);
  if (gymDays.length >= 2 && nonGymDays.length >= 2) {
    const avgGymCal = Math.round(gymDays.reduce((s, d) => s + d.totals.calories, 0) / gymDays.length);
    const avgRestCal = Math.round(nonGymDays.reduce((s, d) => s + d.totals.calories, 0) / nonGymDays.length);
    if (avgGymCal !== avgRestCal) {
      correlations.push(
        avgGymCal > avgRestCal
          ? "You eat more on gym days — good, your training needs the fuel."
          : "You're eating less on gym days — that might be limiting your recovery."
      );
    }
  }
  if (dataset.sleepHistory.length >= 2 && metrics.studySessionsPlanned > 0) {
    const avgSleep = dataset.sleepHistory.reduce((s, d) => s + d.totalSleepSeconds, 0) / dataset.sleepHistory.length / 3600;
    correlations.push(
      avgSleep >= 7
        ? "Sleep is decent — that's fueling your study output."
        : "Short sleep may be dragging your study follow-through."
    );
  }
  if (dataset.bodyComp.length >= 2) {
    const first = dataset.bodyComp[0];
    const last = dataset.bodyComp[dataset.bodyComp.length - 1];
    const delta = last.weightKg - first.weightKg;
    correlations.push(
      `Weight moved ${delta > 0 ? "+" : ""}${delta.toFixed(1)}kg over the window — ${Math.abs(delta) < 0.3 ? "holding steady" : delta > 0 ? "trending up, check if that aligns with your bulk target" : "trending down, make sure you're eating enough to support training"}.`
    );
  }
  if (correlations.length === 0) {
    correlations.push("Track nutrition, sleep, and workouts to unlock cross-domain coaching insights.");
  }

  return {
    periodDays: dataset.periodDays,
    windowStart: dataset.windowStart,
    windowEnd: dataset.windowEnd,
    generatedAt: nowIso(),
    source: "fallback",
    summary,
    correlations: uniqueTrimmed(correlations, 3),
    strengths: uniqueTrimmed(strengths, 3),
    risks: uniqueTrimmed(risks, 3),
    recommendations: mergeListWithFallback(recommendations, [
      "Plan tomorrow's top task tonight.",
      "Do a quick habit check-in before bed.",
      "Prioritize what's both urgent and high-impact."
    ], 3, 4),
    metrics
  };
}

function buildPrompt(dataset: AnalyticsDataset): string {
  const deadlineLines = dataset.deadlinesInWindow
    .slice(0, MAX_DEADLINE_SNIPPETS)
    .map((deadline) => {
      const status = deadline.completed ? "completed" : "open";
      return `- ${deadline.course}: ${truncateForPrompt(deadline.task, 90)} | due=${deadline.dueDate} | priority=${deadline.priority} | ${status}`;
    })
    .join("\n");

  const urgentLines = dataset.openUrgentDeadlines
    .slice(0, MAX_DEADLINE_SNIPPETS)
    .map((deadline) => `- ${deadline.course}: ${truncateForPrompt(deadline.task, 90)} | due=${deadline.dueDate}`)
    .join("\n");

  const habitLines = dataset.habits
    .slice(0, MAX_HABIT_SNIPPETS)
    .map(
      (habit) => {
        const daysHit = Math.round((habit.completionRate7d / 100) * 7);
        return `- ${habit.name}: ${daysHit}/7 days this week, streak=${habit.streak}, today=${habit.todayCompleted ? "done" : "not-done"}`;
      }
    )
    .join("\n");

  const goalLines = dataset.goals
    .slice(0, MAX_GOAL_SNIPPETS)
    .map(
      (goal) =>
        `- ${goal.title}: progress=${goal.progressCount}/${goal.targetCount} remaining=${goal.remaining} today=${goal.todayCompleted ? "done" : "not-done"} due=${goal.dueDate ?? "none"}`
    )
    .join("\n");

  const reflectionLines = dataset.reflections
    .map(
      (entry) =>
        `- [${entry.timestamp}] event=${truncateForPrompt(entry.event, 120)} | feeling=${truncateForPrompt(entry.feelingStress, 100)} | intent=${truncateForPrompt(entry.intent, 120)} | commitment=${truncateForPrompt(entry.commitment, 120)} | outcome=${truncateForPrompt(entry.outcome, 150)} | evidence=${truncateForPrompt(entry.evidenceSnippet, 200)}`
    )
    .join("\n");

  const nutritionLines = dataset.nutritionHistory
    .slice(-10)
    .map((day) => {
      const targetCal = day.targets?.calories ?? 0;
      const pct = targetCal > 0 ? Math.round((day.totals.calories / targetCal) * 100) : 0;
      return `- ${day.date}: ${Math.round(day.totals.calories)}kcal/${targetCal}kcal (${pct}%) | protein=${Math.round(day.totals.proteinGrams)}g | meals=${day.mealsLogged} | gym=${day.gymCheckedIn ? "yes" : "no"}`;
    })
    .join("\n");

  const bodyCompLines = dataset.bodyComp
    .slice(-6)
    .map((w) => {
      const parts = [`${w.weightKg}kg`];
      if (w.fatRatioPercent != null) parts.push(`bf=${w.fatRatioPercent}%`);
      if (w.muscleMassKg != null) parts.push(`muscle=${w.muscleMassKg}kg`);
      return `- ${w.measuredAt.slice(0, 10)}: ${parts.join(" | ")}`;
    })
    .join("\n");

  const sleepLines = dataset.sleepHistory
    .slice(-7)
    .map((s) => {
      const hrs = (s.totalSleepSeconds / 3600).toFixed(1);
      const parts = [`${hrs}h total`];
      if (s.deepSleepSeconds != null) parts.push(`deep=${(s.deepSleepSeconds / 3600).toFixed(1)}h`);
      if (s.sleepEfficiency != null) parts.push(`efficiency=${s.sleepEfficiency}%`);
      if (s.hrAverage != null) parts.push(`hr=${s.hrAverage}bpm`);
      return `- ${s.date}: ${parts.join(" | ")}`;
    })
    .join("\n");

  const scheduleLines = dataset.scheduleEvents
    .slice(0, 10)
    .map((e) => `- ${e.startTime.slice(0, 10)} ${e.title} (${e.durationMinutes}min, ${e.workload})`)
    .join("\n");

  const userName = config.USER_NAME;
  return `You are ${userName}'s personal performance coach. Analyze their last ${dataset.periodDays} days. Address them directly (you/your).

STYLE RULES (critical):
- Be CONCISE. Each bullet should be 1-2 sentences max. No filler.
- NEVER parrot raw numbers from the data back. The user can see the data themselves. Instead, interpret what the numbers MEAN and what to DO about them.
- BAD: "Your habit completion is 14% over 7 days" or "You sent 45 chat messages" — these are data points they already know.
- GOOD: "You hit the gym once this week — to build the momentum your lean bulk needs, showing up 4 days would be the minimum." — this interprets and advises.
- Use natural counts: "4/6 days" not "67%". "2 of 3 deadlines" not "67% completion rate".
- Write like a trusted coach who knows them, not a dashboard. Be warm but direct.

IMPORTANT CONTEXT:
- "weightKg" in nutrition targets is the user's BASELINE weight for macro calculation, NOT a goal weight.
- Nutrition data reflects EATEN meals only (consumed, not planned templates).

Return strict JSON only:
{
  "summary": "2-3 sentence coaching take on the period. Connect domains (sleep, gym, study, nutrition). Interpret, don't describe.",
  "correlations": ["2-3 short insights connecting different life areas. Frame as coaching observations."],
  "strengths": ["2-3 things going well. Be specific and encouraging."],
  "risks": ["2-3 patterns to watch. Warm warnings, not alarms."],
  "recommendations": ["3-4 specific, immediately actionable steps. Each one sentence."],
  "challenges": [
    {"type": "connect", "question": "...", "hint": "..."},
    {"type": "predict", "question": "...", "hint": "..."},
    {"type": "reflect", "question": "...", "hint": "..."},
    {"type": "commit", "question": "...", "hint": "..."}
  ]
}

Challenge types:
- "connect": Ask the user to draw a connection between two data points (e.g., "What happened on the days you skipped the gym? Look at your sleep.")
- "predict": Ask the user to predict an outcome (e.g., "If you hit 4 gym sessions next week, what do you think happens to your energy levels?")
- "reflect": A reflection question (e.g., "What's the one thing that would make tomorrow's meal prep easier?")
- "commit": A micro-commitment (e.g., "Name one meal you'll prep tonight for tomorrow.")

Generate EXACTLY 2 challenges for EACH of the 4 types (8 total). Each type must have exactly 2 prompts so the user can swipe through them. They should feel like a coach prompting active thinking, not a quiz.

Rules:
- No markdown. No extra keys.
- Never truncate or cut off sentences.
- Keep total output SHORT. Quality over quantity.

Data:
- Deadlines: ${dataset.metrics.deadlinesDue} due, ${dataset.metrics.deadlinesCompleted} completed, ${dataset.metrics.openHighPriorityDeadlines} high-priority upcoming
- Habits: ${dataset.metrics.habitsTracked} tracked
- Goals: ${dataset.metrics.goalsTracked} tracked
- Study: ${dataset.metrics.studySessionsDone}/${dataset.metrics.studySessionsPlanned} sessions
- Energy: ${dataset.metrics.dominantEnergy ?? "unknown"}, Stress: ${dataset.metrics.dominantStress ?? "unknown"}

Deadlines:
${deadlineLines || "- none"}

Urgent (next 7d):
${urgentLines || "- none"}

Habits:
${habitLines || "- none"}

Goals:
${goalLines || "- none"}

Nutrition (daily, eaten only):
${nutritionLines || "- no nutrition data"}

Body composition:
${bodyCompLines || "- no body comp data"}

Sleep:
${sleepLines || "- no sleep data"}

Schedule/lectures:
${scheduleLines || "- no schedule data"}

Journal reflections:
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
  const summary = typeof record.summary === "string" ? record.summary.replace(/\s+/g, " ").trim() : "";
  const correlations = Array.isArray(record.correlations)
    ? record.correlations.filter((value): value is string => typeof value === "string")
    : [];
  const strengths = Array.isArray(record.strengths)
    ? record.strengths.filter((value): value is string => typeof value === "string")
    : [];
  const risks = Array.isArray(record.risks)
    ? record.risks.filter((value): value is string => typeof value === "string")
    : [];
  const recommendations = Array.isArray(record.recommendations)
    ? record.recommendations.filter((value): value is string => typeof value === "string")
    : [];

  const VALID_CHALLENGE_TYPES = new Set(["connect", "predict", "reflect", "commit"]);
  const challenges: ChallengePrompt[] = Array.isArray(record.challenges)
    ? (record.challenges as unknown[])
        .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
        .filter((c) => typeof c.type === "string" && VALID_CHALLENGE_TYPES.has(c.type) && typeof c.question === "string")
        .map((c) => ({
          type: c.type as ChallengePrompt["type"],
          question: enforceSecondPersonVoice(String(c.question)),
          ...(typeof c.hint === "string" ? { hint: c.hint } : {})
        }))
        .slice(0, 12)
    : [];

  if (!summary) {
    return null;
  }

  return {
    summary: enforceSecondPersonVoice(summary),
    correlations: uniqueTrimmed(correlations.map((item) => enforceSecondPersonVoice(item)), 3),
    strengths: uniqueTrimmed(strengths.map((item) => enforceSecondPersonVoice(item)), 3),
    risks: uniqueTrimmed(risks.map((item) => enforceSecondPersonVoice(item)), 3),
    recommendations: uniqueTrimmed(recommendations.map((item) => enforceSecondPersonVoice(item)), 4),
    challenges
  };
}

export async function generateAnalyticsCoachInsight(
  store: RuntimeStore,
  userId: string,
  options: GenerateAnalyticsCoachOptions = {}
): Promise<AnalyticsCoachInsight> {
  const now = options.now ?? new Date();
  const periodDays = coercePeriodDays(options.periodDays);
  const dataset = buildDataset(store, userId, periodDays, now);
  const fallback = buildFallbackInsight(dataset);

  const gemini = options.geminiClient ?? getGeminiClient();
  if (!gemini.isConfigured()) {
    return fallback;
  }

  let insight: AnalyticsCoachInsight = fallback;
  try {
    const response = await gemini.generateChatResponse({
      systemInstruction:
        "You are a personal performance coach — warm, direct, concise. Interpret data into coaching insights. NEVER parrot raw statistics back. Return strict JSON only. Address the user in second person. Never truncate.",
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
        correlations: mergeListWithFallback(parsed.correlations, fallback.correlations, 2, 3),
        strengths: mergeListWithFallback(parsed.strengths, fallback.strengths, 2, 3),
        risks: mergeListWithFallback(parsed.risks, fallback.risks, 2, 3),
        recommendations: mergeListWithFallback(parsed.recommendations, fallback.recommendations, 3, 4),
        challenges: parsed.challenges.length > 0 ? parsed.challenges : undefined
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
