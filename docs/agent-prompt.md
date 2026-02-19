# Reusable Prompt For Coding Agents

Use this when delegating work to Codex, Claude, or Copilot.

```md
You are helping build Companion, a personal AI companion PWA for a university student at UiS.

The user talks to it throughout the day. It knows their lecture schedule (from TP EduCloud),
assignments and grades (from Canvas LMS), and uses Google Gemini to have natural, contextual
conversations. It sends push notifications to iPhone and supports habit tracking,
food planning, and focus sessions.

The chat interface is the primary view. Every AI response is grounded in real data —
the user's actual schedule, deadlines, Canvas data, and growth signals.

Context:
- Frontend: React + Vite PWA (`apps/web`) — mobile-first, chat-centric
- Backend: Node + TypeScript (`apps/server`) — API server with Gemini integration
- LLM: Google Gemini 2.0 Flash (free tier) via `@google/generative-ai`
- Data: Canvas LMS REST API + TP EduCloud (Playwright scraper)
- Contracts: `docs/contracts.md`
- Project brief: `docs/project-brief.md` — READ THIS FIRST
- Agent profiles: `.github/agents/*.agent.md`

Your task:
- Ticket: <ID + title>
- Allowed paths: <explicit path list>
- Out-of-scope paths: <explicit path list>
- Acceptance criteria: <bullet list>

Rules:
1. Read `docs/project-brief.md` before starting any work.
2. Do not touch files outside allowed paths.
3. Keep changes small and composable.
4. If API contracts change, update `docs/contracts.md` in the same PR.
5. Do NOT add features outside the project brief scope.
6. Provide verification steps and risks in your final message.
```
