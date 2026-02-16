import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { CanvasSyncAgent } from "./agents/canvas-sync-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { CanvasSyncService } from "./canvas-sync.js";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly agents: BaseAgent[];

  constructor(private readonly store: RuntimeStore) {
    const canvasSync = new CanvasSyncService();
    this.agents = [
      new NotesAgent(),
      new LecturePlanAgent(),
      new AssignmentTrackerAgent(),
      new CanvasSyncAgent(store, canvasSync)
    ];
  }

  start(): void {
    this.emitBootNotification();

    for (const agent of this.agents) {
      const runOnce = async (): Promise<void> => {
        this.store.markAgentRunning(agent.name);

        try {
          await agent.run({
            emit: (event) => this.handleEvent(event)
          });
        } catch (error) {
          this.store.markAgentError(agent.name);
          this.store.pushNotification({
            source: "orchestrator",
            title: `${agent.name} failed`,
            message: error instanceof Error ? error.message : "unknown runtime error",
            priority: "high"
          });
        }
      };

      void runOnce();
      const timer = setInterval(() => {
        void runOnce();
      }, agent.intervalMs);

      this.timers.push(timer);
    }
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }

    this.timers = [];
  }

  private handleEvent(event: AgentEvent): void {
    this.store.recordEvent(event);
    const context = this.store.getUserContext();
    const nudge = buildContextAwareNudge(event, context);

    if (nudge) {
      this.store.pushNotification(nudge);
      return;
    }

    this.store.pushNotification({
      source: "orchestrator",
      title: "Unknown event",
      message: `Unhandled event type: ${event.eventType}`,
      priority: "low"
    });
  }

  private emitBootNotification(): void {
    this.store.pushNotification({
      source: "orchestrator",
      title: "Companion online",
      message: "All agents scheduled and running.",
      priority: "medium"
    });
  }
}
