# Companion — Project Brief

## What It Is

A personal AI companion app that knows about your life and proactively helps you stay on track. It runs as a mobile-friendly PWA on your iPhone, sends push notifications, and adapts dynamically to your schedule, goals, and habits.

## Core Experience

You tell Companion about yourself — your lecture schedule, assignments, exams, habits, goals. It remembers everything and nudges you throughout the day:

- **Morning**: "You have Algorithms at 10am, then a 2hr gap — good time for Problem Set 4."
- **Midday**: "How's the focus session going? You said you'd finish the report by 3pm."
- **Evening**: "Ready to journal? Here's what you did today..."

You can journal to it anytime (voice or text). It tracks what you're doing, what you should be doing, and gently nudges you. It's encouraging, not nagging.

## Key Features

1. **Push Notifications (iPhone)** — Nudges, reminders, check-ins based on your schedule and context. Uses web push via the PWA.
2. **Dynamic Schedule Awareness** — Feed it your lecture plan, assignment deadlines, exam dates. It incorporates them and notifies you.
3. **Journaling** — Quick text entries anytime. Evening reflection prompts. The app remembers and references past entries.
4. **Context Tracking** — Update your stress/energy/mode. The app adapts its tone and suggestions.
5. **Assignment & Deadline Tracking** — Knows what's due, reminds you with increasing urgency.
6. **Lecture Plan Integration** — Upload or paste your schedule. It builds around it.
7. **Extensible via APIs** — You can connect external data sources (e.g., food tracking from your "food" repo) in the future.

## What It Is NOT

- Not an App Store app — it's a personal PWA for your phone
- Not a social media aggregator (removed from scope)
- Not a video editor (removed from scope)
- Agents should not add features "just because" — keep it concise and purposeful

## Architecture

- **Frontend**: React + Vite PWA (`apps/web`) — mobile-first, installable on iPhone home screen
- **Backend**: Node + TypeScript (`apps/server`) — API server with agent runtime
- **Data**: In-memory store (RuntimeStore) — can evolve to persistent storage later
- **Notifications**: Web Push API (VAPID keys) for iPhone push notifications

## Agent Modules (Server-Side)

1. **Notes Agent** — Stores and retrieves journal entries and quick notes
2. **Lecture Plan Agent** — Manages class schedule, generates time-aware reminders
3. **Assignment Tracker Agent** — Tracks deadlines, sends escalating reminders
4. **Orchestrator Agent** — Coordinates all agents, generates daily summaries, manages notification priority

### Removed from Scope
- ~~Food Tracking Agent~~ (handled by separate "food" repo for now)
- ~~Social Media Highlights Agent~~ (not needed)
- ~~Video Editor Agent~~ (not needed)

## Success Criteria

- Push notifications actually arrive on your iPhone
- No missed assignment deadlines or lecture reminders
- Journaling feels quick and natural
- App adapts to your schedule without manual babysitting
- Autonomous operation after initial setup

## Roadmap

Features are built in priority order. The orchestrator reads this section to decide what to assign next. Agents update the status as they complete work.

| Status | Feature | Agent | Description |
|--------|---------|-------|-------------|
| ✅ done | `journal-api` | backend-engineer | POST/GET /api/journal endpoints, RuntimeStore storage |
| ✅ done | `journal-ui` | frontend-engineer | JournalView component, localStorage persistence |
| ✅ done | `schedule-api` | backend-engineer | Schedule + deadline CRUD endpoints |
| ✅ done | `schedule-ui` | frontend-engineer | ScheduleView + DeadlineList components |
| ✅ done | `push-notifications` | backend-engineer | VAPID keys, push subscription, service worker |
| ✅ done | `nudge-engine` | backend-engineer | Context-aware notification generation |
| ✅ done | `api-docs` | docs-writer | Document all API endpoints in docs/api.md |
| ✅ done | `test-coverage` | test-engineer | Add tests for store, orchestrator, and agent modules |
| ✅ done | `onboarding-profile` | frontend-engineer | Add first-run onboarding flow to collect name, timezone, baseline schedule, and preferred nudge tone on iPhone. |
| ✅ done | `journal-offline-queue` | backend-engineer | Queue journal writes offline in the PWA and sync them safely when connectivity returns. |
| ✅ done | `notification-settings-ui` | frontend-engineer | Build a settings screen for quiet hours, priority thresholds, and category toggles backed by notification preferences API. |
| ✅ done | `deadline-completion-reminders` | backend-engineer | Add reminders that trigger when a deadline passes without completion and request quick status confirmation. |
| ✅ done | `notification-preferences-api` | backend-engineer | Persist notification settings (quiet hours, urgency rules, category toggles) and apply them in dispatch logic. |
| ✅ done | `journal-sync-conflict-resolution` | backend-engineer | Add journal sync/versioning support so offline writes can be merged safely without data loss. |
| ✅ done | `weekly-review-digest` | backend-engineer | Generate a weekly summary API from deadlines, completed tasks, and journal highlights for Sunday evening reflection. |
| ✅ done | `calendar-import-api` | backend-engineer | Add calendar import endpoints (ICS/URL) that normalize events into lecture/deadline records. |
| ✅ done | `notification-delivery-retries` | backend-engineer | Add retry/backoff + failure tracking for web-push deliveries to improve iPhone notification reliability. |
| ✅ done | `persistent-runtime-storage` | backend-engineer | Replace in-memory RuntimeStore with file-backed persistence (SQLite) so schedules, deadlines, preferences, and journals survive restarts. |
| ✅ done | `calendar-import-ui` | frontend-engineer | Add a Calendar Import screen in the PWA to paste ICS text or URL and review imported lecture/deadline records before applying. |
| ⬜ todo | `deadline-status-confirmation-ui` | frontend-engineer | Add UI quick actions for overdue reminders so users can confirm completed/still-working status from notifications or deadline cards. |
| ✅ done | `weekly-review-ui` | frontend-engineer | Build a weekly reflection view that renders `/api/weekly-review` with completion rate, highlights, and suggested next priorities. |
