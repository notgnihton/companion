import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  AXIS_TIMEZONE: z.string().default("America/New_York"),
  AXIS_USER_NAME: z.string().default("friend"),
  AXIS_VAPID_PUBLIC_KEY: z.string().optional(),
  AXIS_VAPID_PRIVATE_KEY: z.string().optional(),
  AXIS_VAPID_SUBJECT: z.string().default("mailto:companion@example.com"),
  AXIS_FALLBACK_EMAIL: z.string().email().default("user@example.com"),
  GEMINI_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  CANVAS_API_TOKEN: z.string().optional(),
  CANVAS_BASE_URL: z.string().default("https://stavanger.instructure.com"),
  COURSE_GITHUB_PAT: z.string().optional(),
  X_API_KEY: z.string().optional(),
  X_API_KEY_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional(),
  GMAIL_CLIENT_ID: z.string().optional(),
  GMAIL_CLIENT_SECRET: z.string().optional()
});

export const config = schema.parse(process.env);
