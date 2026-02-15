import cors from "cors";
import express from "express";
import { z } from "zod";
import { buildCalendarImportPreview, parseICS } from "./calendar-import.js";
import { config } from "./config.js";
import { generateDeadlineSuggestions } from "./deadline-suggestions.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import { getVapidPublicKey, hasStaticVapidKeys, sendPushNotification } from "./push.js";
import { RuntimeStore } from "./store.js";
import { Notification, NotificationPreferencesPatch } from "./types.js";

const app = express();
const store = new RuntimeStore();
const runtime = new OrchestratorRuntime(store);

runtime.start();

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/dashboard", (_req, res) => {
  res.json(store.getSnapshot());
});

app.get("/api/weekly-review", (req, res) => {
  const referenceDate = typeof req.query.referenceDate === "string" ? req.query.referenceDate : undefined;
  const summary = store.getWeeklySummary(referenceDate);
  return res.json({ summary });
});

app.get("/api/trends", (_req, res) => {
  const trends = store.getContextTrends();
  return res.json({ trends });
});

app.get("/api/export", (_req, res) => {
  const exportData = store.getExportData();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="companion-export.json"');
  return res.json(exportData);
});

// Import validation schemas
const journalImportSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(10000),
  timestamp: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
  clientEntryId: z.string().min(1).optional()
});

const lectureImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"])
});

const deadlineImportSchema = z.object({
  id: z.string().min(1),
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean()
});

const habitImportSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  cadence: z.enum(["daily", "weekly"]),
  targetPerWeek: z.number().int().min(1).max(7),
  motivation: z.string().trim().max(300).optional(),
  createdAt: z.string().datetime()
});

const goalImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  cadence: z.enum(["daily", "weekly"]),
  targetCount: z.number().int().positive(),
  dueDate: z.string().datetime().nullable(),
  motivation: z.string().trim().max(300).optional(),
  createdAt: z.string().datetime()
});

const userContextImportSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const notificationPreferencesImportSchema = z.object({
  quietHours: z.object({
    enabled: z.boolean().optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional()
  }).optional(),
  minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  allowCriticalInQuietHours: z.boolean().optional(),
  categoryToggles: z.record(z.string(), z.boolean()).optional()
});

const importDataSchema = z.object({
  version: z.string().optional(),
  journals: z.array(journalImportSchema).optional(),
  schedule: z.array(lectureImportSchema).optional(),
  deadlines: z.array(deadlineImportSchema).optional(),
  habits: z.array(habitImportSchema).optional(),
  goals: z.array(goalImportSchema).optional(),
  userContext: userContextImportSchema.optional(),
  notificationPreferences: notificationPreferencesImportSchema.optional()
});

app.post("/api/import", (req, res) => {
  const parsed = importDataSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid import data", issues: parsed.error.issues });
  }

  const result = store.importData(parsed.data);
  return res.json(result);
});

const contextSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const tagIdSchema = z.string().trim().min(1);
const tagIdsSchema = z.array(tagIdSchema).max(20);

const journalEntrySchema = z.object({
  content: z.string().min(1).max(10000),
  tags: tagIdsSchema.optional()
});

const journalSyncSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string().min(1).optional(),
      clientEntryId: z.string().min(1),
      content: z.string().min(1).max(10000),
      timestamp: z.string().datetime(),
      baseVersion: z.number().int().positive().optional(),
      tags: tagIdsSchema.optional()
    })
  )
});

const tagCreateSchema = z.object({
  name: z.string().trim().min(1).max(60)
});

const tagUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60)
});

const calendarImportSchema = z
  .object({
    ics: z.string().min(1).optional(),
    url: z.string().url().optional()
  })
  .refine((value) => Boolean(value.ics || value.url), "Either ics or url is required");

const scheduleCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"])
});

const scheduleUpdateSchema = scheduleCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineCreateSchema = z.object({
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean().optional().default(false)
});

const deadlineUpdateSchema = deadlineCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineStatusConfirmSchema = z.object({
  completed: z.boolean()
});

const habitCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  cadence: z.enum(["daily", "weekly"]).default("daily"),
  targetPerWeek: z.number().int().min(1).max(7).default(5),
  motivation: z.string().trim().max(240).optional()
});

const habitCheckInSchema = z.object({
  completed: z.boolean().optional(),
  date: z.string().datetime().optional(),
  note: z.string().trim().max(240).optional()
});

const goalCreateSchema = z.object({
  title: z.string().trim().min(1).max(160),
  cadence: z.enum(["daily", "weekly"]).default("daily"),
  targetCount: z.number().int().min(1).max(365),
  dueDate: z.string().datetime().optional().nullable(),
  motivation: z.string().trim().max(240).optional()
});

const goalCheckInSchema = z.object({
  completed: z.boolean().optional(),
  date: z.string().datetime().optional()
});

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  })
});

const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url()
});

const pushTestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  message: z.string().trim().min(1).max(500).optional(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional()
});

const notificationPreferencesSchema = z.object({
  quietHours: z
    .object({
      enabled: z.boolean().optional(),
      startHour: z.number().int().min(0).max(23).optional(),
      endHour: z.number().int().min(0).max(23).optional()
    })
    .optional(),
  minimumPriority: z.enum(["low", "medium", "high", "critical"]).optional(),
  allowCriticalInQuietHours: z.boolean().optional(),
  categoryToggles: z
    .object({
      notes: z.boolean().optional(),
      "lecture-plan": z.boolean().optional(),
      "assignment-tracker": z.boolean().optional(),
      orchestrator: z.boolean().optional()
    })
    .optional()
});

store.onNotification((notification) => {
  void broadcastNotification(notification);
});

async function broadcastNotification(notification: Notification): Promise<void> {
  if (!store.shouldDispatchNotification(notification)) {
    return;
  }

  const subscriptions = store.getPushSubscriptions();

  if (subscriptions.length === 0) {
    return;
  }

  const deliveryResults = await Promise.all(
    subscriptions.map((subscription) => sendPushNotification(subscription, notification))
  );

  for (let i = 0; i < subscriptions.length; i += 1) {
    const endpoint = subscriptions[i].endpoint;
    const result = deliveryResults[i];

    store.recordPushDeliveryResult(endpoint, notification, result);

    if (result.shouldDropSubscription) {
      store.removePushSubscription(endpoint);
    }
  }
}

app.post("/api/context", (req, res) => {
  const parsed = contextSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid context payload", issues: parsed.error.issues });
  }

  const updated = store.setUserContext(parsed.data);
  return res.json({ context: updated });
});

app.get("/api/tags", (_req, res) => {
  const tags = store.getTags();
  return res.json({ tags });
});

app.post("/api/tags", (req, res) => {
  const parsed = tagCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tag payload", issues: parsed.error.issues });
  }

  try {
    const tag = store.createTag(parsed.data.name);
    return res.status(201).json({ tag });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return res.status(409).json({ error: "Tag name already exists" });
    }

    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to create tag" });
  }
});

app.patch("/api/tags/:id", (req, res) => {
  const parsed = tagUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid tag payload", issues: parsed.error.issues });
  }

  try {
    const tag = store.updateTag(req.params.id, parsed.data.name);

    if (!tag) {
      return res.status(404).json({ error: "Tag not found" });
    }

    return res.json({ tag });
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message)) {
      return res.status(409).json({ error: "Tag name already exists" });
    }

    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to update tag" });
  }
});

app.delete("/api/tags/:id", (req, res) => {
  const deleted = store.deleteTag(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Tag not found" });
  }

  return res.status(204).send();
});

app.post("/api/journal", (req, res) => {
  const parsed = journalEntrySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid journal entry", issues: parsed.error.issues });
  }

  if (!store.areValidTagIds(parsed.data.tags ?? [])) {
    return res.status(400).json({ error: "Invalid tag ids" });
  }

  try {
    const entry = store.recordJournalEntry(parsed.data.content, parsed.data.tags ?? []);
    return res.json({ entry });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to record journal entry" });
  }
});

app.post("/api/journal/sync", (req, res) => {
  const parsed = journalSyncSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid journal sync payload", issues: parsed.error.issues });
  }

  const allTagIds = parsed.data.entries.flatMap((entry) => entry.tags ?? []);
  if (!store.areValidTagIds(allTagIds)) {
    return res.status(400).json({ error: "Invalid tag ids" });
  }

  try {
    const result = store.syncJournalEntries(parsed.data.entries);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unable to sync journal entries" });
  }
});

app.get("/api/journal", (req, res) => {
  const limitParam = req.query.limit;
  const limit = limitParam ? parseInt(limitParam as string, 10) : undefined;

  if (limit !== undefined && (isNaN(limit) || limit <= 0)) {
    return res.status(400).json({ error: "Invalid limit parameter" });
  }

  const entries = store.getJournalEntries(limit);
  return res.json({ entries });
});

app.get("/api/journal/tags", (_req, res) => {
  const tags = store.getTags().map((tag) => tag.name);
  return res.json({ tags });
});

app.get("/api/journal/search", (req, res) => {
  const { q, startDate, endDate, limit } = req.query;
  const tagsParam = req.query.tags;

  const limitValue = limit ? parseInt(limit as string, 10) : undefined;

  if (limitValue !== undefined && (isNaN(limitValue) || limitValue <= 0)) {
    return res.status(400).json({ error: "Invalid limit parameter" });
  }

  if (startDate && typeof startDate === "string" && isNaN(Date.parse(startDate))) {
    return res.status(400).json({ error: "Invalid startDate parameter" });
  }

  if (endDate && typeof endDate === "string" && isNaN(Date.parse(endDate))) {
    return res.status(400).json({ error: "Invalid endDate parameter" });
  }

  const parsedTags =
    typeof tagsParam === "string"
      ? tagsParam.split(",")
      : Array.isArray(tagsParam)
        ? tagsParam
        : [];
  const tagIds = parsedTags.map((tag) => tag.trim()).filter(Boolean);

  if (tagIds.length > 0 && !store.areValidTagIds(tagIds)) {
    return res.status(400).json({ error: "Invalid tag ids" });
  }

  const entries = store.searchJournalEntries({
    query: q as string | undefined,
    startDate: startDate as string | undefined,
    endDate: endDate as string | undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    limit: limitValue
  });

  return res.json({ entries });
});

app.post("/api/calendar/import", async (req, res) => {
  const parsed = calendarImportSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid calendar import payload", issues: parsed.error.issues });
  }

  const icsContent = parsed.data.ics ?? (await fetchCalendarIcs(parsed.data.url!));

  if (!icsContent) {
    return res.status(400).json({ error: "Unable to load ICS content" });
  }

  const preview = buildCalendarImportPreview(parseICS(icsContent));
  const lectures = preview.lectures.map((lecture) => store.createLectureEvent(lecture));
  const deadlines = preview.deadlines.map((deadline) => store.createDeadline(deadline));

  return res.status(201).json({
    importedEvents: preview.importedEvents,
    lecturesCreated: preview.lecturesPlanned,
    deadlinesCreated: preview.deadlinesPlanned,
    lectures,
    deadlines
  });
});

app.post("/api/calendar/import/preview", async (req, res) => {
  const parsed = calendarImportSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid calendar import payload", issues: parsed.error.issues });
  }

  const icsContent = parsed.data.ics ?? (await fetchCalendarIcs(parsed.data.url!));

  if (!icsContent) {
    return res.status(400).json({ error: "Unable to load ICS content" });
  }

  const preview = buildCalendarImportPreview(parseICS(icsContent));

  return res.status(200).json(preview);
});

app.post("/api/schedule", (req, res) => {
  const parsed = scheduleCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.createLectureEvent(parsed.data);
  return res.status(201).json({ lecture });
});

app.get("/api/schedule", (_req, res) => {
  return res.json({ schedule: store.getScheduleEvents() });
});

app.get("/api/schedule/:id", (req, res) => {
  const lecture = store.getScheduleEventById(req.params.id);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.patch("/api/schedule/:id", (req, res) => {
  const parsed = scheduleUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const lecture = store.updateScheduleEvent(req.params.id, parsed.data);

  if (!lecture) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.json({ lecture });
});

app.delete("/api/schedule/:id", (req, res) => {
  const deleted = store.deleteScheduleEvent(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Schedule entry not found" });
  }

  return res.status(204).send();
});

app.post("/api/deadlines", (req, res) => {
  const parsed = deadlineCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.createDeadline(parsed.data);
  return res.status(201).json({ deadline });
});

app.get("/api/deadlines", (_req, res) => {
  return res.json({ deadlines: store.getDeadlines() });
});

app.get("/api/deadlines/:id", (req, res) => {
  const deadline = store.getDeadlineById(req.params.id);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.patch("/api/deadlines/:id", (req, res) => {
  const parsed = deadlineUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.updateDeadline(req.params.id, parsed.data);

  if (!deadline) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.post("/api/deadlines/:id/confirm-status", (req, res) => {
  const parsed = deadlineStatusConfirmSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline status payload", issues: parsed.error.issues });
  }

  const confirmation = store.confirmDeadlineStatus(req.params.id, parsed.data.completed);

  if (!confirmation) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json(confirmation);
});

app.delete("/api/deadlines/:id", (req, res) => {
  const deleted = store.deleteDeadline(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.status(204).send();
});

app.get("/api/deadlines/suggestions", (_req, res) => {
  const deadlines = store.getDeadlines();
  const scheduleEvents = store.getScheduleEvents();
  const userContext = store.getUserContext();
  
  const suggestions = generateDeadlineSuggestions(
    deadlines,
    scheduleEvents,
    userContext,
    new Date()
  );
  
  return res.json({ suggestions });
});

app.get("/api/habits", (_req, res) => {
  return res.json({ habits: store.getHabitsWithStatus() });
});

app.post("/api/habits", (req, res) => {
  const parsed = habitCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit payload", issues: parsed.error.issues });
  }

  const habit = store.createHabit(parsed.data);
  return res.status(201).json({ habit });
});

app.post("/api/habits/:id/check-ins", (req, res) => {
  const parsed = habitCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit check-in payload", issues: parsed.error.issues });
  }

  const habit = store.toggleHabitCheckIn(req.params.id, parsed.data);

  if (!habit) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.json({ habit });
});

app.get("/api/goals", (_req, res) => {
  return res.json({ goals: store.getGoalsWithStatus() });
});

app.post("/api/goals", (req, res) => {
  const parsed = goalCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal payload", issues: parsed.error.issues });
  }

  const goal = store.createGoal({
    ...parsed.data,
    dueDate: parsed.data.dueDate ?? null
  });

  return res.status(201).json({ goal });
});

app.post("/api/goals/:id/check-ins", (req, res) => {
  const parsed = goalCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal check-in payload", issues: parsed.error.issues });
  }

  const goal = store.toggleGoalCheckIn(req.params.id, parsed.data);

  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.json({ goal });
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  return res.json({
    publicKey: getVapidPublicKey(),
    source: hasStaticVapidKeys() ? "configured" : "generated",
    subject: config.AXIS_VAPID_SUBJECT
  });
});

app.get("/api/push/delivery-metrics", (_req, res) => {
  return res.json({ metrics: store.getPushDeliveryMetrics() });
});

app.get("/api/notification-preferences", (_req, res) => {
  return res.json({ preferences: store.getNotificationPreferences() });
});

app.put("/api/notification-preferences", (req, res) => {
  const parsed = notificationPreferencesSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid notification preferences payload", issues: parsed.error.issues });
  }

  const next = parsed.data as NotificationPreferencesPatch;
  const preferences = store.setNotificationPreferences(next);
  return res.json({ preferences });
});

const notificationInteractionSchema = z.object({
  notificationId: z.string().min(1),
  notificationTitle: z.string().min(1),
  notificationSource: z.enum(["notes", "lecture-plan", "assignment-tracker", "orchestrator"]),
  notificationPriority: z.enum(["low", "medium", "high", "critical"]),
  interactionType: z.enum(["tap", "dismiss", "action"]),
  actionType: z.string().optional(),
  timeToInteractionMs: z.number().int().min(0).optional()
});

app.post("/api/notification-interactions", (req, res) => {
  const parsed = notificationInteractionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid notification interaction payload", issues: parsed.error.issues });
  }

  const interaction = store.recordNotificationInteraction(
    parsed.data.notificationId,
    parsed.data.notificationTitle,
    parsed.data.notificationSource,
    parsed.data.notificationPriority,
    parsed.data.interactionType,
    parsed.data.actionType,
    parsed.data.timeToInteractionMs
  );

  return res.status(201).json({ interaction });
});

app.get("/api/notification-interactions", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const until = typeof req.query.until === "string" ? req.query.until : undefined;
  const limit = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : undefined;

  const interactions = store.getNotificationInteractions({ since, until, limit });
  return res.json({ interactions });
});

app.get("/api/notification-interactions/metrics", (req, res) => {
  const since = typeof req.query.since === "string" ? req.query.since : undefined;
  const until = typeof req.query.until === "string" ? req.query.until : undefined;

  const metrics = store.getNotificationInteractionMetrics({ since, until });
  return res.json({ metrics });
});

app.post("/api/push/subscribe", (req, res) => {
  const parsed = pushSubscriptionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push subscription payload", issues: parsed.error.issues });
  }

  const subscription = store.addPushSubscription(parsed.data);
  return res.status(201).json({ subscription });
});

app.post("/api/push/unsubscribe", (req, res) => {
  const parsed = pushUnsubscribeSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid unsubscribe payload", issues: parsed.error.issues });
  }

  const removed = store.removePushSubscription(parsed.data.endpoint);

  if (!removed) {
    return res.status(404).json({ error: "Push subscription not found" });
  }

  return res.status(204).send();
});

app.post("/api/push/test", (req, res) => {
  const parsed = pushTestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid push test payload", issues: parsed.error.issues });
  }

  store.pushNotification({
    source: "orchestrator",
    title: parsed.data.title ?? "Companion test push",
    message: parsed.data.message ?? "Push notifications are connected and ready.",
    priority: parsed.data.priority ?? "medium"
  });

  return res.status(202).json({ queued: true, subscribers: store.getPushSubscriptions().length });
});

async function fetchCalendarIcs(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

const server = app.listen(config.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[axis-server] listening on http://localhost:${config.PORT}`);
});

const shutdown = (): void => {
  runtime.stop();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
