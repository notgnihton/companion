import cors from "cors";
import express from "express";
import { resolve } from "path";
import { z } from "zod";
import { BackgroundSyncService } from "./background-sync.js";
import { buildCalendarImportPreview, parseICS } from "./calendar-import.js";
import { config } from "./config.js";
import { buildDeadlineDedupResult } from "./deadline-dedup.js";
import { isAssignmentOrExamDeadline } from "./deadline-eligibility.js";
import { generateDeadlineSuggestions } from "./deadline-suggestions.js";
import { executePendingChatAction } from "./gemini-tools.js";
import {
  createIntegrationDateWindow,
  filterCanvasAssignmentsByDateWindow,
  filterTPEventsByDateWindow
} from "./integration-date-window.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import { EmailDigestService } from "./email-digest.js";
import { getVapidPublicKey, hasStaticVapidKeys, sendPushNotification } from "./push.js";
import { sendChatMessage, GeminiError, RateLimitError } from "./chat.js";
import { getGeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { fetchTPSchedule, diffScheduleEvents } from "./tp-sync.js";
import { TPSyncService } from "./tp-sync-service.js";
import { CanvasSyncService } from "./canvas-sync.js";
import { GitHubCourseSyncService } from "./github-course-sync.js";
import { YouTubeSyncService } from "./youtube-sync.js";
import { XSyncService } from "./x-sync.js";
import { SocialMediaSummarizer } from "./social-media-summarizer.js";
import { GmailOAuthService } from "./gmail-oauth.js";
import { GmailSyncService } from "./gmail-sync.js";
import { buildStudyPlanCalendarIcs } from "./study-plan-export.js";
import { generateWeeklyStudyPlan } from "./study-plan.js";
import { generateContentRecommendations } from "./content-recommendations.js";
import { generateDailyJournalSummary } from "./daily-journal-summary.js";
import { generateAnalyticsCoachInsight } from "./analytics-coach.js";
import { PostgresRuntimeSnapshotStore } from "./postgres-persistence.js";
import type { PostgresPersistenceDiagnostics } from "./postgres-persistence.js";
import { Notification, NotificationPreferencesPatch } from "./types.js";
import type { Goal, Habit, IntegrationSyncName, IntegrationSyncRootCause } from "./types.js";
import { SyncFailureRecoveryTracker, SyncRecoveryPrompt } from "./sync-failure-recovery.js";
import { nowIso } from "./utils.js";

const app = express();

interface RuntimePersistenceContext {
  store: RuntimeStore;
  sqlitePath: string;
  backend: "sqlite" | "postgres-snapshot";
  postgresSnapshotStore: PostgresRuntimeSnapshotStore | null;
  restoredSnapshotAt: string | null;
}

function fallbackStorageDiagnostics(sqlitePath: string): PostgresPersistenceDiagnostics {
  return {
    backend: "sqlite",
    sqlitePath: resolve(sqlitePath),
    snapshotRestoredAt: null,
    snapshotPersistedAt: null,
    snapshotSizeBytes: 0,
    lastError: null
  };
}

async function initializeRuntimeStore(): Promise<RuntimePersistenceContext> {
  const sqlitePath = config.SQLITE_DB_PATH;
  const postgresUrl = config.DATABASE_URL;

  if (!postgresUrl) {
    return {
      store: new RuntimeStore(sqlitePath),
      sqlitePath,
      backend: "sqlite",
      postgresSnapshotStore: null,
      restoredSnapshotAt: null
    };
  }

  const postgresSnapshotStore = new PostgresRuntimeSnapshotStore(postgresUrl);
  await postgresSnapshotStore.initialize();
  const restoreResult = await postgresSnapshotStore.restoreToSqliteFile(sqlitePath);
  const store = new RuntimeStore(sqlitePath);

  await postgresSnapshotStore.persistSnapshot(store.serializeDatabase());
  postgresSnapshotStore.startAutoSync(() => store.serializeDatabase(), 30_000);

  return {
    store,
    sqlitePath,
    backend: "postgres-snapshot",
    postgresSnapshotStore,
    restoredSnapshotAt: restoreResult.updatedAt
  };
}

const persistenceContext = await initializeRuntimeStore();
const store = persistenceContext.store;
const prunedNonAcademicDeadlines = store.purgeNonAcademicDeadlines();
if (prunedNonAcademicDeadlines > 0) {
  if (persistenceContext.postgresSnapshotStore) {
    await persistenceContext.postgresSnapshotStore.persistSnapshot(store.serializeDatabase());
  }
  console.info(`[startup] Removed ${prunedNonAcademicDeadlines} non-assignment deadline entries.`);
}
const storageDiagnostics = (): PostgresPersistenceDiagnostics =>
  persistenceContext.postgresSnapshotStore
    ? persistenceContext.postgresSnapshotStore.getDiagnostics(persistenceContext.sqlitePath)
    : fallbackStorageDiagnostics(persistenceContext.sqlitePath);

const runtime = new OrchestratorRuntime(store);
const syncService = new BackgroundSyncService(store);
const digestService = new EmailDigestService(store);
const tpSyncService = new TPSyncService(store);
const canvasSyncService = new CanvasSyncService(store);
const githubCourseSyncService = new GitHubCourseSyncService(store);
const youtubeSyncService = new YouTubeSyncService(store);
const xSyncService = new XSyncService(store);
const gmailOAuthService = new GmailOAuthService(store);
const gmailSyncService = new GmailSyncService(store, gmailOAuthService);
const syncFailureRecovery = new SyncFailureRecoveryTracker();
const GITHUB_ON_DEMAND_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
const GITHUB_ON_DEMAND_SYNC_STALE_MS = 6 * 60 * 60 * 1000;
let githubOnDemandSyncInFlight: Promise<void> | null = null;
let lastGithubOnDemandSyncAt = 0;

runtime.start();
syncService.start();
digestService.start();
tpSyncService.start();
canvasSyncService.start();
githubCourseSyncService.start();
youtubeSyncService.start();
xSyncService.start();
gmailSyncService.start();

async function maybeAutoSyncGitHubDeadlines(): Promise<void> {
  if (!githubCourseSyncService.isConfigured()) {
    return;
  }

  const githubData = store.getGitHubCourseData();
  const now = Date.now();
  const lastSyncedAtMs = githubData?.lastSyncedAt ? Date.parse(githubData.lastSyncedAt) : Number.NaN;
  const isStale = !Number.isFinite(lastSyncedAtMs) || now - lastSyncedAtMs >= GITHUB_ON_DEMAND_SYNC_STALE_MS;

  if (!isStale) {
    return;
  }

  if (githubOnDemandSyncInFlight) {
    await githubOnDemandSyncInFlight;
    return;
  }

  if (now - lastGithubOnDemandSyncAt < GITHUB_ON_DEMAND_SYNC_MIN_INTERVAL_MS) {
    return;
  }

  lastGithubOnDemandSyncAt = now;
  githubOnDemandSyncInFlight = (async () => {
    try {
      await githubCourseSyncService.sync();
    } catch {
      // Keep deadline responses resilient even if upstream sync fails.
    } finally {
      githubOnDemandSyncInFlight = null;
    }
  })();

  await githubOnDemandSyncInFlight;
}

function publishSyncRecoveryPrompt(prompt: SyncRecoveryPrompt | null): void {
  if (!prompt) {
    return;
  }

  const details = [prompt.rootCauseHint, ...prompt.suggestedActions.slice(0, 2)].join(" ");
  store.pushNotification({
    source: "orchestrator",
    title: prompt.title,
    message: `${prompt.message} ${details}`.trim(),
    priority: prompt.severity === "high" ? "high" : "medium",
    url: "/companion/?tab=settings&section=integrations",
    metadata: {
      integration: prompt.integration,
      failureCount: prompt.failureCount,
      rootCauseHint: prompt.rootCauseHint,
      suggestedActions: prompt.suggestedActions
    }
  });
}

function categorizeSyncRootCause(message: string | undefined): IntegrationSyncRootCause {
  if (!message) {
    return "unknown";
  }

  const text = message.toLowerCase();
  if (/(unauthor|forbidden|oauth|token|credential|permission|401|403)/.test(text)) {
    return "auth";
  }
  if (/(rate limit|quota|resource exhausted|429)/.test(text)) {
    return "rate_limit";
  }
  if (/(timeout|network|socket|econn|enotfound|dns|fetch failed|connect)/.test(text)) {
    return "network";
  }
  if (/(invalid|validation|zod|schema|payload|400 bad request)/.test(text)) {
    return "validation";
  }
  if (/(provider|upstream|internal|5\\d\\d)/.test(text)) {
    return "provider";
  }

  return "unknown";
}

function recordIntegrationAttempt(
  integration: IntegrationSyncName,
  startedAtMs: number,
  success: boolean,
  errorMessage?: string
): void {
  store.recordIntegrationSyncAttempt({
    integration,
    status: success ? "success" : "failure",
    latencyMs: Math.max(0, Date.now() - startedAtMs),
    rootCause: success ? "none" : categorizeSyncRootCause(errorMessage),
    errorMessage: success ? null : errorMessage ?? null,
    attemptedAt: nowIso()
  });
}

app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    storage: storageDiagnostics()
  });
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

app.get("/api/analytics/coach", async (req, res) => {
  const parsed = analyticsCoachQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid analytics coach query", issues: parsed.error.issues });
  }

  const insight = await generateAnalyticsCoachInsight(store, {
    periodDays: parsed.data.periodDays
  });

  return res.json({ insight });
});

app.post("/api/chat", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat payload", issues: parsed.error.issues });
  }

  try {
    const result = await sendChatMessage(store, parsed.data.message.trim(), {
      attachments: parsed.data.attachments
    });
    return res.json({
      reply: result.reply,
      message: result.assistantMessage,
      userMessage: result.userMessage,
      finishReason: result.finishReason,
      usage: result.usage,
      citations: result.citations,
      history: result.history
    });
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(429).json({ error: error.message });
    }
    if (error instanceof GeminiError) {
      return res.status(error.statusCode ?? 500).json({ error: error.message });
    }

    return res.status(500).json({ error: "Chat request failed" });
  }
});

app.get("/api/chat/history", (req, res) => {
  const parsed = chatHistoryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid history query", issues: parsed.error.issues });
  }

  const history = store.getChatHistory({
    page: parsed.data.page ?? 1,
    pageSize: parsed.data.pageSize ?? 20
  });

  return res.json({ history });
});

app.get("/api/chat/actions/pending", (_req, res) => {
  return res.json({ actions: store.getPendingChatActions() });
});

app.post("/api/chat/actions/:id/confirm", (req, res) => {
  const pendingAction = store.getPendingChatActionById(req.params.id);

  if (!pendingAction) {
    return res.status(404).json({ error: "Pending chat action not found" });
  }

  const result = executePendingChatAction(pendingAction, store);
  store.deletePendingChatAction(pendingAction.id);

  return res.json({
    result,
    pendingActions: store.getPendingChatActions()
  });
});

app.post("/api/chat/actions/:id/cancel", (req, res) => {
  const pendingAction = store.getPendingChatActionById(req.params.id);

  if (!pendingAction) {
    return res.status(404).json({ error: "Pending chat action not found" });
  }

  store.deletePendingChatAction(pendingAction.id);

  return res.json({
    actionId: pendingAction.id,
    cancelled: true,
    pendingActions: store.getPendingChatActions()
  });
});

app.get("/api/export", (_req, res) => {
  const exportData = store.getExportData();
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", 'attachment; filename="companion-export.json"');
  return res.json(exportData);
});

const journalPhotoSchema = z.object({
  id: z.string().min(1).optional(),
  dataUrl: z.string().min(1),
  fileName: z.string().trim().min(1).max(240).optional()
});

// Import validation schemas
const recurrenceRuleSchema = z.object({
  frequency: z.enum(["daily", "weekly", "monthly"]),
  interval: z.number().int().positive().max(365).optional(),
  count: z.number().int().positive().max(365).optional(),
  until: z.string().datetime().optional(),
  byWeekDay: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  byMonthDay: z.number().int().min(1).max(31).optional()
}).refine(
  (data) => {
    if (data.count !== undefined && data.until !== undefined) {
      return false;
    }
    return true;
  },
  { message: "Cannot specify both count and until" }
);

const journalImportSchema = z.object({
  id: z.string().min(1),
  content: z.string().min(1).max(10000),
  timestamp: z.string().datetime(),
  updatedAt: z.string().datetime(),
  version: z.number().int().positive(),
  clientEntryId: z.string().min(1).optional(),
  photos: z.array(journalPhotoSchema).optional()
});

const lectureImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  startTime: z.string().datetime(),
  durationMinutes: z.number().int().positive().max(24 * 60),
  workload: z.enum(["low", "medium", "high"]),
  recurrence: recurrenceRuleSchema.optional(),
  recurrenceParentId: z.string().min(1).optional()
});

const deadlineImportSchema = z.object({
  id: z.string().min(1),
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean(),
  effortHoursRemaining: z.number().min(0).max(200).optional(),
  effortConfidence: z.enum(["low", "medium", "high"]).optional()
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

const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 1_500_000;
const chatImageAttachmentSchema = z.object({
  id: z.string().trim().min(1).max(120),
  dataUrl: z.string().trim().startsWith("data:image/").max(MAX_CHAT_IMAGE_DATA_URL_LENGTH),
  mimeType: z.string().trim().min(1).max(120).optional(),
  fileName: z.string().trim().min(1).max(240).optional()
});

const chatRequestSchema = z.object({
  message: z.string().max(4000).default(""),
  attachments: z.array(chatImageAttachmentSchema).max(3).optional()
}).refine(
  (payload) => payload.message.trim().length > 0 || (payload.attachments?.length ?? 0) > 0,
  {
    message: "Either message text or at least one image attachment is required.",
    path: ["message"]
  }
);

const chatHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
});

const analyticsCoachQuerySchema = z
  .object({
    periodDays: z.coerce.number().int().optional()
  })
  .refine(
    (payload) => payload.periodDays === undefined || payload.periodDays === 7 || payload.periodDays === 14 || payload.periodDays === 30,
    {
      message: "periodDays must be one of 7, 14, or 30",
      path: ["periodDays"]
    }
  );

const tagIdSchema = z.string().trim().min(1);
const tagIdsSchema = z.array(tagIdSchema).max(20);

const journalEntrySchema = z.object({
  content: z.string().min(1).max(10000),
  tags: tagIdsSchema.optional(),
  photos: z.array(journalPhotoSchema).max(5).optional()
});

const journalSyncSchema = z.object({
  entries: z.array(
    z.object({
      id: z.string().min(1).optional(),
      clientEntryId: z.string().min(1),
      content: z.string().min(1).max(10000),
      timestamp: z.string().datetime(),
      baseVersion: z.number().int().positive().optional(),
      tags: tagIdsSchema.optional(),
      photos: z.array(journalPhotoSchema).max(5).optional()
    })
  )
});

const journalDailySummaryQuerySchema = z.object({
  date: z.string().trim().optional()
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
  workload: z.enum(["low", "medium", "high"]),
  recurrence: recurrenceRuleSchema.optional(),
  recurrenceParentId: z.string().min(1).optional()
});

const scheduleUpdateSchema = scheduleCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const deadlineBaseSchema = z.object({
  course: z.string().trim().min(1).max(200),
  task: z.string().trim().min(1).max(300),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean().optional().default(false),
  effortHoursRemaining: z.number().min(0).max(200).optional(),
  effortConfidence: z.enum(["low", "medium", "high"]).optional()
});

const deadlineCreateSchema = deadlineBaseSchema
  .refine(
    (value) =>
      isAssignmentOrExamDeadline({
        course: value.course,
        task: value.task,
        canvasAssignmentId: undefined
      }),
    "Deadlines must be assignment or exam work."
  );

const deadlineUpdateSchema = deadlineBaseSchema.partial().refine(
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

const habitUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    cadence: z.enum(["daily", "weekly"]).optional(),
    targetPerWeek: z.number().int().min(1).max(7).optional(),
    motivation: z.string().trim().max(240).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

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

const goalUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    cadence: z.enum(["daily", "weekly"]).optional(),
    targetCount: z.number().int().min(1).max(365).optional(),
    dueDate: z.string().datetime().nullable().optional(),
    motivation: z.string().trim().max(240).nullable().optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

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

const canvasSyncSchema = z.object({
  token: z.string().trim().min(1).optional(),
  baseUrl: z.string().url().optional(),
  courseIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const tpSyncSchema = z.object({
  semester: z.string().trim().min(1).max(16).optional(),
  courseIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const integrationScopePreviewSchema = z.object({
  semester: z.string().trim().min(1).max(16).optional(),
  tpCourseIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
  canvasCourseIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const integrationHealthLogQuerySchema = z.object({
  integration: z.enum(["tp", "canvas", "gmail"]).optional(),
  status: z.enum(["success", "failure"]).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional().default(200),
  hours: z.coerce.number().int().min(1).max(24 * 365).optional()
});

const integrationHealthSummaryQuerySchema = z.object({
  hours: z.coerce.number().int().min(1).max(24 * 365).optional().default(24 * 7)
});

const DEFAULT_TP_SCOPE_COURSE_IDS = ["DAT520,1", "DAT560,1", "DAT600,1"] as const;

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

const studyPlanGenerateSchema = z
  .object({
    horizonDays: z.number().int().min(1).max(14).optional().default(7),
    minSessionMinutes: z.number().int().min(30).max(180).optional().default(45),
    maxSessionMinutes: z.number().int().min(45).max(240).optional().default(120)
  })
  .refine((value) => value.maxSessionMinutes >= value.minSessionMinutes, {
    message: "maxSessionMinutes must be greater than or equal to minSessionMinutes"
  });

const studyPlanExportQuerySchema = z
  .object({
    horizonDays: z.coerce.number().int().min(1).max(14).optional().default(7),
    minSessionMinutes: z.coerce.number().int().min(30).max(180).optional().default(45),
    maxSessionMinutes: z.coerce.number().int().min(45).max(240).optional().default(120)
  })
  .refine((value) => value.maxSessionMinutes >= value.minSessionMinutes, {
    message: "maxSessionMinutes must be greater than or equal to minSessionMinutes"
  });

const studyPlanSessionCheckInSchema = z.object({
  status: z.enum(["done", "skipped"]),
  checkedAt: z.string().datetime().optional(),
  energyLevel: z.number().int().min(1).max(5).optional(),
  focusLevel: z.number().int().min(1).max(5).optional(),
  checkInNote: z.string().trim().min(1).max(500).optional()
});

const studyPlanSessionsQuerySchema = z.object({
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  status: z.enum(["pending", "done", "skipped"]).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const studyPlanAdherenceQuerySchema = z.object({
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional()
});

const contentRecommendationsQuerySchema = z.object({
  horizonDays: z.coerce.number().int().min(1).max(14).optional().default(7),
  limit: z.coerce.number().int().min(1).max(25).optional().default(10)
});

const githubCourseContentQuerySchema = z.object({
  courseCode: z.string().trim().min(2).max(16).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(12)
});

const locationCreateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().positive().optional(),
  label: z.string().trim().min(1).max(100).optional()
});

const locationUpdateSchema = locationCreateSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "At least one field is required"
);

const locationHistorySchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  context: z.string().trim().max(500).optional()
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

app.post("/api/locations", (req, res) => {
  const parsed = locationCreateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location payload", issues: parsed.error.issues });
  }

  const location = store.recordLocation(
    parsed.data.latitude,
    parsed.data.longitude,
    parsed.data.accuracy,
    parsed.data.label
  );

  return res.status(201).json({ location });
});

app.get("/api/locations", (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const locations = store.getLocations(limit);
  return res.json({ locations });
});

app.get("/api/locations/current", (_req, res) => {
  const location = store.getCurrentLocation();

  if (!location) {
    return res.status(404).json({ error: "No location recorded" });
  }

  return res.json({ location });
});

app.get("/api/locations/:id", (req, res) => {
  const location = store.getLocationById(req.params.id);

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
});

app.patch("/api/locations/:id", (req, res) => {
  const parsed = locationUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location payload", issues: parsed.error.issues });
  }

  const location = store.updateLocation(req.params.id, parsed.data);

  if (!location) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.json({ location });
});

app.delete("/api/locations/:id", (req, res) => {
  const deleted = store.deleteLocation(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.status(204).send();
});

app.post("/api/locations/:id/history", (req, res) => {
  const parsed = locationHistorySchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid location history payload", issues: parsed.error.issues });
  }

  const history = store.recordLocationHistory(
    req.params.id,
    parsed.data.stressLevel,
    parsed.data.energyLevel,
    parsed.data.context
  );

  if (!history) {
    return res.status(404).json({ error: "Location not found" });
  }

  return res.status(201).json({ history });
});

app.get("/api/locations/:id/history", (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const history = store.getLocationHistory(req.params.id, limit);
  return res.json({ history });
});

app.get("/api/location-history", (req, res) => {
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
  const history = store.getLocationHistory(undefined, limit);
  return res.json({ history });
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

  try {
    const tagIds = store.resolveTagIds(parsed.data.tags ?? [], { createMissing: true });
    const entry = store.recordJournalEntry(parsed.data.content, tagIds, parsed.data.photos);
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

  try {
    const normalizedEntries = parsed.data.entries.map((entry) => ({
      ...entry,
      tags: entry.tags ? store.resolveTagIds(entry.tags, { createMissing: true }) : undefined
    }));
    const result = store.syncJournalEntries(normalizedEntries);
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

  const parsedTags: string[] =
    typeof tagsParam === "string"
      ? tagsParam.split(",")
      : Array.isArray(tagsParam)
        ? tagsParam.map((tag) => tag.toString())
        : [];
  const requestedTags = parsedTags.map((tag) => tag.trim()).filter(Boolean);
  const tagIds = store.resolveTagIds(requestedTags);
  if (requestedTags.length > 0 && tagIds.length === 0) {
    return res.json({ entries: [] });
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

app.get("/api/journal/daily-summary", async (req, res) => {
  const parsed = journalDailySummaryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid daily summary query", issues: parsed.error.issues });
  }

  const referenceDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return res.status(400).json({ error: "Invalid date parameter" });
  }

  const summary = await generateDailyJournalSummary(store, { now: referenceDate });
  return res.json({ summary });
});

app.delete("/api/journal/:id", (req, res) => {
  const deleted = store.deleteJournalEntry(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Journal entry not found" });
  }

  return res.status(204).send();
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

  const preview = buildCalendarImportPreview(filterTPEventsByDateWindow(parseICS(icsContent)));
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

  const preview = buildCalendarImportPreview(filterTPEventsByDateWindow(parseICS(icsContent)));

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

app.get("/api/deadlines", async (_req, res) => {
  await maybeAutoSyncGitHubDeadlines();
  return res.json({ deadlines: store.getAcademicDeadlines() });
});

app.get("/api/deadlines/duplicates", (_req, res) => {
  return res.json(buildDeadlineDedupResult(store.getAcademicDeadlines()));
});

app.get("/api/deadlines/suggestions", (_req, res) => {
  const deadlines = store.getAcademicDeadlines();
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

app.post("/api/study-plan/generate", (req, res) => {
  const parsed = studyPlanGenerateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan payload", issues: parsed.error.issues });
  }

  const plan = generateWeeklyStudyPlan(store.getAcademicDeadlines(), store.getScheduleEvents(), {
    horizonDays: parsed.data.horizonDays,
    minSessionMinutes: parsed.data.minSessionMinutes,
    maxSessionMinutes: parsed.data.maxSessionMinutes,
    now: new Date()
  });

  store.upsertStudyPlanSessions(plan.sessions, plan.generatedAt, {
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd
  });
  const adherence = store.getStudyPlanAdherenceMetrics({
    windowStart: plan.windowStart,
    windowEnd: plan.windowEnd
  });

  return res.json({ plan, adherence });
});

app.get("/api/study-plan/sessions", (req, res) => {
  const parsed = studyPlanSessionsQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan sessions query", issues: parsed.error.issues });
  }

  const sessions = store.getStudyPlanSessions({
    windowStart: parsed.data.windowStart,
    windowEnd: parsed.data.windowEnd,
    status: parsed.data.status,
    limit: parsed.data.limit
  });

  return res.json({ sessions });
});

app.post("/api/study-plan/sessions/:id/check-in", (req, res) => {
  const parsed = studyPlanSessionCheckInSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan session check-in payload", issues: parsed.error.issues });
  }

  const session = store.setStudyPlanSessionStatus(req.params.id, parsed.data.status, parsed.data.checkedAt ?? nowIso(), {
    energyLevel: parsed.data.energyLevel,
    focusLevel: parsed.data.focusLevel,
    checkInNote: parsed.data.checkInNote
  });

  if (!session) {
    return res.status(404).json({ error: "Study plan session not found" });
  }

  return res.json({ session });
});

app.get("/api/study-plan/adherence", (req, res) => {
  const parsed = studyPlanAdherenceQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan adherence query", issues: parsed.error.issues });
  }

  const metrics = store.getStudyPlanAdherenceMetrics({
    windowStart: parsed.data.windowStart,
    windowEnd: parsed.data.windowEnd
  });

  return res.json({ metrics });
});

app.get("/api/study-plan/export", (req, res) => {
  const parsed = studyPlanExportQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid study plan export query", issues: parsed.error.issues });
  }

  const plan = generateWeeklyStudyPlan(store.getAcademicDeadlines(), store.getScheduleEvents(), {
    horizonDays: parsed.data.horizonDays,
    minSessionMinutes: parsed.data.minSessionMinutes,
    maxSessionMinutes: parsed.data.maxSessionMinutes,
    now: new Date()
  });

  const ics = buildStudyPlanCalendarIcs(plan);
  const generatedOn = new Date().toISOString().slice(0, 10);

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename=\"study-plan-${generatedOn}.ics\"`);
  return res.status(200).send(ics);
});

app.get("/api/deadlines/:id", (req, res) => {
  const deadline = store.getDeadlineById(req.params.id);

  if (!deadline || !isAssignmentOrExamDeadline(deadline)) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json({ deadline });
});

app.patch("/api/deadlines/:id", (req, res) => {
  const parsed = deadlineUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const existing = store.getDeadlineById(req.params.id, false);
  if (!existing || !isAssignmentOrExamDeadline(existing)) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const mergedCandidate = {
    ...existing,
    ...parsed.data
  };

  if (!isAssignmentOrExamDeadline(mergedCandidate)) {
    return res.status(400).json({ error: "Deadlines must stay assignment or exam work." });
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

  const existing = store.getDeadlineById(req.params.id, false);
  if (!existing || !isAssignmentOrExamDeadline(existing)) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const confirmation = store.confirmDeadlineStatus(req.params.id, parsed.data.completed);

  if (!confirmation) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json(confirmation);
});

app.delete("/api/deadlines/:id", (req, res) => {
  const existing = store.getDeadlineById(req.params.id, false);
  if (!existing || !isAssignmentOrExamDeadline(existing)) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  const deleted = store.deleteDeadline(req.params.id);

  if (!deleted) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.status(204).send();
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

app.patch("/api/habits/:id", (req, res) => {
  const parsed = habitUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid habit payload", issues: parsed.error.issues });
  }

  const patch: Partial<Pick<Habit, "name" | "cadence" | "targetPerWeek" | "motivation">> = {};

  if (parsed.data.name !== undefined) {
    patch.name = parsed.data.name;
  }
  if (parsed.data.cadence !== undefined) {
    patch.cadence = parsed.data.cadence;
  }
  if (parsed.data.targetPerWeek !== undefined) {
    patch.targetPerWeek = parsed.data.targetPerWeek;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "motivation")) {
    const motivation = parsed.data.motivation;
    patch.motivation = motivation && motivation.trim().length > 0 ? motivation : undefined;
  }

  const habit = store.updateHabit(req.params.id, patch);
  if (!habit) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.json({ habit });
});

app.delete("/api/habits/:id", (req, res) => {
  const deleted = store.deleteHabit(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Habit not found" });
  }

  return res.status(204).send();
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

app.patch("/api/goals/:id", (req, res) => {
  const parsed = goalUpdateSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid goal payload", issues: parsed.error.issues });
  }

  const patch: Partial<Pick<Goal, "title" | "cadence" | "targetCount" | "dueDate" | "motivation">> = {};

  if (parsed.data.title !== undefined) {
    patch.title = parsed.data.title;
  }
  if (parsed.data.cadence !== undefined) {
    patch.cadence = parsed.data.cadence;
  }
  if (parsed.data.targetCount !== undefined) {
    patch.targetCount = parsed.data.targetCount;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "motivation")) {
    const motivation = parsed.data.motivation;
    patch.motivation = motivation && motivation.trim().length > 0 ? motivation : undefined;
  }

  if (Object.prototype.hasOwnProperty.call(parsed.data, "dueDate")) {
    patch.dueDate = parsed.data.dueDate ?? null;
  }

  const goal = store.updateGoal(req.params.id, patch);
  if (!goal) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.json({ goal });
});

app.delete("/api/goals/:id", (req, res) => {
  const deleted = store.deleteGoal(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Goal not found" });
  }

  return res.status(204).send();
});

app.get("/api/push/vapid-public-key", (_req, res) => {
  return res.json({
    publicKey: getVapidPublicKey(),
    source: hasStaticVapidKeys() ? "configured" : "generated",
    subject: config.VAPID_SUBJECT
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

const notificationSnoozeSchema = z.object({
  notificationId: z.string().min(1),
  snoozeMinutes: z.number().int().min(1).max(1440).optional().default(30)
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

app.post("/api/notifications/snooze", (req, res) => {
  const parsed = notificationSnoozeSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid snooze payload", issues: parsed.error.issues });
  }

  const scheduled = store.snoozeNotification(parsed.data.notificationId, parsed.data.snoozeMinutes);

  if (!scheduled) {
    return res.status(404).json({ error: "Notification not found" });
  }

  return res.json({ scheduled });
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

// Background Sync API endpoints
const syncOperationSchema = z.object({
  operationType: z.enum(["journal", "deadline", "context"]),
  payload: z.record(z.unknown())
});

app.post("/api/sync/queue", (req, res) => {
  const parsed = syncOperationSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid sync operation payload", issues: parsed.error.issues });
  }

  const item = store.enqueueSyncOperation(parsed.data.operationType, parsed.data.payload);
  return res.status(201).json({ item });
});

app.post("/api/sync/process", async (_req, res) => {
  try {
    const result = await syncService.triggerSync();
    return res.json({ success: true, processed: result.processed, failed: result.failed });
  } catch (error) {
    return res.status(500).json({ 
      error: "Sync processing failed", 
      message: error instanceof Error ? error.message : "Unknown error" 
    });
  }
});

app.get("/api/sync/status", (_req, res) => {
  // Get data from various integrations
  const storage = storageDiagnostics();
  const canvasData = store.getCanvasData();
  const githubData = store.getGitHubCourseData();
  const xData = store.getXData();
  const youtubeData = store.getYouTubeData();
  const gmailData = store.getGmailData();
  const geminiClient = getGeminiClient();
  const githubConfigured = githubCourseSyncService.isConfigured();
  const gmailConnection = gmailOAuthService.getConnectionInfo();
  const gmailConnectionSource = gmailConnection.connected ? gmailConnection.source : null;
  const gmailTokenBootstrap = gmailConnection.connected ? gmailConnection.tokenBootstrap : false;
  const gmailHasRefreshToken = gmailConnection.connected ? gmailConnection.hasRefreshToken : false;
  const gmailHasAccessToken = gmailConnection.connected ? gmailConnection.hasAccessToken : false;

  return res.json({
    storage,
    canvas: {
      lastSyncAt: canvasData?.lastSyncedAt ?? null,
      status: canvasData ? "ok" : "not_synced",
      coursesCount: canvasData?.courses.length ?? 0,
      assignmentsCount: canvasData?.assignments.length ?? 0
    },
    tp: {
      lastSyncAt: null, // Will be implemented when TP sync stores last sync time
      status: "ok",
      source: "ical",
      eventsCount: store.getScheduleEvents().length
    },
    github: {
      lastSyncAt: githubData?.lastSyncedAt ?? null,
      status: githubConfigured ? (githubData ? "ok" : "not_synced") : "not_configured",
      reposTracked: githubData?.repositories.length ?? 0,
      courseDocsSynced: githubData?.documents.length ?? 0,
      deadlinesFound: githubData?.deadlinesSynced ?? 0
    },
    gemini: {
      status: geminiClient.isConfigured() ? "ok" : "not_configured",
      model: "gemini-2.0-flash",
      requestsToday: null,
      dailyLimit: null,
      rateLimitSource: "provider"
    },
    youtube: {
      lastSyncAt: youtubeData?.lastSyncedAt ?? null,
      status: youtubeData ? "ok" : "not_synced",
      videosTracked: youtubeData?.videos.length ?? 0,
      quotaUsedToday: 0, // Will be tracked when quota tracking is implemented
      quotaLimit: 10000
    },
    x: {
      lastSyncAt: xData?.lastSyncedAt ?? null,
      status: xData ? "ok" : "not_synced",
      tweetsProcessed: xData?.tweets.length ?? 0
    },
    gmail: {
      lastSyncAt: gmailData.lastSyncedAt,
      status: gmailConnection.connected ? "ok" : "not_connected",
      messagesProcessed: gmailData.messages.length,
      connected: gmailConnection.connected,
      connectionSource: gmailConnectionSource,
      tokenBootstrap: gmailTokenBootstrap,
      hasRefreshToken: gmailHasRefreshToken,
      hasAccessToken: gmailHasAccessToken
    },
    autoHealing: {
      tp: tpSyncService.getAutoHealingStatus(),
      canvas: canvasSyncService.getAutoHealingStatus(),
      github: githubCourseSyncService.getAutoHealingStatus(),
      youtube: youtubeSyncService.getAutoHealingStatus(),
      x: xSyncService.getAutoHealingStatus(),
      gmail: gmailSyncService.getAutoHealingStatus()
    }
  });
});

app.delete("/api/sync/cleanup", (_req, res) => {
  const deleted = store.cleanupCompletedSyncItems(7);
  return res.json({ deleted });
});

app.post("/api/integrations/scope/preview", (req, res) => {
  const parsed = integrationScopePreviewSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration scope preview payload", issues: parsed.error.issues });
  }

  const window = createIntegrationDateWindow({
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });

  const canvasData = store.getCanvasData();
  const canvasCourses = canvasData?.courses ?? [];
  const canvasAssignments = canvasData?.assignments ?? [];
  const selectedCanvasCourseIds =
    parsed.data.canvasCourseIds && parsed.data.canvasCourseIds.length > 0
      ? new Set(parsed.data.canvasCourseIds)
      : null;

  const scopedCanvasCourses =
    selectedCanvasCourseIds === null
      ? canvasCourses
      : canvasCourses.filter((course) => selectedCanvasCourseIds.has(course.id));
  const scopedCanvasAssignments = filterCanvasAssignmentsByDateWindow(canvasAssignments, {
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  }).filter((assignment) => selectedCanvasCourseIds === null || selectedCanvasCourseIds.has(assignment.course_id));

  const selectedTPCourseIds =
    parsed.data.tpCourseIds && parsed.data.tpCourseIds.length > 0
      ? parsed.data.tpCourseIds
      : [...DEFAULT_TP_SCOPE_COURSE_IDS];
  const selectedTPCourseCodes = selectedTPCourseIds
    .map((value) => value.split(",")[0]?.trim().toUpperCase())
    .filter((value): value is string => Boolean(value));

  const scheduleEventsInWindow = store.getScheduleEvents().filter((event) => {
    const start = new Date(event.startTime);
    if (Number.isNaN(start.getTime())) {
      return false;
    }
    return start >= window.start && start <= window.end;
  });

  const tpCandidateEvents = scheduleEventsInWindow.filter((event) => /DAT\d{3}/i.test(event.title));
  const matchedTPEvents = tpCandidateEvents.filter((event) => {
    const titleUpper = event.title.toUpperCase();
    return selectedTPCourseCodes.some((courseCode) => titleUpper.includes(courseCode));
  });

  return res.json({
    preview: {
      window: {
        pastDays: window.pastDays,
        futureDays: window.futureDays,
        start: window.start.toISOString(),
        end: window.end.toISOString()
      },
      canvas: {
        coursesMatched: scopedCanvasCourses.length,
        coursesTotal: canvasCourses.length,
        assignmentsMatched: scopedCanvasAssignments.length,
        assignmentsTotal: canvasAssignments.length
      },
      tp: {
        semester: parsed.data.semester ?? "26v",
        courseIdsApplied: selectedTPCourseIds,
        eventsMatched: matchedTPEvents.length,
        eventsTotal: tpCandidateEvents.length
      }
    }
  });
});

app.post("/api/sync/tp", async (req, res) => {
  const parsed = tpSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid TP sync payload", issues: parsed.error.issues });
  }

  try {
    const appliedTpCourseIds =
      parsed.data.courseIds && parsed.data.courseIds.length > 0
        ? parsed.data.courseIds
        : [...DEFAULT_TP_SCOPE_COURSE_IDS];

    const tpEvents = await fetchTPSchedule({
      semester: parsed.data.semester,
      courseIds: appliedTpCourseIds,
      pastDays: parsed.data.pastDays,
      futureDays: parsed.data.futureDays
    });
    const existingEvents = store.getScheduleEvents();
    const diff = diffScheduleEvents(existingEvents, tpEvents);
    const result = store.upsertScheduleEvents(diff.toCreate, diff.toUpdate, diff.toDelete);
    syncFailureRecovery.recordSuccess("tp");
    recordIntegrationAttempt("tp", syncStartedAt, true);

    return res.json({
      success: true,
      eventsProcessed: tpEvents.length,
      lecturesCreated: result.created,
      lecturesUpdated: result.updated,
      lecturesDeleted: result.deleted,
      appliedScope: {
        semester: parsed.data.semester ?? "26v",
        courseIds: appliedTpCourseIds,
        pastDays: parsed.data.pastDays ?? config.INTEGRATION_WINDOW_PAST_DAYS,
        futureDays: parsed.data.futureDays ?? config.INTEGRATION_WINDOW_FUTURE_DAYS
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const recoveryPrompt = syncFailureRecovery.recordFailure("tp", message);
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("tp", syncStartedAt, false, message);

    return res.status(500).json({
      success: false,
      error: message,
      eventsProcessed: 0,
      lecturesCreated: 0,
      lecturesUpdated: 0,
      lecturesDeleted: 0,
      recoveryPrompt
    });
  }
});

app.post("/api/sync/github", async (_req, res) => {
  const result = await githubCourseSyncService.triggerSync();
  if (result.success) {
    return res.json(result);
  }
  return res.status(500).json(result);
});

app.get("/api/tp/status", (_req, res) => {
  const events = store.getScheduleEvents();
  return res.json({
    lastSyncedAt: events.length > 0 ? new Date().toISOString() : null,
    eventsCount: events.length,
    isSyncing: tpSyncService.isCurrentlySyncing()
  });
});

app.get("/api/canvas/status", (_req, res) => {
  const canvasData = store.getCanvasData();
  return res.json({
    baseUrl: config.CANVAS_BASE_URL,
    lastSyncedAt: canvasData?.lastSyncedAt ?? null,
    courses: canvasData?.courses ?? []
  });
});

app.get("/api/github/status", (_req, res) => {
  const githubData = store.getGitHubCourseData();
  return res.json({
    configured: githubCourseSyncService.isConfigured(),
    lastSyncedAt: githubData?.lastSyncedAt ?? null,
    repositories: githubData?.repositories ?? [],
    courseDocsSynced: githubData?.documents.length ?? 0,
    deadlinesFound: githubData?.deadlinesSynced ?? 0
  });
});

app.get("/api/github/course-content", (req, res) => {
  const parsed = githubCourseContentQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid GitHub course-content query", issues: parsed.error.issues });
  }

  const githubData = store.getGitHubCourseData();
  const requestedCourseCode = parsed.data.courseCode?.toUpperCase();
  const matchingDocuments = (githubData?.documents ?? [])
    .filter((doc) => !requestedCourseCode || doc.courseCode.toUpperCase() === requestedCourseCode);
  const documents = matchingDocuments.slice(0, parsed.data.limit);

  return res.json({
    configured: githubCourseSyncService.isConfigured(),
    lastSyncedAt: githubData?.lastSyncedAt ?? null,
    repositories: githubData?.repositories ?? [],
    total: matchingDocuments.length,
    documents
  });
});

app.post("/api/canvas/sync", async (req, res) => {
  const parsed = canvasSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Canvas sync payload", issues: parsed.error.issues });
  }

  const result = await canvasSyncService.sync({
    baseUrl: parsed.data.baseUrl,
    token: parsed.data.token,
    courseIds: parsed.data.courseIds,
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });

  if (result.success) {
    syncFailureRecovery.recordSuccess("canvas");
    recordIntegrationAttempt("canvas", syncStartedAt, true);
    return res.json(result);
  }

  const recoveryPrompt = syncFailureRecovery.recordFailure("canvas", result.error ?? "Canvas sync failed");
  publishSyncRecoveryPrompt(recoveryPrompt);
  recordIntegrationAttempt("canvas", syncStartedAt, false, result.error ?? "Canvas sync failed");
  return res.json({
    ...result,
    recoveryPrompt
  });
});

app.get("/api/x/status", (_req, res) => {
  const xData = store.getXData();
  return res.json({
    lastSyncedAt: xData?.lastSyncedAt ?? null,
    tweetsCount: xData?.tweets.length ?? 0
  });
});

app.post("/api/x/sync", async (_req, res) => {
  const result = await xSyncService.sync();
  return res.json(result);
});

app.get("/api/social-media", (_req, res) => {
  const youtubeData = store.getYouTubeData();
  const xData = store.getXData();

  return res.json({
    youtube: {
      videos: youtubeData?.videos ?? [],
      lastSyncedAt: youtubeData?.lastSyncedAt ?? null
    },
    x: {
      tweets: xData?.tweets ?? [],
      lastSyncedAt: xData?.lastSyncedAt ?? null
    }
  });
});

app.get("/api/recommendations/content", (req, res) => {
  const parsed = contentRecommendationsQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid recommendations query", issues: parsed.error.issues });
  }

  const result = generateContentRecommendations(
    store.getAcademicDeadlines(),
    store.getScheduleEvents(),
    store.getYouTubeData(),
    store.getXData(),
    {
      now: new Date(),
      horizonDays: parsed.data.horizonDays,
      limit: parsed.data.limit
    }
  );

  return res.json(result);
});

app.post("/api/social-media/sync", async (_req, res) => {
  const [youtubeResult, xResult] = await Promise.all([
    youtubeSyncService.sync({ maxChannels: 20, maxVideosPerChannel: 5 }),
    xSyncService.sync({ maxTweets: 40 })
  ]);
  const youtubeData = store.getYouTubeData();
  const xData = store.getXData();

  return res.json({
    youtube: {
      success: youtubeResult.success,
      channelsCount: youtubeResult.channelsCount,
      videosCount: youtubeResult.videosCount,
      error: youtubeResult.error,
      lastSyncedAt: youtubeData?.lastSyncedAt ?? null
    },
    x: {
      success: xResult.success,
      tweetsCount: xResult.tweetsCount,
      error: xResult.error,
      errorCode: xResult.errorCode,
      lastSyncedAt: xData?.lastSyncedAt ?? null
    },
    syncedAt: new Date().toISOString()
  });
});

app.get("/api/gemini/status", (_req, res) => {
  const geminiClient = getGeminiClient();
  const isConfigured = geminiClient.isConfigured();
  const chatHistory = store.getChatHistory({ page: 1, pageSize: 1 });
  const lastRequestAt = chatHistory.messages.length > 0 
    ? chatHistory.messages[0]?.timestamp ?? null
    : null;

  return res.json({
    apiConfigured: isConfigured,
    model: isConfigured ? "gemini-2.0-flash" : "unknown",
    rateLimitRemaining: null,
    rateLimitSource: "provider",
    lastRequestAt,
    error: isConfigured ? undefined : "Gemini API key not configured"
  });
});

app.get("/api/auth/gmail", (_req, res) => {
  try {
    const authUrl = gmailOAuthService.getAuthUrl();
    return res.redirect(authUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Gmail OAuth error: ${errorMessage}` });
  }
});

app.get("/api/auth/gmail/callback", async (req, res) => {
  // Check for OAuth error from Google
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    const errorDescription = typeof req.query.error_description === "string" 
      ? req.query.error_description 
      : error;
    return res.status(400).json({ 
      error: "OAuth authorization failed", 
      details: errorDescription 
    });
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const result = await gmailOAuthService.handleCallback(code);
    return res.json({
      status: "connected",
      email: result.email,
      connectedAt: result.connectedAt
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Gmail authorization failed: ${errorMessage}` });
  }
});

app.get("/api/gmail/status", (_req, res) => {
  const connectionInfo = gmailOAuthService.getConnectionInfo();
  return res.json(connectionInfo);
});

app.get("/api/integrations/recovery-prompts", (_req, res) => {
  return res.json(syncFailureRecovery.getSnapshot());
});

app.get("/api/integrations/health-log", (req, res) => {
  const parsed = integrationHealthLogQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration health-log query", issues: parsed.error.issues });
  }

  const attempts = store.getIntegrationSyncAttempts({
    integration: parsed.data.integration,
    status: parsed.data.status,
    limit: parsed.data.limit,
    hours: parsed.data.hours
  });

  return res.json({
    generatedAt: nowIso(),
    total: attempts.length,
    attempts
  });
});

app.get("/api/integrations/health-log/summary", (req, res) => {
  const parsed = integrationHealthSummaryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid integration health-log summary query", issues: parsed.error.issues });
  }

  const summary = store.getIntegrationSyncSummary(parsed.data.hours);
  return res.json(summary);
});

app.post("/api/gmail/sync", async (_req, res) => {
  const syncStartedAt = Date.now();
  try {
    const result = await gmailSyncService.triggerSync();
    let recoveryPrompt: SyncRecoveryPrompt | null = null;
    if (result.success) {
      syncFailureRecovery.recordSuccess("gmail");
      recordIntegrationAttempt("gmail", syncStartedAt, true);
    } else {
      recoveryPrompt = syncFailureRecovery.recordFailure("gmail", result.error ?? "Gmail sync failed");
      publishSyncRecoveryPrompt(recoveryPrompt);
      recordIntegrationAttempt("gmail", syncStartedAt, false, result.error ?? "Gmail sync failed");
    }

    return res.json({
      status: result.success ? "syncing" : "failed",
      messagesFound: result.messagesCount,
      startedAt: new Date().toISOString(),
      error: result.error,
      recoveryPrompt
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const recoveryPrompt = syncFailureRecovery.recordFailure("gmail", errorMessage);
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("gmail", syncStartedAt, false, errorMessage);
    return res.status(500).json({ error: errorMessage, recoveryPrompt });
  }
});

app.get("/api/gmail/summary", (req, res) => {
  try {
    const data = gmailSyncService.getData();
    const hours = typeof req.query?.hours === "string" ? parseInt(req.query.hours, 10) : 24;
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - hours * 60 * 60 * 1000);

    // Filter messages by time
    const recentMessages = data.messages.filter((msg) => {
      const receivedAt = new Date(msg.receivedAt);
      return receivedAt >= cutoffTime;
    });

    return res.json({
      generatedAt: new Date().toISOString(),
      period: {
        from: cutoffTime.toISOString(),
        to: now.toISOString()
      },
      totalMessages: recentMessages.length,
      summary: recentMessages.length > 0 
        ? `You have ${recentMessages.length} recent email${recentMessages.length === 1 ? "" : "s"}`
        : "No recent emails",
      messages: recentMessages
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: errorMessage });
  }
});

app.post("/api/social-media/digest", async (req, res) => {
  const geminiClient = getGeminiClient();
  
  if (!geminiClient.isConfigured()) {
    return res.status(503).json({ 
      error: "Gemini API not configured. Set GEMINI_API_KEY environment variable." 
    });
  }

  try {
    const options = req.body;
    const youtubeData = store.getYouTubeData();
    const xData = store.getXData();

    const summarizer = new SocialMediaSummarizer(geminiClient);
    const digest = await summarizer.generateDigest(youtubeData, xData, options);

    return res.json(digest);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Failed to generate digest: ${errorMessage}` });
  }
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
  const storage = storageDiagnostics();
  // eslint-disable-next-line no-console
  console.log(`[axis-server] listening on http://localhost:${config.PORT}`);
  // eslint-disable-next-line no-console
  console.log(
    `[axis-server] storage backend=${storage.backend} sqlite=${storage.sqlitePath}` +
      (persistenceContext.restoredSnapshotAt
        ? ` restoredSnapshotAt=${persistenceContext.restoredSnapshotAt}`
        : "")
  );
});

let shuttingDown = false;

const shutdown = (): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  runtime.stop();
  syncService.stop();
  digestService.stop();
  tpSyncService.stop();
  canvasSyncService.stop();
  githubCourseSyncService.stop();
  youtubeSyncService.stop();
  xSyncService.stop();
  gmailSyncService.stop();

  const finalize = async (): Promise<void> => {
    if (persistenceContext.postgresSnapshotStore) {
      try {
        await persistenceContext.postgresSnapshotStore.flush(() => store.serializeDatabase());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[axis-server] failed final PostgreSQL snapshot flush", error);
      }

      try {
        await persistenceContext.postgresSnapshotStore.close();
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error("[axis-server] failed closing PostgreSQL snapshot store", error);
      }
    }

    server.close(() => {
      process.exit(0);
    });
  };

  void finalize();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
