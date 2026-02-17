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
  VIDEO_PROVIDER: process.env.VIDEO_PROVIDER ?? process.env.AXIS_VIDEO_PROVIDER
};

const schema = z.object({
  PORT: z.coerce.number().default(8787),
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
  YOUTUBE_API_KEY: z.string().optional(),
  YOUTUBE_CHANNEL_IDS: z.string().optional(),
  YOUTUBE_FALLBACK_QUERIES: z.string().optional(),
  CANVAS_API_TOKEN: z.string().optional(),
  CANVAS_BASE_URL: z.string().default("https://stavanger.instructure.com"),
  COURSE_GITHUB_PAT: z.string().optional(),
  X_API_KEY: z.string().optional(),
  X_API_KEY_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional(),
  INTEGRATION_WINDOW_PAST_DAYS: z.coerce.number().int().min(0).default(30),
  INTEGRATION_WINDOW_FUTURE_DAYS: z.coerce.number().int().min(1).default(180),
  NOTIFICATION_DIGEST_MORNING_HOUR: z.coerce.number().int().min(0).max(23).default(8),
  NOTIFICATION_DIGEST_EVENING_HOUR: z.coerce.number().int().min(0).max(23).default(18)
});

export const config = schema.parse(env);
