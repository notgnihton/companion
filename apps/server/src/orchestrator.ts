import { BaseAgent } from "./agent-base.js";
import { AssignmentTrackerAgent } from "./agents/assignment-agent.js";
import { FoodTrackingAgent } from "./agents/food-agent.js";
import { LecturePlanAgent } from "./agents/lecture-plan-agent.js";
import { NotesAgent } from "./agents/notes-agent.js";
import { SocialHighlightsAgent } from "./agents/social-agent.js";
import { VideoEditorAgent } from "./agents/video-agent.js";
import { RuntimeStore } from "./store.js";
import { AgentEvent } from "./types.js";

export class OrchestratorRuntime {
  private timers: NodeJS.Timeout[] = [];
  private readonly agents: BaseAgent[] = [
    new NotesAgent(),
    new LecturePlanAgent(),
    new AssignmentTrackerAgent(),
    new FoodTrackingAgent(),
    new SocialHighlightsAgent(),
    new VideoEditorAgent()
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
  }

  stop(): void {
    for (const timer of this.timers) {
      clearInterval(timer);
    }

    this.timers = [];
  }

  private handleEvent(event: AgentEvent): void {
    this.store.recordEvent(event);

    switch (event.eventType) {
      case "assignment.deadline": {
        const message = `${asText(event.payload, "task")} for ${asText(event.payload, "course")} is approaching.`;
        this.store.pushNotification({
          source: "assignment-tracker",
          title: "Deadline alert",
          message,
          priority: event.priority
        });
        break;
      }
      case "lecture.reminder": {
        this.store.pushNotification({
          source: "lecture-plan",
          title: "Lecture reminder",
          message: `${asText(event.payload, "title")} starts in ${asText(event.payload, "minutesUntil")} min`,
          priority: event.priority
        });
        break;
      }
      case "food.nudge": {
        this.store.pushNotification({
          source: "food-tracking",
          title: "Nutrition nudge",
          message: asText(event.payload, "reminder"),
          priority: event.priority
        });
        break;
      }
      case "social.highlight": {
        this.store.pushNotification({
          source: "social-highlights",
          title: "New highlight",
          message: `${asText(event.payload, "platform")}: ${asText(event.payload, "title")}`,
          priority: "low"
        });
        break;
      }
      case "video.digest-ready": {
        this.store.pushNotification({
          source: "video-editor",
          title: "Digest ready",
          message: `Daily reel generated with ${asText(event.payload, "clips")} clips.`,
          priority: "medium"
        });
        break;
      }
      case "note.prompt": {
        this.store.pushNotification({
          source: "notes",
          title: "Journal prompt",
          message: asText(event.payload, "prompt"),
          priority: "low"
        });
        break;
      }
      default:
        this.store.pushNotification({
          source: "orchestrator",
          title: "Unknown event",
          message: `Unhandled event type: ${event.eventType}`,
          priority: "low"
        });
    }
  }

  private emitBootNotification(): void {
    this.store.pushNotification({
      source: "orchestrator",
      title: "AXIS online",
      message: "All base agents scheduled and running.",
      priority: "medium"
    });
  }
}

function asText(value: unknown, key: string): string {
  if (value && typeof value === "object" && key in value) {
    const parsed = (value as Record<string, unknown>)[key];
    return String(parsed);
  }

  return "n/a";
}
