import { BaseAgent, AgentContext } from "../agent-base.js";

const topics = [
  { platform: "YouTube", title: "AI tooling workflow update", relevance: 0.86 },
  { platform: "Reddit", title: "Best study systems for CS students", relevance: 0.79 },
  { platform: "X", title: "Productivity thread with strong signal", relevance: 0.73 }
];

export class SocialHighlightsAgent extends BaseAgent {
  readonly name = "social-highlights" as const;
  readonly intervalMs = 25_000;

  async run(ctx: AgentContext): Promise<void> {
    const item = topics[Math.floor(Math.random() * topics.length)];
    ctx.emit(this.event("social.highlight", item, "medium"));
  }
}
