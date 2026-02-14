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
