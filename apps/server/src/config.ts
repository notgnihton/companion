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
  COURSE_GITHUB_PAT: z.string().optional()
});

export const config = schema.parse(process.env);
