import { BaseAgent, AgentContext } from "../agent-base.js";

const prompts = [
  "Capture one thought from your morning that might matter later.",
  "Review yesterday's notes and tag one actionable item.",
  "You had a productive block yesterday. Write what made it work."
];

export class NotesAgent extends BaseAgent {
  readonly name = "notes" as const;
  readonly intervalMs = 30_000;

  async run(ctx: AgentContext): Promise<void> {
    const pick = prompts[Math.floor(Math.random() * prompts.length)];
    ctx.emit(this.event("note.prompt", { prompt: pick }, "low"));
  }
}
