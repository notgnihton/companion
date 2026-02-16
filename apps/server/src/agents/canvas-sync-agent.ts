import { AgentContext, BaseAgent } from "../agent-base.js";
import { CanvasSyncService } from "../canvas-sync.js";
import { RuntimeStore } from "../store.js";

export class CanvasSyncAgent extends BaseAgent {
  readonly name = "orchestrator" as const;
  readonly intervalMs = 30 * 60 * 1000; // 30 minutes

  constructor(
    private readonly store: RuntimeStore,
    private readonly canvasSync: CanvasSyncService
  ) {
    super();
  }

  async run(ctx: AgentContext): Promise<void> {
    if (!this.canvasSync.isConfigured()) {
      return;
    }

    try {
      const data = await this.canvasSync.syncAll();
      this.store.updateCanvasData(data);

      const assignmentCount = data.assignments.length;
      const courseCount = data.courses.length;

      ctx.emit(
        this.event(
          "canvas.sync.complete",
          {
            courses: courseCount,
            assignments: assignmentCount,
            modules: data.modules.length,
            announcements: data.announcements.length
          },
          "low"
        )
      );
    } catch (error) {
      ctx.emit(
        this.event(
          "canvas.sync.failed",
          {
            error: error instanceof Error ? error.message : "Unknown error"
          },
          "medium"
        )
      );
    }
  }
}
