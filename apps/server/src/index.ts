import cors from "cors";
import express from "express";
import { z } from "zod";
import { config } from "./config.js";
import { OrchestratorRuntime } from "./orchestrator.js";
import { RuntimeStore } from "./store.js";

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

const contextSchema = z.object({
  stressLevel: z.enum(["low", "medium", "high"]).optional(),
  energyLevel: z.enum(["low", "medium", "high"]).optional(),
  mode: z.enum(["focus", "balanced", "recovery"]).optional()
});

app.post("/api/context", (req, res) => {
  const parsed = contextSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid context payload", issues: parsed.error.issues });
  }

  const updated = store.setUserContext(parsed.data);
  return res.json({ context: updated });
});

// Schedule endpoints
const scheduleSchema = z.object({
  title: z.string().min(1),
  dayOfWeek: z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  location: z.string().optional(),
  notes: z.string().optional()
});

app.post("/api/schedules", (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const schedule = store.createSchedule(parsed.data);
  return res.status(201).json(schedule);
});

app.get("/api/schedules", (_req, res) => {
  const schedules = store.getSchedules();
  return res.json(schedules);
});

app.put("/api/schedules/:id", (req, res) => {
  const { id } = req.params;
  const parsed = scheduleSchema.partial().safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid schedule payload", issues: parsed.error.issues });
  }

  const updated = store.updateSchedule(id, parsed.data);

  if (!updated) {
    return res.status(404).json({ error: "Schedule not found" });
  }

  return res.json(updated);
});

app.delete("/api/schedules/:id", (req, res) => {
  const { id } = req.params;
  const deleted = store.deleteSchedule(id);

  if (!deleted) {
    return res.status(404).json({ error: "Schedule not found" });
  }

  return res.status(204).send();
});

// Deadline endpoints
const deadlineSchema = z.object({
  course: z.string().min(1),
  title: z.string().min(1),
  dueDate: z.string().datetime(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  completed: z.boolean(),
  notes: z.string().optional()
});

app.post("/api/deadlines", (req, res) => {
  const parsed = deadlineSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const deadline = store.createDeadline(parsed.data);
  return res.status(201).json(deadline);
});

app.get("/api/deadlines", (_req, res) => {
  const deadlines = store.getDeadlines();
  return res.json(deadlines);
});

app.put("/api/deadlines/:id", (req, res) => {
  const { id } = req.params;
  const parsed = deadlineSchema.partial().safeParse(req.body ?? {});

  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid deadline payload", issues: parsed.error.issues });
  }

  const updated = store.updateDeadline(id, parsed.data);

  if (!updated) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.json(updated);
});

app.delete("/api/deadlines/:id", (req, res) => {
  const { id } = req.params;
  const deleted = store.deleteDeadline(id);

  if (!deleted) {
    return res.status(404).json({ error: "Deadline not found" });
  }

  return res.status(204).send();
});

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
