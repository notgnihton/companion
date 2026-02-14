import { BaseAgent, AgentContext } from "../agent-base.js";

export class VideoEditorAgent extends BaseAgent {
  readonly name = "video-editor" as const;
  readonly intervalMs = 45_000;

  async run(ctx: AgentContext): Promise<void> {
    ctx.emit(
      this.event(
        "video.digest-ready",
        {
          durationSeconds: 112,
          clips: 5,
          status: "ready"
        },
        "medium"
      )
    );
  }
}
