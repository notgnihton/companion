import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { buildContextAwareNudge } from "./nudge-engine.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { RuntimeStore } from "./store.js";
import { calculateOptimalNotificationTime } from "./smart-timing.js";
import { AgentEvent } from "./types.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly deadlineReminderIntervalMs = 60_000;
  private readonly deadlineReminderCooldownMinutes = 180;
  private readonly scheduledNotificationCheckIntervalMs = 30_000;
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

    // Process scheduled notifications
    this.processScheduledNotifications();
    const scheduledNotifTimer = setInterval(() => {
      this.processScheduledNotifications();
    }, this.scheduledNotificationCheckIntervalMs);
    this.timers.push(scheduledNotifTimer);
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
      // Use smart timing to schedule notification
      const isUrgent = nudge.priority === "critical" || nudge.priority === "high";
      
      if (isUrgent) {
        // Urgent notifications go out immediately
        this.store.pushNotification(nudge);
      } else {
        // Non-urgent notifications are scheduled for optimal time
        const optimalTime = calculateOptimalNotificationTime(
          {
            scheduleEvents: this.store.getScheduleEvents(),
            deadlines: this.store.getDeadlines(),
            userContext: context,
            deadlineHistory: this.store.getAllDeadlineReminderStates(),
            currentTime: new Date()
          },
          false
        );

        this.store.scheduleNotification(nudge, optimalTime, event.id);
      }
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

      // Overdue reminders are always urgent
      this.store.pushNotification({
        source: "assignment-tracker",
        title: "Deadline status check",
        message: `${deadline.task} for ${deadline.course} is overdue by ${overdueHours}h. Mark complete or let me know you're still working.`,
        priority: deadline.priority === "critical" || overdueHours >= 24 ? "critical" : "high",
        metadata: {
          deadlineId: deadline.id
        },
        actions: ["complete", "working", "view"],
        url: "/companion/"
      });
    }
  }

  /**
   * Process scheduled notifications that are now due
   */
  private processScheduledNotifications(): void {
    const dueNotifications = this.store.getDueScheduledNotifications();

    for (const scheduled of dueNotifications) {
      // Push the notification immediately
      this.store.pushNotification(scheduled.notification);
      
      // Remove from scheduled queue
      this.store.removeScheduledNotification(scheduled.id);
    }
  }
}
