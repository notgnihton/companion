import { config } from "./config.js";
import { RuntimeStore } from "./store.js";
import { EmailDigestReason } from "./types.js";

const MS_IN_MINUTES = 60 * 1000;
const MS_IN_HOUR = 60 * 60 * 1000;
const MS_IN_DAY = 24 * MS_IN_HOUR;

export interface DigestContent {
  subject: string;
  body: string;
  timeframeStart: string;
  timeframeEnd: string;
}

export function buildDailyDigest(store: RuntimeStore, referenceDate: Date = new Date()): DigestContent {
  const start = startOfDay(referenceDate);
  const windowEndIso = referenceDate.toISOString();

  const deadlines = store.getDeadlines();
  const dueSoonLimit = new Date(referenceDate.getTime() + 2 * MS_IN_DAY);
  const dueSoon = deadlines.filter(
    (deadline) =>
      !deadline.completed &&
      new Date(deadline.dueDate) >= start &&
      new Date(deadline.dueDate) <= dueSoonLimit
  );
  const overdue = deadlines.filter((deadline) => !deadline.completed && new Date(deadline.dueDate) < referenceDate);

  const scheduleToday = store.getScheduleEvents().filter((event) => isSameDay(new Date(event.startTime), referenceDate));
  const context = store.getUserContext();

  const bodyLines: string[] = [
    `Hi ${config.USER_NAME || "friend"},`,
    "Push notifications were missed recently, so here's your daily digest.",
    `Timeframe: ${start.toISOString()} to ${windowEndIso}`,
    "",
    `Upcoming deadlines (${dueSoon.length}):`,
    ...(dueSoon.length > 0 ? dueSoon.slice(0, 6).map(formatDeadlineLine) : ["- None in the next 48 hours"]),
    `Overdue (${overdue.length}):`,
    ...(overdue.length > 0 ? overdue.slice(0, 5).map(formatDeadlineLine) : ["- None right now"]),
    `Today's schedule (${scheduleToday.length}):`,
    ...(scheduleToday.length > 0 ? scheduleToday.slice(0, 6).map(formatLectureLine) : ["- No events on the calendar"]),
    `Context snapshot: stress=${context.stressLevel}, energy=${context.energyLevel}, mode=${context.mode}`
  ];

  return {
    subject: "Companion daily digest",
    body: bodyLines.join("\n"),
    timeframeStart: start.toISOString(),
    timeframeEnd: windowEndIso
  };
}

export function buildWeeklyDigest(store: RuntimeStore, referenceDate: Date = new Date()): DigestContent {
  const summary = store.getWeeklySummary(referenceDate.toISOString());
  const highlights = summary.journalHighlights.slice(0, 3);

  const bodyLines: string[] = [
    `Hi ${config.USER_NAME || "friend"},`,
    "Push has been quiet, so here's a weekly recap to keep you on track.",
    `Window: ${summary.windowStart} to ${summary.windowEnd}`,
    "",
    `Deadlines completed: ${summary.deadlinesCompleted}/${summary.deadlinesDue} (${summary.completionRate}%)`,
    "Journal highlights:",
    ...(highlights.length > 0 ? highlights.map((entry) => `- ${truncate(entry.content, 140)}`) : ["- No journal entries captured"]),
    "Focus suggestions:",
    "- Carry over any overdue deadlines into this week",
    "- Plan two focused blocks for your toughest tasks"
  ];

  return {
    subject: "Companion weekly digest",
    body: bodyLines.join("\n"),
    timeframeStart: summary.windowStart,
    timeframeEnd: summary.windowEnd
  };
}

export class EmailDigestService {
  private timer: NodeJS.Timeout | null = null;
  private readonly dailyCooldownHours = 20;
  private readonly weeklyCooldownDays = 6;
  private readonly inactivityThresholdHours = 24;
  private readonly pushFailureWindowHours = 6;

  constructor(private readonly store: RuntimeStore) {}

  start(intervalMs: number = 15 * MS_IN_MINUTES): void {
    if (this.timer) {
      return;
    }

    void this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runOnce(referenceDate: Date = new Date()): Promise<void> {
    const reason = this.detectFallbackReason(referenceDate);

    if (!reason) {
      return;
    }

    if (this.shouldSendDaily(referenceDate)) {
      const digest = buildDailyDigest(this.store, referenceDate);
      this.store.recordEmailDigest({
        type: "daily",
        reason,
        recipient: config.FALLBACK_EMAIL,
        ...digest
      });
    }

    if (this.shouldSendWeekly(referenceDate)) {
      const digest = buildWeeklyDigest(this.store, referenceDate);
      this.store.recordEmailDigest({
        type: "weekly",
        reason,
        recipient: config.FALLBACK_EMAIL,
        ...digest
      });
    }
  }

  private detectFallbackReason(referenceDate: Date): EmailDigestReason | null {
    if (this.hasRecentPushFailures(referenceDate)) {
      return "push-failures";
    }

    if (this.isInactive(referenceDate)) {
      return "inactivity";
    }

    return null;
  }

  private hasRecentPushFailures(referenceDate: Date): boolean {
    const metrics = this.store.getPushDeliveryMetrics();
    const windowStart = referenceDate.getTime() - this.pushFailureWindowHours * MS_IN_HOUR;

    const recentFailure = metrics.recentFailures.some((failure) => new Date(failure.failedAt).getTime() >= windowStart);
    const missingSubscribers = this.store.getPushSubscriptions().length === 0 && metrics.attempted > 0;

    return recentFailure || missingSubscribers;
  }

  private isInactive(referenceDate: Date): boolean {
    const lastInteraction = this.store.getNotificationInteractions({ limit: 1 })[0];

    if (!lastInteraction) {
      return true;
    }

    const lastInteractionTime = new Date(lastInteraction.timestamp).getTime();
    return referenceDate.getTime() - lastInteractionTime >= this.inactivityThresholdHours * MS_IN_HOUR;
  }

  private shouldSendDaily(referenceDate: Date): boolean {
    const last = this.store.getLastEmailDigest("daily");

    if (!last) {
      return true;
    }

    return referenceDate.getTime() - new Date(last.generatedAt).getTime() >= this.dailyCooldownHours * MS_IN_HOUR;
  }

  private shouldSendWeekly(referenceDate: Date): boolean {
    if (referenceDate.getDay() !== 0) {
      return false;
    }

    const last = this.store.getLastEmailDigest("weekly");

    if (!last) {
      return true;
    }

    return referenceDate.getTime() - new Date(last.generatedAt).getTime() >= this.weeklyCooldownDays * MS_IN_DAY;
  }
}

function formatDeadlineLine(deadline: { course: string; task: string; dueDate: string; priority: string }): string {
  return `- ${deadline.task} for ${deadline.course} due ${deadline.dueDate} [${deadline.priority}]`;
}

function formatLectureLine(event: { title: string; startTime: string; durationMinutes: number; workload: string }): string {
  const start = new Date(event.startTime);
  return `- ${event.title} at ${start.toISOString().slice(11, 16)} for ${event.durationMinutes}m (workload ${event.workload})`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max - 3)}...`;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
