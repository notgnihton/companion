# Reusable Prompt For Coding Agents

Use this when delegating work to Codex, Claude, or Copilot.

```md
You are helping build AXIS, a personal AI companion web app.

Context:
- Frontend: React + Vite (`apps/web`)
- Backend orchestrator: Node + TypeScript (`apps/server`)
- Contracts: `docs/contracts.md`
- Agent workflow rules: `.agents/ORCHESTRATION.md`

Your task:
- Ticket: <ID + title>
- Allowed paths: <explicit path list>
- Out-of-scope paths: <explicit path list>
- Acceptance criteria: <bullet list>

Rules:
1. Do not touch files outside allowed paths.
2. Keep changes small and composable.
3. If API contracts change, update `docs/contracts.md` in the same PR.
4. Provide verification steps and risks in your final message.
```
