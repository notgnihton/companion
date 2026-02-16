import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";
import { syncCourseDeadlines } from "./github-course-sync.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly agents: BaseAgent[] = [
    new NotesAgent(),
    new LecturePlanAgent(),
    new AssignmentTrackerAgent()
  ];

  constructor(private readonly store: RuntimeStore) {}

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

    this.startCourseSync();
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

  private startCourseSync(): void {
    const syncOnce = async (): Promise<void> => {
      try {
        const deadlines = await syncCourseDeadlines();

        if (deadlines.length === 0) {
          return;
        }

        const existingDeadlines = this.store.getDeadlines();
        let created = 0;
        let updated = 0;

        for (const deadline of deadlines) {
          const existing = existingDeadlines.find(
            (d) => d.course === deadline.course && d.task === deadline.task
          );

          if (existing) {
            if (existing.dueDate !== deadline.dueDate) {
              this.store.updateDeadline(existing.id, { dueDate: deadline.dueDate });
              updated += 1;
            }
          } else {
            this.store.createDeadline(deadline);
            created += 1;
          }
        }

        if (created > 0 || updated > 0) {
          this.store.pushNotification({
            source: "orchestrator",
            title: "Course deadlines synced",
            message: `${created} created, ${updated} updated from GitHub`,
            priority: "low"
          });
        }
      } catch (error) {
        this.store.pushNotification({
          source: "orchestrator",
          title: "Course sync failed",
          message: error instanceof Error ? error.message : "unknown error",
          priority: "low"
        });
      }
    };

    void syncOnce();

    const dailyMs = 24 * 60 * 60 * 1000;
    const timer = setInterval(() => {
      void syncOnce();
    }, dailyMs);

    this.timers.push(timer);
  }
}
