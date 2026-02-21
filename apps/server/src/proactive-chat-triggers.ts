import { buildChatContext } from "./chat.js";
import { buildContextWindow, buildSystemPrompt, getGeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { Deadline, LectureEvent, Notification, UserContext } from "./types.js";

/**
 * Proactive chat trigger types
 */
export type ProactiveTriggerType =
  | "morning-briefing"
  | "schedule-gap"
  | "deadline-approaching"
  | "post-lecture"
  | "evening-reflection"
  | "new-email";

export interface ProactiveTrigger {
  type: ProactiveTriggerType;
  priority: "low" | "medium" | "high" | "critical";
  shouldFire: (context: TriggerContext) => boolean;
  generateMessage: (context: TriggerContext) => Promise<string>;
}

export interface TriggerContext {
  store: RuntimeStore;
  userId: string;
  now: Date;
  todaySchedule: LectureEvent[];
  upcomingDeadlines: Deadline[];
  userContext: UserContext;
}

/**
 * Check if it's a specific hour of the day (in local time)
 */
function isHour(date: Date, targetHour: number): boolean {
  const hour = date.getHours();
  return hour === targetHour;
}

/**
 * Check if we're within a time window (start hour to end hour)
 */
function isWithinHours(date: Date, startHour: number, endHour: number): boolean {
  const hour = date.getHours();
  return hour >= startHour && hour < endHour;
}

let lastUnreadEmailSignature = new WeakMap<RuntimeStore, string>();

function buildUnreadEmailSignature(store: RuntimeStore, userId: string): string {
  const gmailData = store.getGmailData(userId);
  const unread = gmailData.messages
    .filter((message) => !message.isRead)
    .slice()
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));

  if (unread.length === 0) {
    return "none";
  }

  const topIds = unread.slice(0, 10).map((message) => message.id).join(",");
  return `${unread.length}|${topIds}|${gmailData.lastSyncedAt ?? "unknown"}`;
}

function hasUnreadEmailDelta(store: RuntimeStore, userId: string): boolean {
  const signature = buildUnreadEmailSignature(store, userId);
  const previous = lastUnreadEmailSignature.get(store);
  return signature !== "none" && signature !== previous;
}

/**
 * Find schedule gaps (> 2 hours between events)
 */
function findScheduleGaps(schedule: LectureEvent[], now: Date): LectureEvent[] | null {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const todayEvents = schedule
    .filter((event) => {
      const eventDate = new Date(event.startTime);
      return eventDate >= today && eventDate < new Date(today.getTime() + 24 * 60 * 60 * 1000);
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (todayEvents.length < 2) {
    return null;
  }

  // Find gaps > 2 hours
  for (let i = 0; i < todayEvents.length - 1; i++) {
    const currentEnd = new Date(todayEvents[i].startTime).getTime() + todayEvents[i].durationMinutes * 60 * 1000;
    const nextStart = new Date(todayEvents[i + 1].startTime).getTime();
    const gapHours = (nextStart - currentEnd) / (1000 * 60 * 60);

    if (gapHours >= 2 && now.getTime() >= currentEnd && now.getTime() < nextStart) {
      return [todayEvents[i], todayEvents[i + 1]];
    }
  }

  return null;
}

/**
 * Find deadlines approaching within 48 hours
 */
function findApproachingDeadlines(deadlines: Deadline[], now: Date): Deadline[] {
  return deadlines.filter((deadline) => {
    if (deadline.completed) {
      return false;
    }

    const dueDate = new Date(deadline.dueDate);
    const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    return hoursUntilDue > 0 && hoursUntilDue <= 48;
  });
}

/**
 * Find recently completed lectures (within last hour)
 */
function findRecentlyCompletedLectures(schedule: LectureEvent[], now: Date): LectureEvent | null {
  for (const event of schedule) {
    const eventStart = new Date(event.startTime);
    const eventEnd = new Date(eventStart.getTime() + event.durationMinutes * 60 * 1000);

    // Check if lecture ended within the last hour
    const hoursSinceEnd = (now.getTime() - eventEnd.getTime()) / (1000 * 60 * 60);

    if (hoursSinceEnd >= 0 && hoursSinceEnd <= 1) {
      return event;
    }
  }

  return null;
}

/**
 * Generate a proactive AI message using Gemini
 */
async function generateProactiveMessage(
  store: RuntimeStore,
  userId: string,
  triggerType: ProactiveTriggerType,
  specificContext: string,
  now: Date
): Promise<string> {
  const gemini = getGeminiClient();
  const { contextWindow } = buildChatContext(store, userId, now, 5);

  const promptMap: Record<ProactiveTriggerType, string> = {
    "morning-briefing": `Generate a brief, encouraging morning briefing for the user. Include their schedule for today and any urgent deadlines. Keep it conversational, positive, and helpful. 2-3 sentences max. ${specificContext}`,
    "schedule-gap": `The user has a gap in their schedule. Suggest how they might use this time productively (work on assignments, review notes, take a break). Be encouraging but not pushy. 2-3 sentences. ${specificContext}`,
    "deadline-approaching": `A deadline is approaching soon (within 48 hours). Gently remind them and offer to help with planning or motivation. Don't be alarmist. 2-3 sentences. ${specificContext}`,
    "post-lecture": `The user just finished a lecture. Check in on how it went and offer to help review concepts or plan next steps. Be friendly and supportive. 2-3 sentences. ${specificContext}`,
    "evening-reflection": `It's evening. Invite the user to reflect on their day. Ask about accomplishments, challenges, or how they're feeling. Be warm and conversational. 2-3 sentences. ${specificContext}`,
    "new-email": `The user received new unread email(s). Give a concise inbox update and mention key senders/subjects. Offer one helpful next step. Keep it clear and conversational. 2-3 sentences. ${specificContext}`
  };

  const prompt = promptMap[triggerType];
  const systemInstruction = buildSystemPrompt("companion user", contextWindow);

  try {
    const response = await gemini.generateChatResponse({
      messages: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction
    });

    return response.text;
  } catch (error) {
    // Fallback to a generic message if Gemini fails
    const fallbacks: Record<ProactiveTriggerType, string> = {
      "morning-briefing": "Good morning! Ready to tackle today? Let me know if you want to review your schedule or deadlines.",
      "schedule-gap": "You've got some free time coming up. Want to work on an assignment or take a breather?",
      "deadline-approaching": "Just a heads up — you have a deadline coming up soon. Need help planning your work time?",
      "post-lecture": "How was the lecture? I'm here if you want to discuss any concepts or plan next steps.",
      "evening-reflection": "How was your day? I'd love to hear about what you accomplished or what's on your mind.",
      "new-email": "You have new unread email. Want me to summarize the important ones?"
    };

    return fallbacks[triggerType];
  }
}

/**
 * Morning briefing trigger (8am)
 */
const morningBriefingTrigger: ProactiveTrigger = {
  type: "morning-briefing",
  priority: "medium",
  shouldFire: (context) => {
    return isHour(context.now, 8);
  },
  generateMessage: async (context) => {
    const scheduleCount = context.todaySchedule.length;
    const deadlineCount = context.upcomingDeadlines.filter((d) => !d.completed).length;

    const specificContext = `Today's schedule: ${scheduleCount} lectures/events. Upcoming deadlines: ${deadlineCount}.`;

    return generateProactiveMessage(context.store, context.userId, "morning-briefing", specificContext, context.now);
  }
};

/**
 * Schedule gap trigger (2+ hour gap between classes)
 */
const scheduleGapTrigger: ProactiveTrigger = {
  type: "schedule-gap",
  priority: "low",
  shouldFire: (context) => {
    const gap = findScheduleGaps(context.todaySchedule, context.now);
    return gap !== null;
  },
  generateMessage: async (context) => {
    const gap = findScheduleGaps(context.todaySchedule, context.now);
    if (!gap) {
      return "You have some free time. How would you like to use it?";
    }

    const [before, after] = gap;
    const beforeTitle = before.title.split(" ")[0]; // e.g., "DAT520"
    const afterTitle = after.title.split(" ")[0];

    const specificContext = `Gap between ${beforeTitle} and ${afterTitle}. User might want to work on assignments or review material.`;

    return generateProactiveMessage(context.store, context.userId, "schedule-gap", specificContext, context.now);
  }
};

/**
 * Deadline approaching trigger (<48h until due)
 */
const deadlineApproachingTrigger: ProactiveTrigger = {
  type: "deadline-approaching",
  priority: "high",
  shouldFire: (context) => {
    const approaching = findApproachingDeadlines(context.upcomingDeadlines, context.now);
    return approaching.length > 0;
  },
  generateMessage: async (context) => {
    const approaching = findApproachingDeadlines(context.upcomingDeadlines, context.now);
    if (approaching.length === 0) {
      return "You have deadlines coming up. Let me know if you need help planning your time.";
    }

    const deadline = approaching[0];
    const hoursLeft = Math.floor((new Date(deadline.dueDate).getTime() - context.now.getTime()) / (1000 * 60 * 60));

    const specificContext = `Deadline: ${deadline.task} for ${deadline.course} is due in ${hoursLeft} hours. Priority: ${deadline.priority}.`;

    return generateProactiveMessage(context.store, context.userId, "deadline-approaching", specificContext, context.now);
  }
};

/**
 * Post-lecture check-in trigger (within 1 hour after lecture ends)
 */
const postLectureTrigger: ProactiveTrigger = {
  type: "post-lecture",
  priority: "low",
  shouldFire: (context) => {
    const recentLecture = findRecentlyCompletedLectures(context.todaySchedule, context.now);
    return recentLecture !== null;
  },
  generateMessage: async (context) => {
    const recentLecture = findRecentlyCompletedLectures(context.todaySchedule, context.now);
    if (!recentLecture) {
      return "How was your recent class? I'm here if you want to discuss anything.";
    }

    const specificContext = `Just finished: ${recentLecture.title}. Check in about understanding, next steps, or how it went.`;

    return generateProactiveMessage(context.store, context.userId, "post-lecture", specificContext, context.now);
  }
};

/**
 * Evening reflection trigger (8pm-10pm)
 */
const eveningReflectionTrigger: ProactiveTrigger = {
  type: "evening-reflection",
  priority: "low",
  shouldFire: (context) => {
    return isWithinHours(context.now, 20, 22);
  },
  generateMessage: async (context) => {
    const todayDeadlines = context.upcomingDeadlines.filter((d) => {
      const dueDate = new Date(d.dueDate);
      return dueDate.toDateString() === context.now.toDateString() && d.completed;
    });

    const specificContext = `End of day. Completed ${todayDeadlines.length} deadlines today. Encourage reflection.`;

    return generateProactiveMessage(context.store, context.userId, "evening-reflection", specificContext, context.now);
  }
};

/**
 * New unread email trigger
 */
const newEmailTrigger: ProactiveTrigger = {
  type: "new-email",
  priority: "medium",
  shouldFire: (context) => {
    return hasUnreadEmailDelta(context.store, context.userId);
  },
  generateMessage: async (context) => {
    const gmailData = context.store.getGmailData(context.userId);
    const unread = gmailData.messages
      .filter((message) => !message.isRead)
      .slice()
      .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt));
    const newest = unread[0];
    const sender = newest?.from ?? "unknown sender";
    const subject = newest?.subject ?? "no subject";
    const specificContext = `Unread emails: ${unread.length}. Newest unread from ${sender} with subject "${subject}". Last Gmail sync: ${gmailData.lastSyncedAt ?? "unknown"}.`;
    const message = await generateProactiveMessage(context.store, context.userId, "new-email", specificContext, context.now);
    lastUnreadEmailSignature.set(context.store, buildUnreadEmailSignature(context.store, context.userId));
    return message;
  }
};

/**
 * All available proactive triggers
 */
export const ALL_TRIGGERS: ProactiveTrigger[] = [
  morningBriefingTrigger,
  scheduleGapTrigger,
  deadlineApproachingTrigger,
  postLectureTrigger,
  eveningReflectionTrigger,
  newEmailTrigger
];

/**
 * Check all triggers and generate notifications for those that should fire
 */
export async function checkProactiveTriggers(store: RuntimeStore, userId: string, now: Date = new Date()): Promise<Notification[]> {
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const todaySchedule = store
    .getScheduleEvents(userId)
    .filter((event) => {
      const eventDate = new Date(event.startTime);
      return eventDate >= todayStart && eventDate < todayEnd;
    });

  const upcomingDeadlines = store
    .getAcademicDeadlines(userId, now)
    .filter((deadline) => {
      const dueDate = new Date(deadline.dueDate);
      return dueDate.getTime() > now.getTime();
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  const userContext = store.getUserContext(userId);

  const context: TriggerContext = {
    store,
    userId,
    now,
    todaySchedule,
    upcomingDeadlines,
    userContext
  };

  const notifications: Notification[] = [];

  for (const trigger of ALL_TRIGGERS) {
    if (trigger.shouldFire(context)) {
      try {
        const message = await trigger.generateMessage(context);

        notifications.push({
          id: `proactive-${trigger.type}-${Date.now()}`,
          title: getTriggerTitle(trigger.type),
          message,
          priority: trigger.priority,
          source: "orchestrator",
          timestamp: now.toISOString(),
          metadata: {
            triggerType: trigger.type,
            isProactive: true
          },
          actions: ["view"],
          url: getTriggerDeepLink(trigger.type)
        });
      } catch (error) {
        // Log error but continue with other triggers
        console.error(`Failed to generate message for trigger ${trigger.type}:`, error);
      }
    }
  }

  return notifications;
}

/**
 * Get a user-friendly title for each trigger type
 */
function getTriggerTitle(type: ProactiveTriggerType): string {
  const titles: Record<ProactiveTriggerType, string> = {
    "morning-briefing": "Good morning!",
    "schedule-gap": "Free time ahead",
    "deadline-approaching": "Deadline reminder",
    "post-lecture": "How was class?",
    "evening-reflection": "Evening check-in",
    "new-email": "New email"
  };

  return titles[type];
}

function getTriggerDeepLink(type: ProactiveTriggerType): string {
  if (type === "evening-reflection") {
    return "/companion/?tab=settings&section=weekly-review";
  }

  if (type === "new-email") {
    return "/companion/?tab=chat";
  }

  return "/companion/?tab=chat";
}

/**
 * Track when triggers last fired to avoid spamming
 */
const triggerCooldowns = new Map<ProactiveTriggerType, number>();
const triggerCooldownMinutes: Record<ProactiveTriggerType, number> = {
  "morning-briefing": 60,
  "schedule-gap": 60,
  "deadline-approaching": 60,
  "post-lecture": 60,
  "evening-reflection": 60,
  "new-email": 0
};

/**
 * Check if a trigger is on cooldown (prevents firing too frequently)
 */
export function isTriggerOnCooldown(type: ProactiveTriggerType, cooldownMinutes = 60): boolean {
  const lastFired = triggerCooldowns.get(type);
  if (!lastFired) {
    return false;
  }

  const now = Date.now();
  const minutesSinceFired = (now - lastFired) / (1000 * 60);

  return minutesSinceFired < cooldownMinutes;
}

/**
 * Mark a trigger as fired (starts cooldown)
 */
export function markTriggerFired(type: ProactiveTriggerType): void {
  triggerCooldowns.set(type, Date.now());
}

/**
 * Clear all trigger cooldowns (useful for testing)
 */
export function clearTriggerCooldowns(): void {
  triggerCooldowns.clear();
  lastUnreadEmailSignature = new WeakMap<RuntimeStore, string>();
}

/**
 * Check proactive triggers with cooldown logic
 */
export async function checkProactiveTriggersWithCooldown(
  store: RuntimeStore,
  userId: string,
  now: Date = new Date()
): Promise<Notification[]> {
  const allNotifications = await checkProactiveTriggers(store, userId, now);

  // Filter out triggers that are on cooldown
  const filtered = allNotifications.filter((notification) => {
    const triggerType = notification.metadata?.triggerType as ProactiveTriggerType;
    if (!triggerType) {
      return true;
    }

    if (isTriggerOnCooldown(triggerType, triggerCooldownMinutes[triggerType])) {
      return false;
    }

    markTriggerFired(triggerType);
    return true;
  });

  return filtered;
}
