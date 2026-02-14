import { BaseAgent, AgentContext } from "../agent-base.js";

const suggestions = [
  { reminder: "Hydrate now", reason: "No water log in 2 hours" },
  { reminder: "Protein check", reason: "Lunch protein below target" },
  { reminder: "Add fiber at dinner", reason: "Current intake is low" }
];

export class FoodTrackingAgent extends BaseAgent {
  readonly name = "food-tracking" as const;
  readonly intervalMs = 40_000;

  async run(ctx: AgentContext): Promise<void> {
    const suggestion = suggestions[Math.floor(Math.random() * suggestions.length)];
    ctx.emit(this.event("food.nudge", suggestion, "low"));
  }
}
