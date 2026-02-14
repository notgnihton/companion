import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const schema = z.object({
  PORT: z.coerce.number().default(8787),
  AXIS_TIMEZONE: z.string().default("America/New_York"),
  AXIS_USER_NAME: z.string().default("friend")
});

export const config = schema.parse(process.env);
