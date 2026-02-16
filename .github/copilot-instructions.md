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

### Before you start coding
1. **Read `docs/project-brief.md` first** — understand the product, architecture, and roadmap.
2. **Read your agent profile** in `.github/agents/` — understand your domain boundaries.
3. **Read `docs/contracts.md`** if your task involves API endpoints.
4. **Read the issue carefully** — restate acceptance criteria before writing any code.
5. **Check what files other open PRs touch** — avoid editing the same files as another agent. If overlap is unavoidable, coordinate via the issue.

### Token budget awareness
Each agent session has a **per-task token limit** (separate from the monthly quota). To avoid hitting it:
- **Keep tasks small.** If an issue feels like it needs 5+ files changed, ask for it to be split.
- **Don't start MCP servers you don't need.** Playwright and GitHub MCP servers burn tokens just initializing. Only use them if the task requires browser testing or GitHub API calls.
- **Don't read entire directories.** Read only the files relevant to your task.
- **Commit early.** If you've made good progress but feel the task is getting large, commit what you have and push — a partial PR is better than a crashed session.
- **Skip exploratory browsing.** Don't explore the codebase "just to understand" — read your agent profile and the project brief instead.

### While coding
1. Make minimal, focused changes — **one concern per PR**.
2. Stay within your domain (backend agent → `apps/server/`, frontend → `apps/web/`).
3. Follow existing patterns — check the file you're editing before inventing new approaches.
4. Run relevant checks: `npx tsc --noEmit` and `npx vitest run` (in `apps/server/`).

### Pushing your work
1. Push to an `agent/<issue-number>-<description>` branch.
   - A PR is **automatically created** with the `agent-task` label.
   - The PR template is pre-populated.
   - The linked issue receives an update comment.
2. Automated workflows then handle:
   - Auto-rebase onto latest `main`
   - Auto-approval via `github-actions[bot]`
   - Auto-merge (if `agent-automerge` label is present)

### MCP server usage policy
**⛔ NEVER start Playwright or GitHub MCP servers.** Every task in this repo is a pure coding task. Starting MCP servers wastes your entire token budget on initialization and causes 100% failure rate. Just read files, write code, and run tests.

| Server | When to use | When NOT to use |
|--------|------------|----------------|
| **Playwright** | NEVER — not needed for any task in this repo | ALL tasks |
| **GitHub MCP** | NEVER — all files are in the workspace already | ALL tasks |
| **Neither** | ✅ Correct choice for every task | — |

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

### Deployment Status
> The frontend deploys to **GitHub Pages** (static only). The backend (`apps/server`) runs **locally only** — no production server yet. API calls return 404 on GitHub Pages; the frontend uses offline-first fallback. Phase 4 will add proper server hosting.

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

### YouTube Data API v3
- Auth: API key from `YOUTUBE_API_KEY` env var
- Key endpoints: `subscriptions`, `search` (channel uploads), `videos` (metadata)
- Quota: 10,000 units/day — cache aggressively, sync every 6 hours
- Used for social media digest feature (Gemini summarizes video content)

### X (Twitter) API v2
- Auth: OAuth 1.0a — `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` env vars
- App-only bearer token: `X_BEARER_TOKEN` env var
- Key endpoints: `/2/users/:id/timelines/reverse_chronological` (home timeline), `/2/tweets/search/recent`
- Sync every 4 hours, Gemini summarizes into AI newsletter-style digest
- Free tier: 100 reads/month; Basic tier: 10K reads/month

### Twitch API
- Auth: TBD (client credentials from Twitch Developer Console)
- Key endpoints: `/helix/streams/followed` (live status), `/helix/users/follows`
- Poll every 15 minutes for live stream alerts

### Gmail API
- Auth: OAuth 2.0 — `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` env vars + user-granted refresh token
- Scope: `gmail.readonly` (read-only inbox access)
- Key endpoints: `/gmail/v1/users/me/messages` (list), `/gmail/v1/users/me/messages/:id` (details)
- Used for mailbox summary in LLM context (subjects + snippets, not full bodies)
- Sync every 30 minutes

## Task decomposition rules

### Task sizing (critical for agent success)
Agent sessions have hard token limits. Tasks MUST be small enough to complete in one session:
- **Good size**: 1-3 files changed, one clear feature or fix, < 200 lines of new code
- **Too large**: 5+ files, multiple interconnected features, building an entire subsystem
- **If you receive a large task**: Implement the core piece and note remaining work in the PR description. Do NOT try to do everything.

### Examples of good vs bad task scoping
| ❌ Too large (will hit token limit) | ✅ Right size |
|----|----|
| "Build intelligent context window for Gemini calls" | "Create context-builder utility that assembles schedule + deadline data" |
| "Add Canvas LMS integration with sync service" | "Add Canvas API client with course-fetching endpoint" |
| "Redesign app layout with tab navigation" | "Add bottom tab bar component with routing" |

### Task requirements
- Each task must define:
  - Scope (in/out)
  - Deliverable
  - Verification command(s)
- If blocked, create a "blocked" update with proposed unblocking options.
- If the task is too large, implement a focused subset and document what remains.

## Codebase conventions
- **Server**: `apps/server/src/` — TypeScript, Node.js
- **Web**: `apps/web/src/` — React + Vite PWA, mobile-first
- **Agent profiles**: `.github/agents/*.agent.md` — read your profile before starting
- **API contracts**: `docs/contracts.md` — update if you change API shapes
- **Tests**: `npx vitest run` in `apps/server` — all tests must pass
- **Types**: `npx tsc --noEmit` — zero errors required
- **GitHub Pages**: Deploys automatically when `apps/web/` changes merge to main

## Avoiding conflicts between agents
Multiple agents work in parallel. To avoid merge conflicts:
1. **Stay in your lane** — backend agent only touches `apps/server/`, frontend only `apps/web/`.
2. **Never edit `docs/project-brief.md` roadmap and code in the same PR** — if your code PR also needs a roadmap update, make the code change first and note the roadmap update needed.
3. **Check open PRs before editing shared files** — `types.ts`, `store.ts`, `index.ts`, and `App.tsx` are high-conflict files. If another PR already edits them, add your changes in a compatible way (e.g., append to interfaces, don't restructure).
4. **Prefer new files over editing existing ones** — Creating `apps/server/src/canvas-sync.ts` is safer than adding 100 lines to `index.ts`.
5. **If your PR can't merge due to conflicts**, don't worry — the automation will close it and create a fresh issue. Your work isn't lost.

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
