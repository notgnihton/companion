export type AgentName =
  | "notes"
  | "lecture-plan"
  | "assignment-tracker"
  | "food-tracking"
  | "social-highlights"
  | "video-editor"
  | "orchestrator";

export type Priority = "low" | "medium" | "high" | "critical";

export interface AgentEvent {
  id: string;
  source: AgentName;
  eventType: string;
  priority: Priority;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  priority: Priority;
  source: AgentName;
  timestamp: string;
}

export interface AgentState {
  name: AgentName;
  status: "idle" | "running" | "error";
  lastRunAt: string | null;
}

export interface DashboardSnapshot {
  generatedAt: string;
  summary: {
    todayFocus: string;
    pendingDeadlines: number;
    mealCompliance: number;
    digestReady: boolean;
  };
  agentStates: AgentState[];
  notifications: Notification[];
  events: AgentEvent[];
}

export interface UserContext {
  stressLevel: "low" | "medium" | "high";
  energyLevel: "low" | "medium" | "high";
  mode: "focus" | "balanced" | "recovery";
}
