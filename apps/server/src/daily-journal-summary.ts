import { GeminiClient, getGeminiClient } from "./gemini.js";
import { maybeGenerateDailySummaryVisual } from "./growth-visuals.js";
import { RuntimeStore } from "./store.js";
import { ChatMessage, DailyJournalSummary, JournalEntry } from "./types.js";
import { nowIso } from "./utils.js";

interface GenerateDailyJournalSummaryOptions {
  now?: Date;
  geminiClient?: GeminiClient;
}

const MAX_JOURNAL_ITEMS = 20;
const MAX_CHAT_ITEMS = 36;

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function startsWithDateKey(value: string, dateKey: string): boolean {
  return typeof value === "string" && value.startsWith(dateKey);
}

function snippet(value: string, maxLength = 180): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
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

function collectTodayJournals(store: RuntimeStore, dateKey: string): JournalEntry[] {
  return store
    .getJournalEntries(80)
    .filter((entry) => startsWithDateKey(entry.timestamp, dateKey))
    .slice(0, MAX_JOURNAL_ITEMS);
}

function collectTodayUserChats(store: RuntimeStore, dateKey: string): ChatMessage[] {
  return store
    .getRecentChatMessages(220)
    .filter(
      (message) =>
        message.role === "user" &&
        startsWithDateKey(message.timestamp, dateKey) &&
        message.content.trim().length > 0
    )
    .slice(-MAX_CHAT_ITEMS);
}

function buildLocalHighlights(journals: JournalEntry[], chats: ChatMessage[]): string[] {
  const highlights: string[] = [];

  journals.slice(0, 3).forEach((entry) => {
    highlights.push(`Journal: ${snippet(entry.content, 120)}`);
  });

  chats
    .slice(-3)
    .reverse()
    .forEach((message) => {
      highlights.push(`Chat: ${snippet(message.content, 120)}`);
    });

  return highlights.slice(0, 5);
}

function buildFallbackSummary(dateKey: string, journals: JournalEntry[], chats: ChatMessage[]): DailyJournalSummary {
  const journalEntryCount = journals.length;
  const chatMessageCount = chats.length;
  const totalSignals = journalEntryCount + chatMessageCount;

  const summary =
    totalSignals === 0
      ? "No journal reflections or chat notes yet for this day."
      : totalSignals < 4
        ? `Light reflection day: ${chatMessageCount} chat note(s) and ${journalEntryCount} journal entr${journalEntryCount === 1 ? "y" : "ies"}. Add one focused reflection tonight to improve pattern quality.`
        : `Active reflection day with ${chatMessageCount} chat note(s) and ${journalEntryCount} journal entr${journalEntryCount === 1 ? "y" : "ies"}. Keep turning recurring themes into one concrete next-step habit.`;

  return {
    date: dateKey,
    generatedAt: nowIso(),
    summary,
    highlights: buildLocalHighlights(journals, chats),
    journalEntryCount,
    chatMessageCount
  };
}

function buildPrompt(dateKey: string, journals: JournalEntry[], chats: ChatMessage[]): string {
  const journalLines = journals
    .map((entry) => `- [${entry.timestamp}] ${snippet(entry.content, 220)}`)
    .join("\n");
  const chatLines = chats
    .map((message) => `- [${message.timestamp}] ${snippet(message.content, 220)}`)
    .join("\n");

  return `Analyze daily reflection data for ${dateKey}. Focus on study consistency, stress/friction signals, and habit strengthening opportunities.
Address Lucy directly in second person (you/your). Never refer to "the user" or "the student".

Return strict JSON with this shape only:
{
  "summary": "2-4 sentence analysis",
  "highlights": ["3 to 5 concise bullets"]
}

Rules:
- No markdown.
- No extra keys.
- Keep suggestions concrete and behavior-focused.
- Mention what to keep doing and what to adjust.

Journal entries:
${journalLines || "- none"}

User chat reflections:
${chatLines || "- none"}`;
}

function parseJsonInsights(raw: string): { summary: string; highlights: string[] } | null {
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
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const highlights = Array.isArray(record.highlights)
    ? record.highlights
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
        .slice(0, 5)
    : [];

  if (!summary) {
    return null;
  }

  return {
    summary: enforceSecondPersonVoice(summary),
    highlights: highlights
      .map((item) => enforceSecondPersonVoice(item))
      .filter((item) => item.length > 0)
      .slice(0, 5)
  };
}

export async function generateDailyJournalSummary(
  store: RuntimeStore,
  options: GenerateDailyJournalSummaryOptions = {}
): Promise<DailyJournalSummary> {
  const now = options.now ?? new Date();
  const dateKey = toDateKey(now);
  const journals = collectTodayJournals(store, dateKey);
  const chats = collectTodayUserChats(store, dateKey);

  const fallback = buildFallbackSummary(dateKey, journals, chats);
  if (fallback.journalEntryCount + fallback.chatMessageCount === 0) {
    return fallback;
  }

  const gemini = options.geminiClient ?? getGeminiClient();
  if (!gemini.isConfigured()) {
    return fallback;
  }

  let summary: DailyJournalSummary = fallback;
  try {
    const response = await gemini.generateChatResponse({
      systemInstruction:
        "You are an academic coaching analyst. Output strict JSON only, base analysis strictly on provided data, and address Lucy directly in second person.",
      messages: [
        {
          role: "user",
          parts: [{ text: buildPrompt(dateKey, journals, chats) }]
        }
      ]
    });

    const parsed = parseJsonInsights(response.text);
    if (!parsed) {
      summary = fallback;
    } else {
      summary = {
        ...fallback,
        generatedAt: nowIso(),
        summary: enforceSecondPersonVoice(parsed.summary),
        highlights: parsed.highlights.length > 0 ? parsed.highlights : fallback.highlights
      };
    }
  } catch {
    summary = fallback;
  }

  const visual = await maybeGenerateDailySummaryVisual(gemini, summary);
  if (!visual) {
    return summary;
  }

  return {
    ...summary,
    visual
  };
}
