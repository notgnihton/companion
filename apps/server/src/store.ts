import { AgentEvent, AgentName, AgentState, DashboardSnapshot, Notification, UserContext } from "./types.js";
import { makeId, nowIso } from "./utils.js";

const agentNames: AgentName[] = [
  "notes",
  "lecture-plan",
  "assignment-tracker",
  "orchestrator"
];

export class RuntimeStore {
  private readonly maxEvents = 100;
  private readonly maxNotifications = 40;
  private events: AgentEvent[] = [];
  private notifications: Notification[] = [];
  private agentStates: AgentState[] = agentNames.map((name) => ({
    name,
    status: "idle",
    lastRunAt: null
  }));

  private userContext: UserContext = {
    stressLevel: "medium",
    energyLevel: "medium",
    mode: "balanced"
  };

  markAgentRunning(name: AgentName): void {
    this.updateAgent(name, {
      status: "running",
      lastRunAt: nowIso()
    });
  }

  markAgentError(name: AgentName): void {
    this.updateAgent(name, {
      status: "error",
      lastRunAt: nowIso()
    });
  }

  recordEvent(event: AgentEvent): void {
    this.events = [event, ...this.events].slice(0, this.maxEvents);
    this.updateAgent(event.source, {
      status: "idle",
      lastRunAt: event.timestamp,
      lastEvent: event
    });
  }

  pushNotification(notification: Omit<Notification, "id" | "timestamp">): void {
    const full: Notification = {
      ...notification,
      id: makeId("notif"),
      timestamp: nowIso()
    };
    this.notifications = [full, ...this.notifications].slice(0, this.maxNotifications);
  }

  setUserContext(next: Partial<UserContext>): UserContext {
    this.userContext = {
      ...this.userContext,
      ...next
    };
    return this.userContext;
  }

  getUserContext(): UserContext {
    return this.userContext;
  }

  getSnapshot(): DashboardSnapshot {
    const pendingDeadlines = this.events.filter((evt) => evt.eventType === "assignment.deadline").length;
    const activeAgents = this.agentStates.filter((a) => a.status === "running").length;

    return {
      generatedAt: nowIso(),
      summary: {
        todayFocus: this.computeFocus(),
        pendingDeadlines,
        activeAgents,
        journalStreak: 0
      },
      agentStates: this.agentStates,
      notifications: this.notifications,
      events: this.events
    };
  }

  private computeFocus(): string {
    if (this.userContext.mode === "focus") {
      return "Deep work + assignment completion";
    }

    if (this.userContext.mode === "recovery") {
      return "Light planning + recovery tasks";
    }

    return "Balanced schedule with deadlines first";
  }

  private updateAgent(name: AgentName, patch: Partial<AgentState>): void {
    this.agentStates = this.agentStates.map((agent) => (agent.name === name ? { ...agent, ...patch } : agent));
  }
}
