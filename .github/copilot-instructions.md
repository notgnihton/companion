# Copilot Collaboration Protocol

This repository is managed through an **agent-orchestrated workflow** where GitHub Copilot, Claude, and Codex collaborate recursively.

## Product Context
Companion is a **personal AI companion for a university student at UiS (University of Stavanger)**. It integrates with:
- **Canvas LMS** (`stavanger.instructure.com`) — courses, assignments, deadlines, grades, announcements
- **TP EduCloud** — lecture schedule (DAT520, DAT560, DAT600)
- **Google Gemini** — conversational AI that knows the user's full academic context

The app is a **mobile-first PWA** that the user talks to throughout the day. The chat interface is the primary view. Every AI response is grounded in real data (schedule, deadlines, Canvas, journal history).

## Objective
Keep work moving asynchronously by assigning small, verifiable tasks to agents and tracking outcomes in issues/PRs. The system is self-sustaining: agents complete features, update the roadmap, and the orchestrator creates new issues automatically.

## How agents should work in this repo
1. **Read `docs/project-brief.md` first** — understand the product, architecture, and roadmap.
2. Pick one issue or task at a time.
3. Restate acceptance criteria before coding.
4. Make minimal, focused changes.
5. Run relevant checks locally (`npx tsc --noEmit`, `npx vitest run`).
6. Push to an `agent/<issue-number>-<description>` branch.
   - A PR is **automatically created** with the `agent-task` label
   - The PR template is pre-populated
   - The linked issue receives an update comment
7. Automated workflows then handle:
   - Auto-rebase onto latest `main`
   - Auto-approval via `github-actions[bot]`
   - Auto-merge (if `agent-automerge` label is present)

## Recursive collaboration loop
The system operates in a continuous loop:
1. **Orchestrator** reads `docs/project-brief.md` roadmap → creates issues for `⬜ todo` items
2. **Agents** (Claude/Copilot/Codex) are assigned round-robin → create PRs
3. **Workflows** auto-rebase, approve, and merge PRs
4. **Agents update the roadmap** in their PR: change `⬜ todo` → `✅ done`
5. If an agent discovers new features needed, **add new `⬜ todo` rows** to the roadmap
6. When todos run low, the orchestrator creates an "idea generation" issue
7. Loop repeats on next cron cycle or push to main

**This means every agent PR should update `docs/project-brief.md`** to mark its feature done and optionally propose new work.

## Key technical details for Phase 2

### Gemini Integration
- Use `@google/generative-ai` npm package
- Model: `gemini-2.0-flash` (free tier: 15 RPM, 1M tokens/day)
- API key stored as `GEMINI_API_KEY` environment variable
- Every chat request builds a context window with: today's schedule, upcoming deadlines, recent journal entries, Canvas data, user state
- Keep system prompt concise — the AI should be encouraging, conversational, and proactive

### Canvas LMS Integration
- Base URL: `https://stavanger.instructure.com`
- Auth: Bearer token from `CANVAS_API_TOKEN` env var
- Key endpoints: `/api/v1/courses`, `/api/v1/courses/:id/assignments`, `/api/v1/courses/:id/modules`, `/api/v1/users/self/todo`
- Sync runs as a background cron job every 30 minutes
- Canvas assignments bridge into existing deadline system (avoid duplicates)

### TP EduCloud Integration (iCal Feed)
- **iCal URL**: `https://tp.educloud.no/uis/timeplan/ical.php?type=courseact&sem=26v&id[]=DAT520,1&id[]=DAT560,1&id[]=DAT600,1`
- **Auth**: None required — public iCal feed, no API key needed
- **Format**: Standard iCalendar with VEVENT entries (DTSTART, DTEND, SUMMARY, LOCATION, DESCRIPTION)
- **Parser**: Reuse `parseICS()` from `apps/server/src/calendar-import.ts` — already handles line unfolding and timestamp parsing
- Syncs weekly since semester schedule rarely changes
- 151 events covering lectures, labs, guidance sessions, and exams for all 3 courses

### Course GitHub Organizations
- Course orgs: `dat520-2026` (Distributed Systems, Go), `dat560-2026` (Generative AI, Python)
- Auth: Personal access token from `COURSE_GITHUB_PAT` env var (for private repos)
- Lab assignments in repos: `dat520-2026/assignments` (labs 1-8), `dat560-2026/info` (assignments, exercises, slides)
- Student work repos: `dat520-2026/lucyscript-labs`, `dat520-2026/defnotai` (group), `dat560-2026/assigment1-vae-lucyscript`, `dat560-2026/assigment2-llm-lucyscript`
- Deadlines are in lab README markdown tables — parse with regex
- Sync daily to catch newly pushed labs
- QuickFeed platform (`uis.itest.run`) handles automated grading

## Task decomposition rules
- Prefer tasks that can be completed in one PR.
- Each task must define:
  - Scope (in/out)
  - Deliverable
  - Verification command(s)
- If blocked, create a "blocked" update with proposed unblocking options.

## Codebase conventions
- **Server**: `apps/server/src/` — TypeScript, Node.js
- **Web**: `apps/web/src/` — React + Vite PWA, mobile-first
- **Agent profiles**: `.github/agents/*.agent.md` — read your profile before starting
- **API contracts**: `docs/contracts.md` — update if you change API shapes
- **Tests**: `npx vitest run` in `apps/server` — all tests must pass
- **Types**: `npx tsc --noEmit` — zero errors required
- **GitHub Pages**: Deploys automatically when `apps/web/` changes merge to main

## Agent handoff format
When handing work to another agent, include:
- Current branch
- Files changed
- Remaining TODOs
- Known risks
- Exact next command to run

## Definition of done
A task is done only when:
- Acceptance criteria are met.
- Checks pass (or failure is explained by environment constraints).
- `docs/project-brief.md` roadmap status is updated.
- `docs/contracts.md` is updated if API shapes changed.
- Documentation is updated for behavioral/process changes.
