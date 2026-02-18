import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const env = {
  ...process.env,
  TIMEZONE: process.env.TIMEZONE ?? process.env.AXIS_TIMEZONE,
  USER_NAME: process.env.USER_NAME ?? process.env.AXIS_USER_NAME,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY ?? process.env.AXIS_VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY ?? process.env.AXIS_VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? process.env.AXIS_VAPID_SUBJECT,
  FALLBACK_EMAIL: process.env.FALLBACK_EMAIL ?? process.env.AXIS_FALLBACK_EMAIL,
  NOTES_PROVIDER: process.env.NOTES_PROVIDER ?? process.env.AXIS_NOTES_PROVIDER,
  ASSIGNMENT_PROVIDER: process.env.ASSIGNMENT_PROVIDER ?? process.env.AXIS_ASSIGNMENT_PROVIDER,
  FOOD_PROVIDER: process.env.FOOD_PROVIDER ?? process.env.AXIS_FOOD_PROVIDER,
  SOCIAL_PROVIDER: process.env.SOCIAL_PROVIDER ?? process.env.AXIS_SOCIAL_PROVIDER,
  VIDEO_PROVIDER: process.env.VIDEO_PROVIDER ?? process.env.AXIS_VIDEO_PROVIDER,
  GITHUB_PAT: process.env.GITHUB_PAT,
  GEMINI_VERTEX_PROJECT_ID: process.env.GEMINI_VERTEX_PROJECT_ID ?? process.env.GCP_PROJECT_ID,
  GEMINI_VERTEX_LOCATION: process.env.GEMINI_VERTEX_LOCATION ?? process.env.GCP_LOCATION,
  GOOGLE_SERVICE_ACCOUNT_JSON:
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
};

function parseBooleanEnv(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  DATABASE_URL: z.string().url().optional(),
  SQLITE_DB_PATH: z.string().default("companion.db"),
  TIMEZONE: z.string().default("America/New_York"),
  USER_NAME: z.string().default("friend"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default("mailto:companion@example.com"),
  FALLBACK_EMAIL: z.string().email().default("user@example.com"),
  NOTES_PROVIDER: z.string().default("local"),
  ASSIGNMENT_PROVIDER: z.string().default("manual"),
  FOOD_PROVIDER: z.string().default("manual"),
  SOCIAL_PROVIDER: z.string().default("manual"),
  VIDEO_PROVIDER: z.string().default("manual"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_USE_LIVE_API: z
    .preprocess((value) => parseBooleanEnv(value), z.boolean())
    .default(true),
  GEMINI_LIVE_MODEL: z.string().default("gemini-2.5-flash"),
  GEMINI_GROWTH_IMAGE_MODEL: z.string().default("nano-banana-pro"),
  GEMINI_LIVE_ENDPOINT: z.string().url().optional(),
  GEMINI_VERTEX_PROJECT_ID: z.string().optional(),
  GEMINI_VERTEX_LOCATION: z.string().default("us-central1"),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GEMINI_LIVE_TIMEOUT_MS: z.coerce.number().int().min(3000).max(120000).default(60000),
  GROWTH_DAILY_SUMMARY_MIN_REFRESH_MINUTES: z.coerce.number().int().min(30).max(24 * 24).default(180),
  GROWTH_ANALYTICS_MIN_REFRESH_MINUTES: z.coerce.number().int().min(60).max(24 * 60 * 14).default(480),
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CHANNEL_IDS: z.string().optional(),
  YOUTUBE_FALLBACK_QUERIES: z.string().optional(),
  CANVAS_API_TOKEN: z.string().optional(),
  CANVAS_BASE_URL: z.string().default("https://stavanger.instructure.com"),
  GITHUB_PAT: z.string().optional(),
  X_API_KEY: z.string().optional(),
  X_API_KEY_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  X_FALLBACK_QUERY: z.string().optional(),
  WITHINGS_API_ENDPOINT: z.string().url().default("https://wbsapi.withings.net"),
  WITHINGS_CLIENT_ID: z.string().optional(),
  WITHINGS_API_SECRET: z.string().optional(),
  WITHINGS_CALLBACK_URL: z.string().url().default("http://localhost:8787/api/auth/withings/callback"),
  WITHINGS_SCOPE: z.string().default("user.metrics,user.activity"),
  WITHINGS_ACCESS_TOKEN: z.string().optional(),
  WITHINGS_REFRESH_TOKEN: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  GMAIL_ACCESS_TOKEN: z.string().optional(),
  GMAIL_REFRESH_TOKEN: z.string().optional(),
  INTEGRATION_WINDOW_PAST_DAYS: z.coerce.number().int().min(0).default(30),
  INTEGRATION_WINDOW_FUTURE_DAYS: z.coerce.number().int().min(1).default(180),
  NOTIFICATION_DIGEST_MORNING_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  NOTIFICATION_DIGEST_EVENING_HOUR: z.coerce.number().int().min(0).max(23).default(18),
  AUTH_REQUIRED: z
    .preprocess((value) => parseBooleanEnv(value), z.boolean())
    .default((process.env.NODE_ENV ?? "development") === "production"),
  AUTH_ADMIN_EMAIL: z.string().email().optional(),
  AUTH_ADMIN_PASSWORD: z.string().min(8).optional(),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24 * 90).default(24 * 30)
});

export const config = schema.parse(env);
