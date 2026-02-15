import cors from "cors";
import express from "express";
import { z } from "zod";
import { buildCalendarImportPreview, parseICS } from "./calendar-import.js";
import { config } from "./config.js";
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

const contextSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

const journalEntrySchema = z.object({
  content: z.string().min(1).max(10000)
});

const journalSyncSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string().min(1).optional(),
      clientEntryId: z.string().min(1),
      content: z.string().min(1).max(10000),
      timestamp: z.string().datetime(),
      baseVersion: z.number().int().positive().optional()
    })
  )
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

app.post("/api/journal", (req, res) => {
  const parsed = journalEntrySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid journal entry", issues: parsed.error.issues });
  }

  const entry = store.recordJournalEntry(parsed.data.content);
  return res.json({ entry });
});

app.post("/api/journal/sync", (req, res) => {
  const parsed = journalSyncSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid journal sync payload", issues: parsed.error.issues });
  }

  const result = store.syncJournalEntries(parsed.data.entries);
  return res.status(200).json(result);
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
