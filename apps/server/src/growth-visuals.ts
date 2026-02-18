import { GeminiClient } from "./gemini.js";
import { AnalyticsCoachInsight, DailyJournalSummary, GrowthNarrativeVisual } from "./types.js";
import { nowIso } from "./utils.js";

const MAX_PROMPT_TEXT_LENGTH = 300;

function compact(value: string, maxLength = MAX_PROMPT_TEXT_LENGTH): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength)}...`;
}

function buildDailyVisualPrompt(summary: DailyJournalSummary): string {
  const highlights = summary.highlights.slice(0, 3).map((item) => `- ${compact(item, 140)}`).join("\n");
  return `Create a vibrant digital illustration of Lucy's day as a growth journey.
Tone: hopeful, focused, grounded.
Style: modern editorial art, expressive lighting, rich colors, clean composition.
Scene cues:
- Reflection summary: ${compact(summary.summary)}
- Signals: ${summary.chatMessageCount} chat notes, ${summary.journalEntryCount} journal entries
${highlights ? `- Key highlights:\n${highlights}` : "- Key highlights: none"}

Output requirements:
- No text overlays
- No logos or UI chrome
- Safe-for-work
- Portrait-friendly composition.`;
}

function buildAnalyticsVisualPrompt(insight: AnalyticsCoachInsight): string {
  const strength = insight.strengths[0] ? compact(insight.strengths[0], 140) : "steady momentum";
  const risk = insight.risks[0] ? compact(insight.risks[0], 140) : "friction points";
  const recommendation = insight.recommendations[0] ? compact(insight.recommendations[0], 140) : "clear next action";
  return `Create a cinematic strategic-growth illustration for Lucy's ${insight.periodDays}-day review.
Tone: confident, practical, motivating.
Style: premium concept art, colorful gradients, structured composition.
Narrative cues:
- Main summary: ${compact(insight.summary)}
- Strength to emphasize: ${strength}
- Risk to visualize: ${risk}
- Directional next step: ${recommendation}

Output requirements:
- No text overlays
- No logos or dashboards
- Safe-for-work
- Portrait-friendly composition with clear focal subject.`;
}

async function generateVisual(
  gemini: GeminiClient,
  prompt: string,
  alt: string
): Promise<GrowthNarrativeVisual | undefined> {
  const maybeGenerator = gemini as unknown as {
    generateGrowthImage?: (input: string) => Promise<{ dataUrl: string; mimeType: string; model: string } | null>;
  };

  if (typeof maybeGenerator.generateGrowthImage !== "function") {
    return undefined;
  }

  try {
    const generated = await maybeGenerator.generateGrowthImage(prompt);
    if (!generated) {
      return undefined;
    }

    return {
      dataUrl: generated.dataUrl,
      mimeType: generated.mimeType,
      model: generated.model,
      alt,
      generatedAt: nowIso()
    };
  } catch {
    return undefined;
  }
}

export async function maybeGenerateDailySummaryVisual(
  gemini: GeminiClient,
  summary: DailyJournalSummary
): Promise<GrowthNarrativeVisual | undefined> {
  if (summary.chatMessageCount + summary.journalEntryCount === 0) {
    return undefined;
  }
  return generateVisual(gemini, buildDailyVisualPrompt(summary), "Daily growth reflection illustration");
}

export async function maybeGenerateAnalyticsVisual(
  gemini: GeminiClient,
  insight: AnalyticsCoachInsight
): Promise<GrowthNarrativeVisual | undefined> {
  return generateVisual(gemini, buildAnalyticsVisualPrompt(insight), `${insight.periodDays}-day growth narrative illustration`);
}
