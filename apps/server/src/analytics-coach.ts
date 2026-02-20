import { GeminiClient, getGeminiClient } from "./gemini.js";
import { maybeGenerateAnalyticsVisual } from "./growth-visuals.js";
import { RuntimeStore } from "./store.js";
import {
  AnalyticsCoachInsight,
  AnalyticsCoachMetrics,
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

  const reflections = store
    .getReflectionEntriesInRange(windowStartIso, windowEndIso, 300)
    .slice(0, MAX_REFLECTION_SNIPPETS);

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
    nutritionHistory: store.getNutritionDailyHistory(windowStartDate, now, { eatenOnly: true }),
    bodyComp: store.getWithingsData().weight.filter((w) => inWindow(w.measuredAt, windowStartMs, nowMs)),
    sleepHistory: store.getWithingsData().sleepSummary.filter((s) => inWindow(s.date, windowStartMs, nowMs)),
    scheduleEvents: store.getScheduleEvents().filter((e) => inWindow(e.startTime, windowStartMs, nowMs))
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

  if (metrics.reflectionEntries + metrics.userReflections < 3) {
    risks.push("Journal-memory volume is low, which weakens pattern detection and coaching quality.");
    recommendations.push("Add a two-line end-of-day journal recap to make tomorrow's coaching more precise.");
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

  // Build fallback correlations from available cross-domain signals
  const correlations: string[] = [];
  const gymDays = dataset.nutritionHistory.filter((d) => d.gymCheckedIn);
  const nonGymDays = dataset.nutritionHistory.filter((d) => !d.gymCheckedIn);
  if (gymDays.length >= 2 && nonGymDays.length >= 2) {
    const avgGymCal = Math.round(gymDays.reduce((s, d) => s + d.totals.calories, 0) / gymDays.length);
    const avgRestCal = Math.round(nonGymDays.reduce((s, d) => s + d.totals.calories, 0) / nonGymDays.length);
    if (avgGymCal !== avgRestCal) {
      correlations.push(
        `Gym days average ${avgGymCal}kcal vs rest days at ${avgRestCal}kcal — ${avgGymCal > avgRestCal ? "higher intake aligns with training" : "lower intake on gym days may limit recovery"}.`
      );
    }
  }
  if (dataset.sleepHistory.length >= 2 && metrics.studySessionsPlanned > 0) {
    const avgSleep = dataset.sleepHistory.reduce((s, d) => s + d.totalSleepSeconds, 0) / dataset.sleepHistory.length / 3600;
    correlations.push(
      `Average sleep of ${avgSleep.toFixed(1)}h alongside ${metrics.studyCompletionRate}% study completion — ${avgSleep >= 7 ? "adequate rest supports study follow-through" : "short sleep may be dragging study execution"}.`
    );
  }
  if (dataset.bodyComp.length >= 2) {
    const first = dataset.bodyComp[0];
    const last = dataset.bodyComp[dataset.bodyComp.length - 1];
    const delta = last.weightKg - first.weightKg;
    correlations.push(
      `Body weight moved ${delta > 0 ? "+" : ""}${delta.toFixed(1)}kg over the window while habit completion averaged ${metrics.averageHabitCompletion7d}%.`
    );
  }
  if (correlations.length === 0) {
    correlations.push("Not enough cross-domain data to surface strong correlations yet — track nutrition, sleep, and workouts to unlock deeper insights.");
  }

  return {
    periodDays: dataset.periodDays,
    windowStart: dataset.windowStart,
    windowEnd: dataset.windowEnd,
    generatedAt: nowIso(),
    source: "fallback",
    summary,
    correlations: uniqueTrimmed(correlations, 5),
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

  return `You are Lucy's personal performance coach. You have deep expertise in habit psychology, academic productivity, nutrition, and fitness.

Analyze Lucy's data from the last ${dataset.periodDays} days. Address her directly (you/your). Never say "the user" or "the student".

Your coaching approach:
- Look at the data holistically — notice how sleep, nutrition, gym habits, stress, and academic work affect each other
- When you see patterns (e.g., poor sleep → skipped gym → lower study output), translate them into actionable coaching insights
- Be warm, direct, and solution-oriented — like a trusted coach who genuinely cares
- Lead with what's working, be honest about what isn't, and always offer a concrete next step
- Don't just describe data — interpret it and suggest what to DO differently

IMPORTANT CONTEXT:
- The "weightKg" in the nutrition target profile is Lucy's BASELINE/STARTING weight used to calculate macros (protein per lb, fat per lb). It is NOT a goal weight. Do not treat it as a weight target.
- Nutrition data reflects EATEN meals only (meals marked as consumed). Planned/templated meals that haven't been eaten yet are excluded.

Return strict JSON only:
{
  "summary": "3-5 sentence coaching narrative. Weave in cross-domain observations naturally (e.g., how gym consistency affects energy for studying). Don't just list facts — connect them and coach.",
  "correlations": ["3-5 coaching observations that connect different areas of Lucy's life. Frame as insights, not raw data points. E.g., 'Your gym sessions seem to energize your study focus the next day — protecting that routine matters.' NOT 'Gym days correlate with 20% higher study completion.'"],
  "strengths": ["2-4 things Lucy is doing well, framed encouragingly"],
  "risks": ["2-4 patterns to watch out for, framed as coaching warnings not alarms"],
  "recommendations": ["3-5 specific, immediately actionable steps Lucy can take this week"]
}

Rules:
- No markdown. No extra keys.
- Write like a personal coach, not a data analyst. Observations should feel like insights from someone who knows Lucy, not a spreadsheet.
- If a pattern connects two domains (sleep+study, nutrition+gym, stress+deadlines), mention the connection naturally in your coaching.
- Never truncate or cut off sentences — complete every thought fully.

Aggregate metrics:
- deadlinesDue=${dataset.metrics.deadlinesDue} completed=${dataset.metrics.deadlinesCompleted}
- openHighPriority=${dataset.metrics.openHighPriorityDeadlines}
- habits=${dataset.metrics.habitsTracked} avgCompletion7d=${dataset.metrics.averageHabitCompletion7d}%
- goals=${dataset.metrics.goalsTracked}
- studySessions=${dataset.metrics.studySessionsDone}/${dataset.metrics.studySessionsPlanned} (${dataset.metrics.studyCompletionRate}%)
- energy=${dataset.metrics.dominantEnergy ?? "unknown"} stress=${dataset.metrics.dominantStress ?? "unknown"}
- reflections=${dataset.metrics.reflectionEntries}

Deadlines:
${deadlineLines || "- none"}

Urgent (next 7d):
${urgentLines || "- none"}

Habits:
${habitLines || "- none"}

Goals:
${goalLines || "- none"}

Nutrition (daily):
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

  if (!summary) {
    return null;
  }

  return {
    summary: enforceSecondPersonVoice(summary),
    correlations: uniqueTrimmed(correlations.map((item) => enforceSecondPersonVoice(item)), 5),
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
        "You are Lucy's personal performance coach — warm, direct, and insight-driven. You notice patterns across all domains of her life and translate them into actionable coaching. Return strict JSON only, grounded exclusively in provided data, and address Lucy directly in second person. Never truncate your output.",
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
        correlations: mergeListWithFallback(parsed.correlations, fallback.correlations, 2, 5),
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
