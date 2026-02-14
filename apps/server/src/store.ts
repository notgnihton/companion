import { AgentEvent, AgentName, AgentState, DashboardSnapshot, Notification, UserContext, ScheduleEntry, Deadline } from "./types.js";
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

  private schedules: ScheduleEntry[] = [];
  private deadlines: Deadline[] = [];

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

  // Schedule CRUD
  createSchedule(entry: Omit<ScheduleEntry, "id" | "createdAt">): ScheduleEntry {
    const schedule: ScheduleEntry = {
      ...entry,
      id: makeId("schedule"),
      createdAt: nowIso()
    };
    this.schedules.push(schedule);
    return schedule;
  }

  getSchedules(): ScheduleEntry[] {
    return this.schedules;
  }

  updateSchedule(id: string, patch: Partial<Omit<ScheduleEntry, "id" | "createdAt">>): ScheduleEntry | null {
    const index = this.schedules.findIndex((s) => s.id === id);
    if (index === -1) return null;

    this.schedules[index] = {
      ...this.schedules[index],
      ...patch
    };
    return this.schedules[index];
  }

  deleteSchedule(id: string): boolean {
    const index = this.schedules.findIndex((s) => s.id === id);
    if (index === -1) return false;

    this.schedules.splice(index, 1);
    return true;
  }

  // Deadline CRUD
  createDeadline(deadline: Omit<Deadline, "id" | "createdAt">): Deadline {
    const full: Deadline = {
      ...deadline,
      id: makeId("deadline"),
      createdAt: nowIso()
    };
    this.deadlines.push(full);
    return full;
  }

  getDeadlines(): Deadline[] {
    return this.deadlines;
  }

  updateDeadline(id: string, patch: Partial<Omit<Deadline, "id" | "createdAt">>): Deadline | null {
    const index = this.deadlines.findIndex((d) => d.id === id);
    if (index === -1) return null;

    this.deadlines[index] = {
      ...this.deadlines[index],
      ...patch
    };
    return this.deadlines[index];
  }

  deleteDeadline(id: string): boolean {
    const index = this.deadlines.findIndex((d) => d.id === id);
    if (index === -1) return false;

    this.deadlines.splice(index, 1);
    return true;
  }
}
