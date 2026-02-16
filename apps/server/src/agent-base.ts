import { AgentEvent, AgentName, Priority } from "./types.js";
import { RuntimeStore } from "./store.js";
import { makeId, nowIso } from "./utils.js";

export interface AgentContext {
  emit: (event: AgentEvent) => void;
  getStore: () => RuntimeStore;
}

export abstract class BaseAgent {
  abstract readonly name: AgentName;
  abstract readonly intervalMs: number;

  abstract run(ctx: AgentContext): Promise<void>;

  protected event<T>(eventType: string, payload: T, priority: Priority = "medium"): AgentEvent<T> {
    return {
      id: makeId(this.name),
      source: this.name,
      eventType,
      priority,
      timestamp: nowIso(),
      payload
    };
  }
}
