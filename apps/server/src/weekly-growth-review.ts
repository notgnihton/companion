import { GeminiClient } from "./gemini.js";
import { generateAnalyticsCoachInsight } from "./analytics-coach.js";
import { RuntimeStore } from "./store.js";
import { WeeklyGrowthReview } from "./types.js";

interface GenerateWeeklyGrowthReviewOptions {
  now?: Date;
  geminiClient?: GeminiClient;
}

function toRatioPercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round((numerator / denominator) * 100)));
}

function normalizeCommitment(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.;]\s*$/, "");
}

function buildFallbackCommitments(): string[] {
  return [
    "Block one deep work session for your highest-risk assignment before Tuesday",
    "Do a 15-minute daily review and check in at least one habit each day",
    "Set two concrete deliverables for the week and review them on Sunday"
  ];
}

function buildCommitments(recommendations: string[], summary: string): string[] {
  const commitments: string[] = [];
  const seen = new Set<string>();

  for (const recommendation of recommendations) {
    const normalized = normalizeCommitment(recommendation);
    if (!normalized) {
      continue;
    }

    const lowered = normalized.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    commitments.push(normalized);

    if (commitments.length >= 3) {
      break;
    }
  }

  for (const fallback of buildFallbackCommitments()) {
    if (commitments.length >= 3) {
      break;
    }
    const lowered = fallback.toLowerCase();
    if (seen.has(lowered)) {
      continue;
    }
    seen.add(lowered);
    commitments.push(fallback);
  }

  if (commitments.length === 0) {
    commitments.push(normalizeCommitment(summary));
  }

  return commitments.slice(0, 3);
}

export async function generateWeeklyGrowthReview(
  store: RuntimeStore,
  userId: string,
  options: GenerateWeeklyGrowthReviewOptions = {}
): Promise<WeeklyGrowthReview> {
  const now = options.now ?? new Date();
  const insight = await generateAnalyticsCoachInsight(store, userId, {
    periodDays: 7,
    now,
    geminiClient: options.geminiClient
  });

  const commitments = buildCommitments(insight.recommendations, insight.summary);
  const scheduleAdherence = toRatioPercent(insight.metrics.studySessionsDone, insight.metrics.studySessionsPlanned);
  const deadlineCompletionRate = toRatioPercent(insight.metrics.deadlinesCompleted, insight.metrics.deadlinesDue);

  return {
    periodDays: 7,
    windowStart: insight.windowStart,
    windowEnd: insight.windowEnd,
    generatedAt: insight.generatedAt,
    source: insight.source,
    summary: insight.summary,
    strengths: insight.strengths,
    risks: insight.risks,
    commitments,
    momentum: {
      scheduleAdherence,
      deadlineCompletionRate,
      habitCompletionRate: insight.metrics.averageHabitCompletion7d
    }
  };
}

export function isSundayInOslo(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "Europe/Oslo"
  }).format(now);
  return weekday === "Sun";
}

export function buildWeeklyGrowthSundayPushSummary(review: WeeklyGrowthReview): string {
  const commitments = review.commitments.slice(0, 2).join(" • ");
  const commitmentText = commitments.length > 0 ? ` Next week: ${commitments}.` : "";
  const summary = review.summary.length > 180 ? `${review.summary.slice(0, 177)}...` : review.summary;
  return `${summary}${commitmentText}`.trim();
}

