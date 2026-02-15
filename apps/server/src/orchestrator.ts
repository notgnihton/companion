import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly deadlineReminderIntervalMs = 60_000;
  private readonly deadlineReminderCooldownMinutes = 180;
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

    this.emitOverdueDeadlineReminders();
    const deadlineReminderTimer = setInterval(() => {
      this.emitOverdueDeadlineReminders();
    }, this.deadlineReminderIntervalMs);
    this.timers.push(deadlineReminderTimer);
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

  private emitOverdueDeadlineReminders(): void {
    const overdueDeadlines = this.store.getOverdueDeadlinesRequiringReminder(
      new Date().toISOString(),
      this.deadlineReminderCooldownMinutes
    );

    for (const deadline of overdueDeadlines) {
      const reminder = this.store.recordDeadlineReminder(deadline.id);

      if (!reminder) {
        continue;
      }

      const overdueMs = Date.now() - new Date(deadline.dueDate).getTime();
      const overdueHours = Math.max(1, Math.floor(overdueMs / (60 * 60 * 1000)));

      this.store.pushNotification({
        source: "assignment-tracker",
        title: "Deadline status check",
        message: `${deadline.task} for ${deadline.course} is overdue by ${overdueHours}h. Confirm status via POST /api/deadlines/${deadline.id}/confirm-status.`,
        priority: deadline.priority === "critical" || overdueHours >= 24 ? "critical" : "high"
      });
    }
  }
}
