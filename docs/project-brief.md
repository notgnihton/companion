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
| ⬜ todo | `push-notifications` | backend-engineer | VAPID keys, push subscription, service worker |
| ⬜ todo | `nudge-engine` | backend-engineer | Context-aware notification generation |
| ✅ done | `api-docs` | docs-writer | Document all API endpoints in docs/api.md |
| ⬜ todo | `test-coverage` | test-engineer | Add tests for store, orchestrator, and agent modules |
