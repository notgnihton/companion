import cors from "cors";
import express from "express";
import { resolve } from "path";
import { z } from "zod";
import { AuthService, parseBearerToken } from "./auth.js";
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
import { sendChatMessage, compressChatContext, GeminiError, RateLimitError } from "./chat.js";
import { getGeminiClient } from "./gemini.js";
import { RuntimeStore } from "./store.js";
import { fetchTPSchedule, diffScheduleEvents } from "./tp-sync.js";
import { TPSyncService } from "./tp-sync-service.js";
import { CanvasSyncService } from "./canvas-sync.js";
import { GitHubCourseSyncService } from "./github-course-sync.js";
import { GmailOAuthService } from "./gmail-oauth.js";
import { GmailSyncService } from "./gmail-sync.js";
import { WithingsOAuthService } from "./withings-oauth.js";
import { WithingsSyncService } from "./withings-sync.js";
import { buildStudyPlanCalendarIcs } from "./study-plan-export.js";
import { generateWeeklyStudyPlan } from "./study-plan.js";
import { generateAnalyticsCoachInsight } from "./analytics-coach.js";
import {
  buildWeeklyGrowthSundayPushSummary,
  generateWeeklyGrowthReview,
  isSundayInOslo
} from "./weekly-growth-review.js";
import { maybeGenerateDailySummaryVisual } from "./growth-visuals.js";
import { PostgresRuntimeSnapshotStore } from "./postgres-persistence.js";
import type { PostgresPersistenceDiagnostics } from "./postgres-persistence.js";
import { Notification, NotificationPreferencesPatch } from "./types.js";
import type {
  AnalyticsCoachInsight,
  AuthUser,
  Goal,
  Habit,
  NutritionCustomFood,
  NutritionMeal,
  IntegrationSyncName,
  IntegrationSyncRootCause
} from "./types.js";
import { SyncFailureRecoveryTracker, SyncRecoveryPrompt } from "./sync-failure-recovery.js";
import { nowIso } from "./utils.js";

const app = express();
const MAX_API_JSON_BODY_SIZE = "10mb";

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
  postgresSnapshotStore.startAutoSync(() => store.serializeDatabase(), config.POSTGRES_SNAPSHOT_SYNC_MS);

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
const authService = new AuthService(store, {
  required: config.AUTH_REQUIRED,
  adminEmail: config.AUTH_ADMIN_EMAIL,
  adminPassword: config.AUTH_ADMIN_PASSWORD,
  sessionTtlHours: config.AUTH_SESSION_TTL_HOURS
});
const bootstrappedAdmin = authService.bootstrapAdminUser();
if (config.AUTH_REQUIRED && bootstrappedAdmin) {
  console.info(`[auth] Admin user ready: ${bootstrappedAdmin.email}`);
}
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
const gmailOAuthService = new GmailOAuthService(store);
const gmailSyncService = new GmailSyncService(store, gmailOAuthService);
const withingsOAuthService = new WithingsOAuthService(store);
const withingsSyncService = new WithingsSyncService(store, withingsOAuthService);
const syncFailureRecovery = new SyncFailureRecoveryTracker();
const CANVAS_ON_DEMAND_SYNC_MIN_INTERVAL_MS = 5 * 60 * 1000;
const CANVAS_ON_DEMAND_SYNC_STALE_MS = 25 * 60 * 1000;
const GITHUB_ON_DEMAND_SYNC_MIN_INTERVAL_MS = 10 * 60 * 1000;
const GITHUB_ON_DEMAND_SYNC_STALE_MS = 6 * 60 * 60 * 1000;
let githubOnDemandSyncInFlight: Promise<void> | null = null;
let lastGithubOnDemandSyncAt = 0;
const MAX_ANALYTICS_CACHE_ITEMS = 15;
const ANALYTICS_COACH_MIN_REFRESH_MS = config.GROWTH_ANALYTICS_MIN_REFRESH_MINUTES * 60 * 1000;
const DAILY_SUMMARY_MIN_REFRESH_MS = 15 * 60 * 1000;

interface AnalyticsCoachCacheEntry {
  signature: string;
  insight: AnalyticsCoachInsight;
}

const analyticsCoachCache = new Map<string, AnalyticsCoachCacheEntry>();

import type { DailyGrowthSummary } from "./types.js";
const dailySummaryCache = new Map<string, DailyGrowthSummary>();

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function startsWithDateKey(value: string, dateKey: string): boolean {
  return typeof value === "string" && value.startsWith(dateKey);
}

function latestIso(values: string[]): string {
  return values.reduce((latest, value) => (value > latest ? value : latest), "");
}

function toDateMs(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function isCacheEntryFresh(generatedAt: string | undefined, minRefreshMs: number, nowMs: number): boolean {
  if (!generatedAt) {
    return false;
  }
  const generatedAtMs = toDateMs(generatedAt);
  if (generatedAtMs === null) {
    return false;
  }
  return nowMs - generatedAtMs < minRefreshMs;
}

function parseBooleanQueryFlag(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function isWithinWindow(value: string, startMs: number, endMs: number): boolean {
  const valueMs = toDateMs(value);
  return valueMs !== null && valueMs >= startMs && valueMs <= endMs;
}

function toAnalyticsPeriodDays(value: number | undefined): AnalyticsCoachInsight["periodDays"] {
  if (value === 14 || value === 30) {
    return value;
  }
  return 7;
}

function buildAnalyticsCoachSignature(
  periodDays: AnalyticsCoachInsight["periodDays"],
  now: Date
): { cacheKey: string; signature: string } {
  const nowMs = now.getTime();
  const windowStartMs = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const windowEndIso = now.toISOString();
  const cacheKey = `${periodDays}:${toDateKey(now)}`;

  const deadlines = store
    .getAcademicDeadlines(now, false)
    .filter((deadline) => isWithinWindow(deadline.dueDate, windowStartMs, nowMs))
    .map((deadline) => `${deadline.id}:${deadline.dueDate}:${deadline.completed ? 1 : 0}:${deadline.priority}`)
    .sort()
    .join(",");

  const habits = store
    .getHabitsWithStatus()
    .map((habit) => {
      const recent = habit.recentCheckIns.map((day) => `${day.date}:${day.completed ? 1 : 0}`).join(";");
      return `${habit.id}:${habit.createdAt}:${habit.streak}:${habit.completionRate7d}:${habit.todayCompleted ? 1 : 0}:${recent}`;
    })
    .sort()
    .join(",");

  const goals = store
    .getGoalsWithStatus()
    .map((goal) => {
      const recent = goal.recentCheckIns.map((day) => `${day.date}:${day.completed ? 1 : 0}`).join(";");
      return `${goal.id}:${goal.createdAt}:${goal.progressCount}:${goal.targetCount}:${goal.todayCompleted ? 1 : 0}:${goal.dueDate ?? ""}:${recent}`;
    })
    .sort()
    .join(",");

  const reflections = store.getReflectionEntriesInRange(windowStartIso, windowEndIso, 420);
  const reflectionSig = `${reflections.length}:${latestIso(reflections.map((entry) => entry.updatedAt || entry.timestamp))}`;

  const adherence = store.getStudyPlanAdherenceMetrics({
    windowStart: windowStartIso,
    windowEnd: windowEndIso
  });
  const trends = store.getContextTrends().latestContext;

  const signature = [
    `p:${periodDays}`,
    `d:${deadlines}`,
    `h:${habits}`,
    `g:${goals}`,
    `r:${reflectionSig}`,
    `a:${adherence.sessionsPlanned}:${adherence.sessionsDone}:${adherence.sessionsSkipped}:${adherence.completionRate}`,
    `ctx:${trends.energyLevel}:${trends.stressLevel}:${trends.mode}`
  ].join("|");

  return { cacheKey, signature };
}

function setCachedAnalyticsCoachInsight(cacheKey: string, entry: AnalyticsCoachCacheEntry): void {
  analyticsCoachCache.delete(cacheKey);
  analyticsCoachCache.set(cacheKey, entry);

  while (analyticsCoachCache.size > MAX_ANALYTICS_CACHE_ITEMS) {
    const oldestKey = analyticsCoachCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    analyticsCoachCache.delete(oldestKey);
  }
}

runtime.start();
syncService.start();
digestService.start();
tpSyncService.start();
canvasSyncService.start();
githubCourseSyncService.start();
gmailSyncService.start();
withingsSyncService.start();

async function maybeAutoSyncCanvasData(): Promise<void> {
  try {
    const syncStartedAt = Date.now();
    const result = await canvasSyncService.syncIfStale({
      staleMs: CANVAS_ON_DEMAND_SYNC_STALE_MS,
      minIntervalMs: CANVAS_ON_DEMAND_SYNC_MIN_INTERVAL_MS
    });

    if (!result) {
      return;
    }

    if (result.success) {
      syncFailureRecovery.recordSuccess("canvas");
      recordIntegrationAttempt("canvas", syncStartedAt, true);
      return;
    }

    const recoveryPrompt = syncFailureRecovery.recordFailure("canvas", result.error ?? "Canvas sync failed");
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("canvas", syncStartedAt, false, result.error ?? "Canvas sync failed");
  } catch {
    // Keep reads resilient when Canvas is temporarily unavailable.
  }
}

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

function hasUpcomingScheduleEvents(reference: Date, lookAheadHours = 36): boolean {
  const nowMs = reference.getTime();
  const lookAheadMs = nowMs + lookAheadHours * 60 * 60 * 1000;
  return store.getScheduleEvents().some((event) => {
    const startMs = Date.parse(event.startTime);
    return Number.isFinite(startMs) && startMs >= nowMs && startMs <= lookAheadMs;
  });
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

interface AuthenticatedRequest extends express.Request {
  authUser?: AuthUser;
  authToken?: string;
}

function isPublicApiRoute(method: string, path: string): boolean {
  return (
    (method === "GET" && path === "/api/health") ||
    (method === "POST" && path === "/api/auth/login") ||
    (method === "GET" && path === "/api/auth/status") ||
    (method === "GET" && path === "/api/auth/gmail") ||
    (method === "GET" && path === "/api/auth/gmail/callback") ||
    (method === "GET" && path === "/api/auth/withings") ||
    (method === "GET" && path === "/api/auth/withings/callback")
  );
}

app.use(cors());
app.use(express.json({ limit: MAX_API_JSON_BODY_SIZE }));
app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  const maybeError = error as { type?: string; status?: number; statusCode?: number; body?: unknown } | undefined;
  const isPayloadTooLarge =
    maybeError?.type === "entity.too.large" || maybeError?.status === 413 || maybeError?.statusCode === 413;

  if (isPayloadTooLarge) {
    return res.status(413).json({
      error: `Payload too large. Reduce attachment size and retry (max request body ${MAX_API_JSON_BODY_SIZE}).`
    });
  }

  if (error instanceof SyntaxError && maybeError && Object.prototype.hasOwnProperty.call(maybeError, "body")) {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  return next(error);
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  if (!authService.isRequired()) {
    return next();
  }

  if (isPublicApiRoute(req.method, req.path)) {
    return next();
  }

  const authContext = authService.authenticateFromAuthorizationHeader(req.headers.authorization);
  if (!authContext) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  (req as AuthenticatedRequest).authUser = authContext.user;
  (req as AuthenticatedRequest).authToken = authContext.token;
  return next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    storage: storageDiagnostics()
  });
});

app.get("/api/auth/status", (_req, res) => {
  return res.json({
    required: authService.isRequired()
  });
});

app.post("/api/auth/login", (req, res) => {
  const parsed = authLoginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid login payload", issues: parsed.error.issues });
  }

  const session = authService.login(parsed.data.email, parsed.data.password);
  if (!session) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  return res.status(200).json({
    token: session.token,
    expiresAt: session.expiresAt,
    user: session.user
  });
});

app.get("/api/auth/me", (req, res) => {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.authUser) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  return res.json({ user: authReq.authUser });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseBearerToken(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  authService.logout(token);
  return res.status(204).send();
});

app.get("/api/dashboard", (_req, res) => {
  res.json(store.getSnapshot());
});

app.get("/api/weekly-review", (req, res) => {
  const referenceDate = typeof req.query.referenceDate === "string" ? req.query.referenceDate : undefined;
  const summary = store.getWeeklySummary(referenceDate);
  return res.json({ summary });
});

app.get("/api/weekly-growth-review", async (req, res) => {
  const now = new Date();
  const review = await generateWeeklyGrowthReview(store, { now });

  const notifySunday = parseBooleanQueryFlag(req.query.notifySunday);
  const forcePush = parseBooleanQueryFlag(req.query.forcePush);
  let sundayPushSent = false;

  if (notifySunday && (forcePush || isSundayInOslo(now))) {
    const message = buildWeeklyGrowthSundayPushSummary(review);
    store.pushNotification({
      source: "orchestrator",
      title: "Weekly growth review",
      message,
      priority: "medium",
      actions: ["view"],
      url: "/companion/?tab=habits",
      metadata: {
        triggerType: "weekly-growth-review",
        periodDays: review.periodDays,
        commitments: review.commitments
      }
    });
    sundayPushSent = true;
  }

  return res.json({
    review,
    sundayPushSent
  });
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

  const forceRefreshRaw = typeof req.query.force === "string" ? req.query.force.trim().toLowerCase() : "";
  const forceRefresh = forceRefreshRaw === "1" || forceRefreshRaw === "true" || forceRefreshRaw === "yes";
  const periodDays = toAnalyticsPeriodDays(parsed.data.periodDays);
  const now = new Date();
  const nowMs = now.getTime();
  const { cacheKey, signature } = buildAnalyticsCoachSignature(periodDays, now);
  const cached = analyticsCoachCache.get(cacheKey);

  if (!forceRefresh && cached) {
    if (isCacheEntryFresh(cached.insight.generatedAt, ANALYTICS_COACH_MIN_REFRESH_MS, nowMs)) {
      return res.json({ insight: cached.insight });
    }
    if (cached.signature === signature) {
      return res.json({ insight: cached.insight });
    }
  }

  const insight = await generateAnalyticsCoachInsight(store, {
    periodDays,
    now
  });
  setCachedAnalyticsCoachInsight(cacheKey, {
    signature,
    insight
  });

  return res.json({ insight });
});

app.get("/api/growth/daily-summary", async (req, res) => {
  const parsed = growthDailySummaryQuerySchema.safeParse(req.query ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid daily summary query", issues: parsed.error.issues });
  }

  const forceRefresh = parseBooleanQueryFlag(req.query?.force);
  const referenceDate = parsed.data.date ? new Date(parsed.data.date) : new Date();
  if (Number.isNaN(referenceDate.getTime())) {
    return res.status(400).json({ error: "Invalid date parameter" });
  }

  const dateKey = toDateKey(referenceDate);
  const nowMs = Date.now();

  // Check cache
  if (!forceRefresh) {
    const cached = dailySummaryCache.get(dateKey);
    if (cached && isCacheEntryFresh(cached.generatedAt, DAILY_SUMMARY_MIN_REFRESH_MS, nowMs)) {
      return res.json({ summary: cached });
    }
  }

  const dayStartIso = `${dateKey}T00:00:00.000Z`;
  const dayEndIso = `${dateKey}T23:59:59.999Z`;
  const reflections = store.getReflectionEntriesInRange(dayStartIso, dayEndIso, 280);
  const chats = store
    .getRecentChatMessages(280)
    .filter(
      (message) =>
        message.role === "user" &&
        message.content.trim().length > 0 &&
        startsWithDateKey(message.timestamp, dateKey)
    );

  const habits = store.getHabitsWithStatus();
  const goals = store.getGoalsWithStatus();
  const nutritionSummary = store.getNutritionDailySummary(referenceDate);
  // For AI context, only count meals actually marked as eaten (not pre-planned templates)
  const eatenMeals = store.getNutritionMeals({ date: dateKey, limit: 1000, skipBaselineHydration: true, eatenOnly: true });
  const eatenTotals = eatenMeals.reduce(
    (acc, meal) => {
      if (meal.items.length > 0) {
        for (const item of meal.items) {
          acc.calories += item.caloriesPerUnit * item.quantity;
          acc.proteinGrams += item.proteinGramsPerUnit * item.quantity;
        }
      } else {
        acc.calories += meal.calories;
        acc.proteinGrams += meal.proteinGrams;
      }
      return acc;
    },
    { calories: 0, proteinGrams: 0 }
  );
  const withingsData = store.getWithingsData();
  const todayWeight = withingsData.weight.find((w) => w.measuredAt.startsWith(dateKey));
  const scheduleEvents = store.getScheduleEvents().filter((e) => e.startTime.startsWith(dateKey));

  // Build Gemini prompt for cross-domain reasoning
  const habitLines = habits
    .map((h) => `- ${h.name}: ${h.todayCompleted ? "done" : "not done"}, streak=${h.streak}${h.streakGraceUsed ? " (grace)" : ""}, 7d rate=${h.completionRate7d}%`)
    .join("\n");

  const goalLines = goals
    .map((g) => `- ${g.title}: ${g.todayCompleted ? "done" : "not done"}, ${g.progressCount}/${g.targetCount}, streak=${g.streak}`)
    .join("\n");

  const calActual = Math.round(eatenTotals.calories);
  const calTarget = nutritionSummary.targetProfile?.targetCalories ? Math.round(nutritionSummary.targetProfile.targetCalories) : null;
  const proteinActual = Math.round(eatenTotals.proteinGrams);
  const proteinTarget = nutritionSummary.targetProfile?.targetProteinGrams ? Math.round(nutritionSummary.targetProfile.targetProteinGrams) : null;
  const nutritionLine = calTarget
    ? `Calories eaten: ${calActual}/${calTarget} kcal, Protein eaten: ${proteinActual}/${proteinTarget ?? "?"}g, ${eatenMeals.length} meals eaten of ${nutritionSummary.mealsLogged} planned`
    : `Calories eaten: ${calActual} kcal, Protein eaten: ${proteinActual}g, ${eatenMeals.length} meals eaten`;

  const bodyCompLine = todayWeight
    ? `Weight: ${todayWeight.weightKg.toFixed(1)} kg${todayWeight.fatRatioPercent ? `, BF: ${todayWeight.fatRatioPercent.toFixed(1)}%` : ""}${todayWeight.muscleMassKg ? `, MM: ${todayWeight.muscleMassKg.toFixed(1)} kg` : ""}`
    : "No weigh-in today";

  const scheduleLines = scheduleEvents
    .slice(0, 6)
    .map((e) => {
      const startHHMM = e.startTime.slice(11, 16);
      const endDate = new Date(new Date(e.startTime).getTime() + e.durationMinutes * 60_000);
      const endHHMM = `${String(endDate.getHours()).padStart(2, "0")}:${String(endDate.getMinutes()).padStart(2, "0")}`;
      return `- ${startHHMM}-${endHHMM} ${e.title}${e.location ? ` @ ${e.location}` : ""}`;
    })
    .join("\n");

  const reflectionLines = reflections
    .slice(0, 10)
    .map((r) => `- [${r.event}] feeling=${r.feelingStress || "?"}, intent=${r.intent || "?"}, outcome=${r.outcome || "?"}`)
    .join("\n");

  const dataAvailable = reflections.length > 0 || calActual > 0 || habits.length > 0 || todayWeight;

  let summary: string;
  let highlights: string[];

  if (!dataAvailable) {
    summary = "No data yet today. Share an update, log a meal, or check in on a habit so I can start connecting the dots.";
    highlights = [];
  } else {
    const gemini = getGeminiClient();
    if (gemini.isConfigured()) {
      try {
        const prompt = `Write a daily reflection for Lucy for ${dateKey}.
Address Lucy directly (you/your). Be warm, encouraging, and honest — like a personal coach who genuinely cares.

Return strict JSON only:
{
  "summary": "3-5 sentence coaching narrative about the day. Weave in how different areas connect (nutrition, gym, habits, energy, study). Don't just list facts — coach.",
  "highlights": ["3-5 coaching insights that help Lucy understand what's working and what to adjust. Complete sentences, no truncation."]
}

IMPORTANT CONTEXT:
- The "weightKg" in the nutrition target profile is Lucy's BASELINE/STARTING weight for macro calculation, NOT a goal weight.
- Nutrition numbers reflect ONLY meals marked as eaten. Pre-planned template meals that haven't been eaten yet are excluded.
- "meals eaten of X planned" means some meals are still templates waiting to be consumed.

Rules:
- Write like a personal coach, not a data analyst
- When you see connections across domains, express them as coaching advice
- Note patterns (streak health, consistency trends)
- Flag risks warmly — as things to watch, not alarms
- Never truncate or cut off sentences — complete every thought fully
- No markdown, no extra keys

Today's data:

Nutrition:
${nutritionLine}

Body composition:
${bodyCompLine}

Habits (${habits.length}):
${habitLines || "- none"}

Goals (${goals.length}):
${goalLines || "- none"}

Schedule:
${scheduleLines || "- no events"}

Journal entries (${reflections.length}):
${reflectionLines || "- none"}

Chat messages today: ${chats.length}`;

        const response = await gemini.generateChatResponse({
          systemInstruction: "You are Lucy's personal performance coach — warm, direct, and insight-driven. Return strict JSON only. Never truncate your output. Complete every sentence fully.",
          messages: [{ role: "user", parts: [{ text: prompt }] }]
        });

        const raw = response.text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed2 = JSON.parse(jsonMatch[0]) as { summary?: string; highlights?: string[] };
          summary = typeof parsed2.summary === "string" ? parsed2.summary : "";
          highlights = Array.isArray(parsed2.highlights)
            ? parsed2.highlights.filter((h): h is string => typeof h === "string").slice(0, 5)
            : [];
        } else {
          summary = buildFallbackSummary(reflections.length, habits, goals);
          highlights = buildFallbackHighlights(reflections);
        }
      } catch {
        summary = buildFallbackSummary(reflections.length, habits, goals);
        highlights = buildFallbackHighlights(reflections);
      }
    } else {
      summary = buildFallbackSummary(reflections.length, habits, goals);
      highlights = buildFallbackHighlights(reflections);
    }
  }

  const result: DailyGrowthSummary = {
    date: dateKey,
    generatedAt: nowIso(),
    summary,
    highlights,
    journalEntryCount: reflections.length,
    reflectionEntryCount: reflections.length,
    chatMessageCount: chats.length
  };

  // Generate visual
  try {
    const gemini = getGeminiClient();
    if (gemini.isConfigured()) {
      const visual = await maybeGenerateDailySummaryVisual(gemini, result);
      if (visual) {
        result.visual = visual;
      }
    }
  } catch {
    // visual generation failed — continue without it
  }

  // Cache result
  dailySummaryCache.set(dateKey, result);
  // Evict old entries
  if (dailySummaryCache.size > 10) {
    const oldestKey = dailySummaryCache.keys().next().value;
    if (oldestKey) dailySummaryCache.delete(oldestKey);
  }

  return res.json({ summary: result });
});

function buildFallbackSummary(
  reflectionCount: number,
  habits: Array<{ todayCompleted: boolean }>,
  goals: Array<{ todayCompleted: boolean }>
): string {
  const habitsDone = habits.filter((h) => h.todayCompleted).length;
  const goalsDone = goals.filter((g) => g.todayCompleted).length;
  if (reflectionCount === 0) {
    return "No structured journal entries yet today. Share one quick update so I can tune your plan.";
  }
  return `You logged ${reflectionCount} structured journal entr${reflectionCount === 1 ? "y" : "ies"} today, with ${habitsDone} habit and ${goalsDone} goal check-ins completed.`;
}

function buildFallbackHighlights(reflections: Array<{ event: string; evidenceSnippet: string }>): string[] {
  return reflections
    .slice(0, 5)
    .map((entry) => `${entry.event}: ${entry.evidenceSnippet}`)
    .filter((item) => item.length > 0)
    .map((item) => (item.length > 120 ? `${item.slice(0, 120)}...` : item));
}

app.post("/api/chat", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat payload", issues: parsed.error.issues });
  }

  try {
    await Promise.all([maybeAutoSyncCanvasData(), maybeAutoSyncGitHubDeadlines()]);
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

app.post("/api/chat/stream", async (req, res) => {
  const parsed = chatRequestSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat payload", issues: parsed.error.issues });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  let clientDisconnected = false;
  res.on("close", () => {
    clientDisconnected = true;
  });

  const sendSse = (event: string, payload: Record<string, unknown>): void => {
    if (clientDisconnected || res.writableEnded || res.destroyed) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    await Promise.all([maybeAutoSyncCanvasData(), maybeAutoSyncGitHubDeadlines()]);
    const result = await sendChatMessage(store, parsed.data.message.trim(), {
      attachments: parsed.data.attachments,
      onTextChunk: (chunk) => sendSse("token", { delta: chunk })
    });

    sendSse("done", {
      reply: result.reply,
      message: result.assistantMessage,
      userMessage: result.userMessage,
      finishReason: result.finishReason,
      usage: result.usage,
      citations: result.citations,
      mood: result.mood,
      history: result.history
    });
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  } catch (error) {
    if (error instanceof RateLimitError) {
      sendSse("error", { error: error.message, status: 429 });
    } else if (error instanceof GeminiError) {
      sendSse("error", { error: error.message, status: error.statusCode ?? 500 });
    } else {
      sendSse("error", { error: "Chat request failed", status: 500 });
    }
    if (!res.writableEnded && !res.destroyed) {
      res.end();
    }
  }
});

app.post("/api/chat/context/compress", async (req, res) => {
  const parsed = chatContextCompressionSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid chat context compression payload", issues: parsed.error.issues });
  }

  try {
    const result = await compressChatContext(store, {
      maxMessages: parsed.data.maxMessages,
      preserveRecentMessages: parsed.data.preserveRecentMessages,
      targetSummaryChars: parsed.data.targetSummaryChars
    });

    store.upsertChatLongTermMemory({
      summary: result.summary,
      sourceMessageCount: result.sourceMessageCount,
      totalMessagesAtCompression: result.totalMessagesAtCompression,
      compressedMessageCount: result.compressedMessageCount,
      preservedMessageCount: result.preservedMessageCount,
      fromTimestamp: result.fromTimestamp,
      toTimestamp: result.toTimestamp,
      usedModelMode: result.usedModelMode
    });

    return res.json(result);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return res.status(429).json({ error: error.message });
    }

    if (error instanceof GeminiError) {
      return res.status(error.statusCode ?? 500).json({ error: error.message });
    }

    return res.status(500).json({ error: "Chat context compression failed" });
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

const lectureImportSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  location: z.string().trim().min(1).max(120).optional(),
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
  message: z.string().max(10000).default(""),
  attachments: z.array(chatImageAttachmentSchema).max(3).optional()
}).refine(
  (payload) => payload.message.trim().length > 0 || (payload.attachments?.length ?? 0) > 0,
  {
    message: "Either message text or at least one image attachment is required.",
    path: ["message"]
  }
);

const chatContextCompressionSchema = z.object({
  maxMessages: z.coerce.number().int().min(10).max(500).optional(),
  preserveRecentMessages: z.coerce.number().int().min(0).max(100).optional(),
  targetSummaryChars: z.coerce.number().int().min(300).max(12000).optional()
});

const chatHistoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(50).optional()
});

const authLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
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

const growthDailySummaryQuerySchema = z.object({
  date: z.string().trim().optional()
});

const tagIdSchema = z.string().trim().min(1);
const tagIdsSchema = z.array(tagIdSchema).max(20);

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
  location: z.string().trim().min(1).max(120).optional(),
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

const nutritionDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const nutritionMealItemSchema = z.object({
  id: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(160),
  quantity: z.number().min(0.1).max(1000).default(1),
  unitLabel: z.string().trim().min(1).max(40).default("serving"),
  caloriesPerUnit: z.number().min(0).max(10000),
  proteinGramsPerUnit: z.number().min(0).max(1000).default(0),
  carbsGramsPerUnit: z.number().min(0).max(1500).default(0),
  fatGramsPerUnit: z.number().min(0).max(600).default(0),
  customFoodId: z.string().trim().min(1).max(120).optional()
});

const nutritionMealCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]).default("other"),
  consumedAt: z.string().datetime().optional(),
  items: z.array(nutritionMealItemSchema).max(200).default([]),
  calories: z.number().min(0).max(10000).optional(),
  proteinGrams: z.number().min(0).max(1000).default(0),
  carbsGrams: z.number().min(0).max(1500).default(0),
  fatGrams: z.number().min(0).max(600).default(0),
  notes: z.string().trim().max(300).optional()
}).refine(
  (value) => value.items.length > 0 || typeof value.calories === "number",
  "Provide at least one meal item or explicit macro totals."
);

const nutritionMealUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    mealType: z.enum(["breakfast", "lunch", "dinner", "snack", "other"]).optional(),
    consumedAt: z.string().datetime().optional(),
    items: z.array(nutritionMealItemSchema).max(200).optional(),
    calories: z.number().min(0).max(10000).optional(),
    proteinGrams: z.number().min(0).max(1000).optional(),
    carbsGrams: z.number().min(0).max(1500).optional(),
    fatGrams: z.number().min(0).max(600).optional(),
    notes: z.string().trim().max(300).optional()
  })
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const nutritionMealsQuerySchema = z.object({
  date: nutritionDateSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const nutritionSummaryQuerySchema = z.object({
  date: nutritionDateSchema.optional()
});

const nutritionCustomFoodCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  unitLabel: z.string().trim().min(1).max(40).default("serving"),
  caloriesPerUnit: z.number().min(0).max(10000),
  proteinGramsPerUnit: z.number().min(0).max(1000).default(0),
  carbsGramsPerUnit: z.number().min(0).max(1500).default(0),
  fatGramsPerUnit: z.number().min(0).max(600).default(0)
});

const nutritionCustomFoodUpdateSchema = nutritionCustomFoodCreateSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

const nutritionCustomFoodsQuerySchema = z.object({
  query: z.string().trim().min(1).max(80).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional()
});

const nutritionTargetProfileUpsertSchema = z
  .object({
    date: nutritionDateSchema.optional(),
    weightKg: z.number().min(0).max(500).nullable().optional(),
    maintenanceCalories: z.number().min(0).max(10000).nullable().optional(),
    surplusCalories: z.number().min(-5000).max(5000).nullable().optional(),
    targetCalories: z.number().min(0).max(15000).nullable().optional(),
    targetProteinGrams: z.number().min(0).max(1000).nullable().optional(),
    targetCarbsGrams: z.number().min(0).max(1500).nullable().optional(),
    targetFatGrams: z.number().min(0).max(600).nullable().optional(),
    proteinGramsPerLb: z.number().min(0).max(2).nullable().optional(),
    fatGramsPerLb: z.number().min(0).max(2).nullable().optional()
  })
  .refine(
    (value) =>
      [
        "weightKg",
        "maintenanceCalories",
        "surplusCalories",
        "targetCalories",
        "targetProteinGrams",
        "targetCarbsGrams",
        "targetFatGrams",
        "proteinGramsPerLb",
        "fatGramsPerLb"
      ].some((field) => Object.prototype.hasOwnProperty.call(value, field)),
    "At least one target profile field is required"
  );

const nutritionPlanSnapshotsQuerySchema = z.object({
  query: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const nutritionPlanSnapshotCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  date: nutritionDateSchema.optional(),
  replaceId: z.string().trim().min(1).max(160).optional()
});

const nutritionPlanSnapshotApplySchema = z.object({
  date: nutritionDateSchema.optional(),
  replaceMeals: z.boolean().default(true),
  setAsDefault: z.boolean().default(true)
});

const nutritionPlanSettingsUpdateSchema = z
  .object({
    defaultSnapshotId: z.string().trim().min(1).max(160).nullable().optional()
  })
  .refine((value) => Object.prototype.hasOwnProperty.call(value, "defaultSnapshotId"), {
    message: "defaultSnapshotId is required"
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

const withingsSyncSchema = z.object({
  daysBack: z.coerce.number().int().min(1).max(90).optional()
});

const integrationScopePreviewSchema = z.object({
  semester: z.string().trim().min(1).max(16).optional(),
  tpCourseIds: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
  canvasCourseIds: z.array(z.coerce.number().int().positive()).max(100).optional(),
  pastDays: z.coerce.number().int().min(0).max(365).optional(),
  futureDays: z.coerce.number().int().min(1).max(730).optional()
});

const integrationHealthLogQuerySchema = z.object({
  integration: z.enum(["tp", "canvas", "gmail", "withings"]).optional(),
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

app.get("/api/schedule", async (_req, res) => {
  await maybeAutoSyncCanvasData();
  return res.json({ schedule: store.getScheduleEvents() });
});

app.get("/api/schedule/suggestion-mutes", (req, res) => {
  const dayParam = typeof req.query.day === "string" ? req.query.day.trim() : "";
  let day: Date | undefined;
  if (dayParam.length > 0) {
    const parsedDay = new Date(`${dayParam}T00:00:00`);
    if (Number.isNaN(parsedDay.getTime())) {
      return res.status(400).json({ error: "Invalid day query parameter. Use YYYY-MM-DD." });
    }
    day = parsedDay;
  }

  const mutes = store.getScheduleSuggestionMutes({ day });
  return res.json({ mutes });
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
  await maybeAutoSyncCanvasData();
  await maybeAutoSyncGitHubDeadlines();
  return res.json({ deadlines: store.getAcademicDeadlines() });
});

app.get("/api/deadlines/duplicates", (_req, res) => {
  return res.json(buildDeadlineDedupResult(store.getAcademicDeadlines()));
});

app.get("/api/deadlines/suggestions", async (_req, res) => {
  await maybeAutoSyncCanvasData();
  await maybeAutoSyncGitHubDeadlines();
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

app.get("/api/nutrition/summary", (req, res) => {
  const parsed = nutritionSummaryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition summary query", issues: parsed.error.issues });
  }

  if (parsed.data.date) {
    store.ensureNutritionBaselineForDate(parsed.data.date);
  } else {
    store.ensureNutritionBaselineForDate(new Date());
  }
  const summary = store.getNutritionDailySummary(parsed.data.date ?? new Date());
  return res.json({ summary });
});

app.get("/api/nutrition/history", (req, res) => {
  const schema = z.object({
    from: nutritionDateSchema.optional(),
    to: nutritionDateSchema.optional(),
    days: z.coerce.number().int().min(1).max(3650).optional()
  });
  const parsed = schema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition history query", issues: parsed.error.issues });
  }

  let fromDate: string;
  let toDate: string;

  if (parsed.data.from && parsed.data.to) {
    fromDate = parsed.data.from;
    toDate = parsed.data.to;
  } else {
    const days = parsed.data.days ?? 30;
    const end = parsed.data.to ? new Date(parsed.data.to + "T00:00:00Z") : new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));
    fromDate = start.toISOString().slice(0, 10);
    toDate = end.toISOString().slice(0, 10);
  }

  const entries = store.getNutritionDailyHistory(fromDate, toDate);
  return res.json({ entries, from: fromDate, to: toDate });
});

app.get("/api/nutrition/custom-foods", (req, res) => {
  const parsed = nutritionCustomFoodsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom foods query", issues: parsed.error.issues });
  }

  const foods = store.getNutritionCustomFoods({
    query: parsed.data.query,
    limit: parsed.data.limit
  });
  return res.json({ foods });
});

app.post("/api/nutrition/custom-foods", (req, res) => {
  const parsed = nutritionCustomFoodCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom food payload", issues: parsed.error.issues });
  }

  const food: NutritionCustomFood = store.createNutritionCustomFood(parsed.data);
  return res.status(201).json({ food });
});

app.patch("/api/nutrition/custom-foods/:id", (req, res) => {
  const parsed = nutritionCustomFoodUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid custom food payload", issues: parsed.error.issues });
  }

  const food: NutritionCustomFood | null = store.updateNutritionCustomFood(req.params.id, parsed.data);
  if (!food) {
    return res.status(404).json({ error: "Custom food not found" });
  }
  return res.json({ food });
});

app.delete("/api/nutrition/custom-foods/:id", (req, res) => {
  const deleted = store.deleteNutritionCustomFood(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Custom food not found" });
  }
  return res.status(204).send();
});

app.get("/api/nutrition/targets", (req, res) => {
  const parsed = nutritionSummaryQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition target-profile query", issues: parsed.error.issues });
  }

  const profile = store.getNutritionTargetProfile(parsed.data.date ?? new Date());
  return res.json({ profile });
});

app.put("/api/nutrition/targets", (req, res) => {
  const parsed = nutritionTargetProfileUpsertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition target-profile payload", issues: parsed.error.issues });
  }

  const profile = store.upsertNutritionTargetProfile(parsed.data);
  return res.json({ profile });
});

app.get("/api/nutrition/meals", (req, res) => {
  const parsed = nutritionMealsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meals query", issues: parsed.error.issues });
  }

  if (parsed.data.date) {
    store.ensureNutritionBaselineForDate(parsed.data.date);
  }
  const meals = store.getNutritionMeals(parsed.data);
  return res.json({ meals });
});

app.post("/api/nutrition/meals", (req, res) => {
  const parsed = nutritionMealCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meal payload", issues: parsed.error.issues });
  }

  const meal: NutritionMeal = store.createNutritionMeal({
    ...parsed.data,
    consumedAt: parsed.data.consumedAt ?? nowIso()
  });

  return res.status(201).json({ meal });
});

app.patch("/api/nutrition/meals/:id", (req, res) => {
  const parsed = nutritionMealUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition meal payload", issues: parsed.error.issues });
  }

  const meal: NutritionMeal | null = store.updateNutritionMeal(req.params.id, parsed.data);
  if (!meal) {
    return res.status(404).json({ error: "Meal not found" });
  }

  return res.json({ meal });
});

app.delete("/api/nutrition/meals/:id", (req, res) => {
  const deleted = store.deleteNutritionMeal(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Meal not found" });
  }
  return res.status(204).send();
});

app.get("/api/nutrition/plan-settings", (_req, res) => {
  const settings = store.getNutritionPlanSettings();
  return res.json({ settings });
});

app.put("/api/nutrition/plan-settings", (req, res) => {
  const parsed = nutritionPlanSettingsUpdateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan settings payload", issues: parsed.error.issues });
  }

  const settings = store.setNutritionDefaultPlanSnapshot(parsed.data.defaultSnapshotId ?? null);
  if (!settings) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
  }
  return res.json({ settings });
});

app.get("/api/nutrition/plan-snapshots", (req, res) => {
  const parsed = nutritionPlanSnapshotsQuerySchema.safeParse(req.query ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot query", issues: parsed.error.issues });
  }

  const snapshots = store.getNutritionPlanSnapshots({
    query: parsed.data.query,
    limit: parsed.data.limit
  });
  return res.json({ snapshots });
});

app.post("/api/nutrition/plan-snapshots", (req, res) => {
  const parsed = nutritionPlanSnapshotCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot payload", issues: parsed.error.issues });
  }

  const snapshot = store.createNutritionPlanSnapshot({
    name: parsed.data.name,
    date: parsed.data.date,
    replaceId: parsed.data.replaceId
  });
  if (!snapshot) {
    return res.status(400).json({ error: "Unable to save nutrition plan snapshot. Add at least one meal first." });
  }

  return res.status(201).json({ snapshot });
});

app.post("/api/nutrition/plan-snapshots/:id/apply", (req, res) => {
  const parsed = nutritionPlanSnapshotApplySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid nutrition plan snapshot apply payload", issues: parsed.error.issues });
  }

  const applied = store.applyNutritionPlanSnapshot(req.params.id, parsed.data);
  if (!applied) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
  }

  const settings = store.getNutritionPlanSettings();

  return res.json({
    snapshot: applied.snapshot,
    appliedDate: applied.appliedDate,
    mealsCreated: applied.mealsCreated,
    targetProfile: applied.targetProfile,
    settings
  });
});

app.delete("/api/nutrition/plan-snapshots/:id", (req, res) => {
  const deleted = store.deleteNutritionPlanSnapshot(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: "Nutrition plan snapshot not found" });
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
  operationType: z.enum([
    "deadline",
    "context",
    "habit-checkin",
    "goal-checkin",
    "schedule-update"
  ]),
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

app.get("/api/sync/queue-status", (_req, res) => {
  return res.json({
    status: store.getSyncQueueStatus(),
    isProcessing: syncService.isCurrentlyProcessing()
  });
});

app.get("/api/sync/status", (_req, res) => {
  // Get data from various integrations
  const storage = storageDiagnostics();
  const canvasData = store.getCanvasData();
  const githubData = store.getGitHubCourseData();
  const gmailData = store.getGmailData();
  const withingsData = store.getWithingsData();
  const geminiClient = getGeminiClient();
  const githubConfigured = githubCourseSyncService.isConfigured();
  const gmailConnection = gmailOAuthService.getConnectionInfo();
  const withingsConnection = withingsOAuthService.getConnectionInfo();
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
      model: config.GEMINI_LIVE_MODEL,
      requestsToday: null,
      dailyLimit: null,
      rateLimitSource: "provider"
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
    withings: {
      lastSyncAt: withingsData.lastSyncedAt,
      status: withingsConnection.connected ? "ok" : "not_connected",
      connected: withingsConnection.connected,
      connectionSource: withingsConnection.connected ? withingsConnection.source ?? null : null,
      hasRefreshToken: withingsConnection.connected ? withingsConnection.hasRefreshToken ?? false : false,
      hasAccessToken: withingsConnection.connected ? withingsConnection.hasAccessToken ?? false : false,
      weightsTracked: withingsData.weight.length,
      sleepDaysTracked: withingsData.sleepSummary.length
    },
    autoHealing: {
      tp: tpSyncService.getAutoHealingStatus(),
      canvas: canvasSyncService.getAutoHealingStatus(),
      github: githubCourseSyncService.getAutoHealingStatus(),
      gmail: gmailSyncService.getAutoHealingStatus(),
      withings: withingsSyncService.getAutoHealingStatus()
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
  const hadUpcomingScheduleBeforeSync = hasUpcomingScheduleEvents(new Date());

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Canvas sync payload", issues: parsed.error.issues });
  }

  const result = await canvasSyncService.triggerSync({
    baseUrl: parsed.data.baseUrl,
    token: parsed.data.token,
    courseIds: parsed.data.courseIds,
    pastDays: parsed.data.pastDays,
    futureDays: parsed.data.futureDays
  });

  if (result.success) {
    syncFailureRecovery.recordSuccess("canvas");
    recordIntegrationAttempt("canvas", syncStartedAt, true);

    let scheduleRecoveryAttempted = false;
    let scheduleRecovered = false;

    if (!hadUpcomingScheduleBeforeSync && !hasUpcomingScheduleEvents(new Date())) {
      scheduleRecoveryAttempted = true;
      const tpResult = await tpSyncService.sync();
      scheduleRecovered = tpResult.success && hasUpcomingScheduleEvents(new Date());
    }

    return res.json({
      ...result,
      scheduleRecovery: {
        attempted: scheduleRecoveryAttempted,
        recovered: scheduleRecovered
      }
    });
  }

  const recoveryPrompt = syncFailureRecovery.recordFailure("canvas", result.error ?? "Canvas sync failed");
  publishSyncRecoveryPrompt(recoveryPrompt);
  recordIntegrationAttempt("canvas", syncStartedAt, false, result.error ?? "Canvas sync failed");
  return res.json({
    ...result,
    recoveryPrompt
  });
});

app.get("/api/gemini/status", (_req, res) => {
  const geminiClient = getGeminiClient();
  const isConfigured = geminiClient.isConfigured();
  const growthImageModel = geminiClient.getGrowthImageModel();
  const chatHistory = store.getChatHistory({ page: 1, pageSize: 1 });
  const lastRequestAt = chatHistory.messages.length > 0 
    ? chatHistory.messages[0]?.timestamp ?? null
    : null;

  return res.json({
    apiConfigured: isConfigured,
    model: isConfigured ? config.GEMINI_LIVE_MODEL : "unknown",
    growthImageModel: growthImageModel.configured,
    growthImageModelResolved: growthImageModel.resolved,
    rateLimitRemaining: null,
    rateLimitSource: "provider",
    lastRequestAt,
    error: isConfigured ? undefined : "Vertex Gemini credentials not configured"
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

app.get("/api/auth/withings", (_req, res) => {
  try {
    const authUrl = withingsOAuthService.getAuthUrl();
    return res.redirect(authUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return res.status(500).json({ error: `Withings OAuth error: ${errorMessage}` });
  }
});

app.get("/api/auth/withings/callback", async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    const errorDescription = typeof req.query.error_description === "string" ? req.query.error_description : error;
    return res.status(400).json({
      error: "Withings authorization failed",
      details: errorDescription
    });
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;

  if (!code) {
    return res.status(400).json({ error: "Missing authorization code" });
  }

  try {
    const result = await withingsOAuthService.handleCallback(code, state);
    return res.json({
      status: "connected",
      connectedAt: result.connectedAt,
      userId: result.userId ?? null,
      scope: result.scope ?? null
    });
  } catch (oauthError) {
    const errorMessage = oauthError instanceof Error ? oauthError.message : "Unknown error";
    return res.status(500).json({ error: `Withings authorization failed: ${errorMessage}` });
  }
});

app.get("/api/withings/status", (_req, res) => {
  const connection = withingsOAuthService.getConnectionInfo();
  const data = withingsSyncService.getData();
  return res.json({
    ...connection,
    lastSyncedAt: data.lastSyncedAt,
    weightsTracked: data.weight.length,
    sleepDaysTracked: data.sleepSummary.length
  });
});

app.post("/api/withings/sync", async (req, res) => {
  const parsed = withingsSyncSchema.safeParse(req.body ?? {});
  const syncStartedAt = Date.now();

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid Withings sync payload", issues: parsed.error.issues });
  }

  try {
    const result = await withingsSyncService.triggerSync({
      daysBack: parsed.data.daysBack
    });

    if (result.success) {
      syncFailureRecovery.recordSuccess("withings");
      recordIntegrationAttempt("withings", syncStartedAt, true);
    } else {
      const recoveryPrompt = syncFailureRecovery.recordFailure("withings", result.error ?? "Withings sync failed");
      publishSyncRecoveryPrompt(recoveryPrompt);
      recordIntegrationAttempt("withings", syncStartedAt, false, result.error ?? "Withings sync failed");
      return res.status(500).json({
        ...result,
        recoveryPrompt
      });
    }

    return res.json({
      ...result,
      startedAt: new Date(syncStartedAt).toISOString(),
      data: withingsSyncService.getData()
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const recoveryPrompt = syncFailureRecovery.recordFailure("withings", errorMessage);
    publishSyncRecoveryPrompt(recoveryPrompt);
    recordIntegrationAttempt("withings", syncStartedAt, false, errorMessage);
    return res.status(500).json({ error: errorMessage, recoveryPrompt });
  }
});

app.get("/api/withings/summary", (req, res) => {
  const parsedDays = typeof req.query.daysBack === "string" ? Number(req.query.daysBack) : 14;
  const daysBack = Number.isFinite(parsedDays) ? Math.max(1, Math.min(90, Math.round(parsedDays))) : 14;
  const data = withingsSyncService.getData();
  const cutoff = Date.now() - daysBack * 24 * 60 * 60 * 1000;

  const weight = data.weight.filter((entry) => Date.parse(entry.measuredAt) >= cutoff);
  const sleepSummary = data.sleepSummary.filter((entry) => {
    const dayMs = Date.parse(`${entry.date}T00:00:00.000Z`);
    return Number.isFinite(dayMs) && dayMs >= cutoff;
  });

  return res.json({
    generatedAt: nowIso(),
    daysBack,
    lastSyncedAt: data.lastSyncedAt,
    latestWeight: weight[0] ?? null,
    latestSleep: sleepSummary[0] ?? null,
    weight,
    sleepSummary
  });
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
  gmailSyncService.stop();
  withingsSyncService.stop();

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
