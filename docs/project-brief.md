# Companion — Project Brief

## What It Is

A personal AI companion that knows your entire academic life and talks to you throughout the day. It pulls your lecture schedule from **TP EduCloud**, your assignments and grades from **Canvas LMS**, and uses **Google Gemini** to have natural conversations about your day — planning, reflecting, problem-solving, or just chatting. It runs as a mobile-first PWA on your iPhone with push notifications.

## Core Experience

Companion is like a knowledgeable friend who has read your entire syllabus. You open it and talk:

- **Morning**: "What's my day look like?" → "You've got DAT520 Distributed Systems at 10:15, then nothing until DAT560 at 14:15. That's a 3-hour gap — want to work on the DAT600 thesis proposal? It's due in 9 days."
- **Between classes**: "Summarize what I need to prep for DAT560" → pulls your Canvas modules, recent announcements, upcoming quiz.
- **Working**: "I'm stuck on the MapReduce assignment" → discusses the problem with you, references lecture notes from Canvas, suggests approaches.
- **Evening**: "How was today?" → reflects on what you accomplished, what's coming tomorrow, suggests priorities.
- **Catching up**: "What did I miss on X today?" → summarizes trending AI news, threads from accounts you follow, new YouTube uploads from your subscriptions.
- **Proactive nudge** (push notification): "Heads up — DAT520 assignment 3 is due in 48 hours and you haven't submitted yet."

The key difference from a generic chatbot: Companion has **context**. It knows your exact schedule, every deadline, your grades, your journal history, and your energy patterns. Every response is grounded in your real data.

## Key Features

### Conversational AI (NEW — Core Feature)
- **Chat interface** — Natural conversation with an AI that knows your academic context
- **Gemini integration** — Google Gemini API (free tier: 15 RPM, 1M tokens/day) as the LLM backend
- **Context-aware responses** — Every LLM call includes relevant schedule, deadlines, recent journal entries, and Canvas data as context
- **Conversation memory** — Chat history persisted so the AI remembers previous conversations
- **Proactive messages** — The AI initiates conversations based on triggers (upcoming deadline, schedule gap, missed habit)

### Data Integrations (NEW — Automated Sync)
- **Canvas LMS sync** — Pulls courses, assignments, deadlines, announcements, grades, and modules from `stavanger.instructure.com` via Canvas REST API with a personal access token
- **TP EduCloud sync** — Pulls lecture schedule from UiS TP (DAT520, DAT560, DAT600) via public iCal subscription feed (no auth required)
- **Course GitHub sync** — Pulls lab assignments, deadlines, and descriptions from course GitHub organizations (`dat520-2026`, `dat560-2026`) via GitHub API
- **Auto-refresh** — Background jobs sync Canvas every ~30 min, TP weekly, and GitHub daily (schedules rarely change mid-semester)

### Social Media Summary (NEW — Content Digest)
- **YouTube digest** — Fetches recent uploads from subscribed channels via YouTube Data API v3, summarizes video titles/descriptions using Gemini
- **X (Twitter) feed summary** — Pulls timeline/list tweets via X API v2, uses Gemini to create an AI newsletter-style digest of trending topics and key threads
- **AI-powered summarization** — Gemini condenses hours of social media into a 2-minute read, grouped by topic (AI news, tech, entertainment)
- **Platforms**: YouTube, X (Twitter)

### Existing Features (Already Built)
1. **Push Notifications** — Web Push via VAPID keys to iPhone
2. **Journaling** — Quick text/voice entries, tags, photo attachments, search
3. **Schedule & Deadline Tracking** — With smart suggestions for work blocks
4. **Context Tracking** — Stress/energy/mode affects notification tone
5. **Habits & Goals** — Streaks, check-ins, grace periods
6. **Weekly Review** — Auto-generated summary of your week
7. **Focus Timer** — Pomodoro-style sessions
8. **Dark Mode, Offline Support, Background Sync**

## What It Is NOT

- Not a generic AI chatbot — it's deeply integrated with YOUR academic data
- Not an App Store app — it's a personal PWA for your phone
- Not a study tool / flashcard app — it's a companion that helps you manage your time
- Agents should not add features "just because" — keep it concise and purposeful

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    iPhone PWA                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Chat UI  │ │Dashboard │ │ Journal/Schedule/etc  │ │
│  └────┬─────┘ └────┬─────┘ └──────────┬───────────┘ │
│       └─────────────┴─────────────────┘              │
│                     │ REST API                        │
├─────────────────────┼───────────────────────────────┤
│              Node.js Server                          │
│  ┌─────────┐ ┌──────────┐ ┌───────────┐ ┌────────┐ │
│  │ Gemini  │ │  Canvas  │ │TP EduCloud│ │ GitHub │ │
│  │ Client  │ │  Sync    │ │ iCal Sync │ │  Sync  │ │
│  └────┬────┘ └────┬─────┘ └─────┬─────┘ └───┬────┘ │
│  ┌─────────────────────────────────────────────┐    │
│  │  Social Media: YouTube │ X (Twitter)         │    │
│  └─────────────────────────────────────────────┘    │
│       │           │             │            │       │
│  ┌────┴───────────┴─────────────┴────────────┴──┐   │
│  │         RuntimeStore (SQLite)             │       │
│  │  schedule │ deadlines │ canvas │ chat     │       │
│  └───────────────────────────────────────────┘       │
│       │                                              │
│  ┌────┴─────────────────────────┐                   │
│  │  Orchestrator + Agent Runtime │                   │
│  │  nudge-engine │ smart-timing  │                   │
│  └──────────────────────────────┘                   │
└─────────────────────────────────────────────────────┘
         │                    ▲
         │ Web Push           │ Gemini API
         ▼                    │ Canvas API
      iPhone               External    TP API / GitHub API
```

- **Frontend**: React + Vite PWA (`apps/web`) — mobile-first, installable on iPhone home screen
- **Backend**: Node + TypeScript (`apps/server`) — API server with agent runtime
- **LLM**: Google Gemini API (free tier) — conversational AI with academic context
- **Data**: RuntimeStore (SQLite-backed) — schedule, deadlines, journals, canvas data, chat history
- **Integrations**: Canvas REST API (token auth) + TP EduCloud iCal feed (public, no auth) + Course GitHub orgs (PAT auth) + YouTube Data API v3 + X API v2
- **Notifications**: Web Push API (VAPID keys) for proactive nudges

## Deployment Status

> **IMPORTANT: Agents must understand the current hosting situation.**

| Component | Status | Details |
|-----------|--------|--------|
| **Frontend** (`apps/web`) | ✅ Deployed | GitHub Pages — static files only, auto-deploys on push to `main` |
| **Backend** (`apps/server`) | ✅ Deployment ready | Railway-ready with Dockerfile, health checks, and workflow. Awaiting production deployment. |
| **API calls** | ✅ Configurable | In dev: Vite proxies `/api/*` → `localhost:8787`. In prod: configurable via `VITE_API_BASE_URL` secret. |
| **Database** | ⚠️ Ephemeral | SQLite in-memory on Railway (ephemeral storage). For persistence, add Railway volume or migrate to PostgreSQL. |
| **Cron jobs/sync** | ✅ Ready | Canvas, TP, GitHub, YouTube, X sync services run automatically when server starts. |
| **Push notifications** | ✅ Ready | Web Push configured with VAPID keys (set via Railway environment variables). |

**What this means for agents:**
- Backend is production-ready with Docker, health checks, and deployment workflow
- To deploy: Connect Railway to the GitHub repo, set environment variables (see `apps/server/ENV.md`), and Railway will auto-deploy
- Frontend can connect to production API by setting `VITE_API_BASE_URL` GitHub secret to the Railway URL
- Database persistence requires adding a Railway volume at `/app/data` or migrating to PostgreSQL

## LLM Architecture: Gemini with Tools

The Gemini integration supports two complementary approaches for giving the AI access to user data:

### Approach 1: Context Injection (immediate)
Before each Gemini call, build a context window that injects summaries into the system prompt:
- Today's schedule (from TP sync)
- Upcoming deadlines (next 7 days, from Canvas/GitHub sync)
- Recent journal entries (last 3)
- Current energy/stress state
- Unread email summary (from Gmail sync)
- Social media digest highlights

This is simpler to implement and works well for conversational context.

### Approach 2: Gemini Function Calling / Tools (future)
Gemini supports [function calling](https://ai.google.dev/gemini-api/docs/function-calling) where the model can request data on demand:
- `getScheduleForDate(date)` — fetch schedule for a specific day
- `getUpcomingDeadlines(days)` — list deadlines within N days
- `searchJournal(query)` — search journal entries
- `getCanvasAssignment(courseId, assignmentId)` — get assignment details
- `getEmailSummary(hours)` — summarize recent emails
- `getSocialMediaDigest(platform, hours)` — get social media summary

This is more powerful (the AI decides what data it needs) but requires more implementation effort. Consider implementing this as an enhancement after context injection works.

**Decision**: Start with context injection (Approach 1). Add function calling tools later once the basic chat flow works.

## Data Sources

### Canvas LMS (`stavanger.instructure.com`)
- **Auth**: Personal access token (generated in Canvas Settings → New Access Token)
- **Endpoints used**:
  - `GET /api/v1/courses` — enrolled courses
  - `GET /api/v1/courses/:id/assignments` — assignments with due dates, points, submission status
  - `GET /api/v1/courses/:id/modules` — course modules and items
  - `GET /api/v1/courses/:id/discussion_topics` — announcements
  - `GET /api/v1/users/self/upcoming_events` — upcoming calendar events
  - `GET /api/v1/users/self/todo` — user's todo list from Canvas
- **Store as**: `CANVAS_API_TOKEN` secret + `CANVAS_BASE_URL` config
- **Sync interval**: Every 30 minutes (cron job on server)

### TP EduCloud (UiS Schedule)
- **iCal subscription URL**: `https://tp.educloud.no/uis/timeplan/ical.php?type=courseact&sem=26v&id[]=DAT520,1&id[]=DAT560,1&id[]=DAT600,1`
- **Auth**: None required — this is a public iCal feed
- **Format**: Standard iCalendar (`.ics`) with `VEVENT` entries
- **Event fields**: `DTSTART`, `DTEND`, `SUMMARY` (course + type, e.g. "DAT520 Forelesning \nLecture"), `LOCATION` (room + building), `DESCRIPTION` (course, type, lecturer names, room details)
- **Event types**: Forelesning/Lecture, Laboratorium/Lab, Undervisning (Teaching), Veiledning (Guidance), Skriftlig eksamen (Written exam)
- **Coverage**: Full semester (26v) — 151 events across DAT520, DAT560, DAT600, including exam dates
- **Sync interval**: Weekly (re-fetch iCal URL, diff against stored events)
- **Parser**: Reuse existing `parseICS()` from `apps/server/src/calendar-import.ts` — already handles VEVENT parsing, line unfolding, and timestamp conversion
- **Fallback**: Manual ICS file import (same parser)

### Course GitHub Organizations
- **Organizations**: `dat520-2026` (Distributed Systems), `dat560-2026` (Generative AI)
- **Auth**: Personal access token (`COURSE_GITHUB_PAT` env var) for `lucyscript` account — needed for private repos
- **Key repos**:
  - `dat520-2026/assignments` — Lab descriptions with deadlines (Go, 8 labs, graded via QuickFeed)
  - `dat520-2026/lucyscript-labs` — Personal lab submission repo
  - `dat520-2026/defnotai` — Group project repo (labs 3-8)
  - `dat560-2026/info` — Course info, schedule, slides, assignments, exercises
  - `dat560-2026/assigment1-vae-lucyscript` — Assignment 1 (VAE, GitHub Classroom)
  - `dat560-2026/assigment2-llm-lucyscript` — Assignment 2 (LLM, GitHub Classroom)
- **Data extracted**: Lab READMEs contain structured deadline tables (`| Deadline: | **Jan 15, 2026 23:59** |`), expected effort, grading policy, submission type
- **Known deadlines from GitHub**:
  - DAT520: Lab1 Jan 15, Lab2 Jan 22, Lab3 Feb 12, Lab4 Mar 5 (labs 5-8 TBD)
  - DAT560: Assignment 1 Jan 28, Assignment 2 Feb 18, Assignment 3 Mar 18, Project+Report Apr 24
- **Sync interval**: Daily (new labs may be pushed at any time)
- **Course website**: `https://dat520.github.io/#/` — public docs built from `dat520-2026/info` repo

### Google Gemini API
- **Model**: `gemini-2.0-flash` (free tier: 15 RPM, 1M TPD, 1500 RPD)
- **Auth**: API key stored as `GEMINI_API_KEY` secret
- **Usage**: Chat responses, proactive nudge generation, weekly review narration, deadline coaching, social media summarization
- **System prompt**: Includes user's schedule, upcoming deadlines, recent journal entries, energy/stress state

### YouTube Data API v3
- **Auth**: API key stored as `YOUTUBE_API_KEY` env var
- **Endpoints used**:
  - `GET /youtube/v3/subscriptions` — user's subscribed channels
  - `GET /youtube/v3/search` — recent uploads from specific channels
  - `GET /youtube/v3/videos` — video details (title, description, duration, stats)
- **Usage**: Fetch recent uploads from subscribed channels, summarize with Gemini
- **Sync interval**: Every 6 hours (YouTube quota: 10,000 units/day)

### X (Twitter) API v2
- **Auth**: OAuth 1.0a with `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` env vars. Bearer token `X_BEARER_TOKEN` for app-only endpoints.
- **Endpoints used**:
  - `GET /2/users/:id/timelines/reverse_chronological` — home timeline
  - `GET /2/users/:id/liked_tweets` — liked tweets for interest signal
  - `GET /2/tweets/search/recent` — search for topics (AI news, tech)
- **Usage**: Pull recent timeline tweets, use Gemini to create AI newsletter-style digest grouped by topic
- **Sync interval**: Every 4 hours (Free tier: 100 reads/month, Basic tier: 10K reads/month)
- **Rate limits**: Respect X API rate limits, cache aggressively

### Gmail API (OAuth 2.0)
- **Auth**: OAuth 2.0 with `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` env vars. User authorizes via OAuth consent flow, refresh token stored securely.
- **Scopes**: `gmail.readonly` (read-only access to inbox)
- **Endpoints used**:
  - `GET /gmail/v1/users/me/messages` — list messages
  - `GET /gmail/v1/users/me/messages/:id` — get message details (subject, sender, snippet)
  - `GET /gmail/v1/users/me/labels` — inbox labels for categorization
- **Usage**: Fetch recent unread emails, generate summary for LLM context window ("You have 3 unread emails — 1 from Canvas about Lab 3 feedback, 2 newsletters"). The AI can reference email context in conversations.
- **Sync interval**: Every 30 minutes (lightweight — only fetches metadata + snippets, not full bodies)
- **Privacy**: Only email subjects and short snippets are stored/summarized. Full email bodies are never persisted.

## Agent Modules (Server-Side)

1. **Notes Agent** — Stores and retrieves journal entries and quick notes
2. **Lecture Plan Agent** — Manages class schedule, generates time-aware reminders
3. **Assignment Tracker Agent** — Tracks deadlines, sends escalating reminders
4. **Orchestrator Agent** — Coordinates all agents, generates daily summaries, manages notification priority
5. **Canvas Sync Agent** (NEW) — Periodically fetches courses, assignments, modules, announcements from Canvas API
6. **TP Sync Agent** (NEW) — Fetches lecture schedule from TP EduCloud iCal feed
7. **Chat Agent** (NEW) — Manages conversation flow, builds context window for Gemini, handles proactive message triggers
8. **Social Media Agent** (NEW) — Fetches content from YouTube and X APIs, uses Gemini to generate digestible summaries, and delivers as a daily/on-demand feed

## Success Criteria

- You can open the app and **ask it anything about your academic life** and get a useful, contextual answer
- Canvas assignments and deadlines **auto-populate** without manual entry
- Lecture schedule **stays in sync** with TP EduCloud
- Push notifications feel like a **helpful friend**, not a todo-list robot
- Journaling and chatting feel like the same natural interaction
- The app works offline and syncs when back online

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
| ✅ done | `deadline-status-confirmation-ui` | frontend-engineer | Add UI quick actions for overdue reminders so users can confirm completed/still-working status from notifications or deadline cards. |
| ✅ done | `weekly-review-ui` | frontend-engineer | Build a weekly reflection view that renders `/api/weekly-review` with completion rate, highlights, and suggested next priorities. |
| ✅ done | `journal-search-filter` | backend-engineer | Add GET /api/journal/search endpoint with text search and date range filters so users can find past entries quickly. |
| ✅ done | `journal-search-ui` | frontend-engineer | Add search bar and date filters to JournalView component backed by /api/journal/search endpoint. |
| ✅ done | `dark-mode` | frontend-engineer | Add dark mode toggle in settings with CSS variables for all components and persist preference in localStorage for iPhone nighttime use. |
| ✅ done | `data-export-api` | backend-engineer | Add GET /api/export endpoint that returns all user data (journals, schedule, deadlines, preferences) as downloadable JSON for backup and portability. |
| ✅ done | `smart-notification-timing` | backend-engineer | Enhance nudge engine to schedule reminders at optimal times based on user's schedule gaps, energy levels, and historical completion patterns. |
| ✅ done | `voice-journal-input` | frontend-engineer | Add Web Speech API voice input to journal entry form with real-time transcription so users can journal hands-free on iPhone. |
| ✅ done | `habit-goal-tracking-api` | backend-engineer | Add POST/GET /api/habits and /api/goals endpoints with completion tracking, streak calculation, and integration with nudge engine for check-in reminders. |
| ✅ done | `habit-goal-tracking-ui` | frontend-engineer | Build Habits and Goals views with daily check-in cards, streak visualizations, and quick completion toggles backed by habit/goal APIs. |
| ✅ done | `data-import-api` | backend-engineer | Add POST /api/import endpoint that validates and restores user data from JSON export format with conflict resolution for existing records. |
| ✅ done | `focus-session-timer` | frontend-engineer | Add a Pomodoro-style focus timer component with configurable duration, break intervals, and integration with context tracking for flow state sessions. |
| ✅ done | `journal-tags-api` | backend-engineer | Extend journal entries with tags array field, add tag CRUD endpoints, and update search endpoint to filter by tags for better organization. |
| ✅ done | `journal-tags-ui` | frontend-engineer | Add tag input with autocomplete to journal form, tag pills on entries, and tag filtering to search UI backed by journal tags API. |
| ✅ done | `pwa-install-prompt` | frontend-engineer | Add "Add to Home Screen" prompt detection and custom install UI for iPhone Safari to improve first-time PWA installation experience. |
| ✅ done | `deadline-smart-suggestions` | backend-engineer | Add GET /api/deadlines/suggestions endpoint that analyzes schedule gaps and recommends optimal work time blocks for upcoming deadlines. |
| ✅ done | `quick-capture-widget` | frontend-engineer | Build a floating quick-capture button that persists across views for instant journal/deadline entry without navigating away from current context. |
| ✅ done | `notification-interaction-history` | backend-engineer | Track notification tap/dismiss actions with timestamps to improve smart timing algorithm and measure notification effectiveness. |
| ✅ done | `energy-mood-trends` | backend-engineer | Add GET /api/trends endpoint that analyzes historical context updates to identify energy/stress patterns by time of day and day of week for better nudge timing. |
| ✅ done | `recurring-schedule-events` | backend-engineer | Add recurrence rules (daily/weekly/monthly) to schedule API so users can define repeating lectures once instead of creating each instance manually. |
| ✅ done | `notification-history-ui` | frontend-engineer | Build a notification history view showing all past notifications with tap/dismiss actions and ability to re-trigger missed reminders. |
| ✅ done | `journal-photo-attachments` | backend-engineer | Extend journal entries with photo attachment support (base64 inline storage for simplicity) so users can attach lecture notes, whiteboard photos, or assignment screenshots. |
| ✅ done | `location-context-api` | backend-engineer | Add location tracking endpoints (lat/lng with named places) and integrate with nudge engine to adjust reminder timing based on user's location context (e.g., at library, at home). |
| ✅ done | `email-digest-fallback` | backend-engineer | Add daily/weekly email digest generation and delivery as backup notification channel when push notifications fail or user hasn't checked app recently. |
| ✅ done | `notification-action-buttons` | backend-engineer | Add Web Push notification action buttons (Complete, Snooze, View) for deadlines and tasks so users can respond directly from notifications without opening the app. |
| ✅ done | `background-sync-service` | backend-engineer | Implement background sync API to queue and automatically sync journal entries, deadline updates, and context changes when connectivity is restored or app reopens. |
| ✅ done | `deadline-priority-auto-escalation` | backend-engineer | Add automatic deadline priority escalation logic that increases urgency level as due date approaches (e.g., high→critical 24hrs before) to ensure timely reminders. |
| ✅ done | `streak-persistence-recovery` | backend-engineer | Add grace period logic for habit/goal streaks that allows recovery within 24hrs of missed check-in to prevent demotivation from one-time lapses. |
| ✅ done | `share-to-journal` | frontend-engineer | Add Web Share Target API handler so users can share text, links, or images from other apps directly into a new journal entry on iPhone. |
| ✅ done | `mobile-bottom-navigation` | frontend-engineer | Replace single-page layout with iOS-style bottom tab navigation (Journal, Schedule, Habits, Settings) for quick context switching on iPhone. |
| ❌ skip | `biometric-authentication` | frontend-engineer | Skipped — single-user personal PWA, no login flow needed. |
| ✅ done | `haptic-feedback-system` | frontend-engineer | Integrate Vibration API for tactile feedback on task completions, timer events, and critical notifications to make interactions feel native on iPhone. |
| ✅ done | `sync-status-indicator` | frontend-engineer | Add persistent sync status badge showing online/offline state, pending queue count, and last sync timestamp so users know when data is safely persisted. |
| ✅ done | `pull-to-refresh-gesture` | frontend-engineer | Add pull-to-refresh gesture to all list views (journal, schedule, deadlines) using touch event handlers for familiar iPhone UX pattern. |
| | | | |
| | **— Phase 2: Conversational AI & Data Integrations —** | | |
| ✅ done | `gemini-client` | backend-engineer | Add Gemini API client module (`apps/server/src/gemini.ts`) with typed request/response, context window builder, and robust provider error handling. Store API key as `GEMINI_API_KEY` env var. |
| ✅ done | `chat-api` | backend-engineer | Add POST /api/chat (send message) and GET /api/chat/history (paginated) endpoints. Each request builds a context window from schedule, deadlines, recent journals, Canvas data, and user state, then calls Gemini. Persist chat history in store. |
| ✅ done | `chat-ui` | frontend-engineer | Build a full-screen chat interface as the app's primary view. Message bubbles, streaming response display, quick-action chips ("What's next?", "How's my week?"), and input with send button. Mobile-optimized with keyboard handling. |
| ✅ done | `canvas-sync-api` | backend-engineer | Add Canvas LMS integration: config for `CANVAS_API_TOKEN` + `CANVAS_BASE_URL`, sync service that fetches courses, assignments (with due dates, submission status, points), modules, and announcements. Store in RuntimeStore. Sync every 30 min via cron. |
| ✅ done | `canvas-deadlines-bridge` | backend-engineer | Bridge Canvas assignments into the existing deadline system — auto-create/update deadlines from Canvas assignments, detect new assignments, mark completed when submitted. Avoid duplicating manually-created deadlines. |
| ✅ done | `tp-schedule-sync` | backend-engineer | Add TP EduCloud schedule sync: fetch iCal feed from `https://tp.educloud.no/uis/timeplan/ical.php?type=courseact&sem=26v&id[]=DAT520,1&id[]=DAT560,1&id[]=DAT600,1` (public, no auth), parse with existing `parseICS()` from `calendar-import.ts`, diff against stored schedule, and upsert changes. Weekly cron + manual trigger via POST /api/sync/tp. No API key needed. |
| ✅ done | `github-course-sync` | backend-engineer | Add GitHub course sync service: fetch lab READMEs from `dat520-2026/assignments` and `dat560-2026/info` repos via GitHub API, parse deadline tables from markdown, auto-create/update deadlines. Config: `COURSE_GITHUB_PAT` env var. Sync daily. |
| ✅ done | `canvas-sync-ui` | frontend-engineer | Add Canvas connection settings in the app: token input, base URL, sync status indicator, last-synced timestamp, manual sync trigger button, and list of synced courses. |
| ✅ done | `chat-context-builder` | backend-engineer | Build intelligent context window for Gemini calls: include today's schedule, upcoming deadlines (next 7 days), recent journal entries (last 3), current energy/stress state, Canvas announcements, and conversation history. Stay within token limits. |
| ✅ done | `proactive-chat-triggers` | backend-engineer | Generate proactive AI messages based on triggers: morning briefing (8am), schedule gap detected, deadline approaching (<48h), post-lecture check-in, evening reflection prompt. Queue as push notifications with "tap to chat" action. |
| ✅ done | `chat-as-journal` | backend-engineer | Allow chat messages to be saved as journal entries. When the user reflects on their day in chat, the AI can offer to save the summary as a journal entry. Add "Save to journal" action in chat. |
| ✅ done | `app-layout-redesign` | frontend-engineer | Redesign app layout: make chat the primary/home view with a bottom tab bar for Chat, Schedule, Journal, and Settings. Move dashboard tiles into the chat view as contextual cards. |
| ✅ done | `onboarding-v2` | frontend-engineer | Update onboarding flow to collect Canvas token and TP credentials, with explanations of what data is synced and privacy assurances. Include "skip for now" option for each integration. |
| ✅ done | `integration-status-dashboard` | frontend-engineer | Build a settings/integrations page showing Canvas sync status, TP sync status, Gemini API status, with last-synced times, error states, and manual refresh buttons. |
| | | | |
| | **— Phase 3: Social Media Summary & Content Digest —** | | |
| ✅ done | `youtube-sync-api` | backend-engineer | Add YouTube Data API v3 client: fetch subscribed channels' recent uploads, video metadata (title, description, duration, stats). Config: `YOUTUBE_API_KEY` env var. Sync every 6 hours. Quota-aware (10K units/day). |
| ✅ done | `x-feed-sync-api` | backend-engineer | Add X/Twitter API v2 client: fetch home timeline and recent tweets from followed accounts using OAuth 1.0a. Config: `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET`, `X_BEARER_TOKEN` env vars. Sync every 4 hours. |
| ✅ done | `social-media-summarizer` | backend-engineer | Build Gemini-powered summarization pipeline: takes raw YouTube/X data, generates AI newsletter-style digest grouped by topic (AI news, tech, entertainment). Configurable summary length and focus areas. |
| ✅ done | `social-media-digest-ui` | frontend-engineer | Build Social Media Summary view: card-based digest with YouTube video thumbnails and X thread summaries. Filter by platform, refresh on demand. Tab in bottom nav. |
| ✅ done | `social-media-chat-integration` | backend-engineer | Integrate social media context into Gemini chat: "What did I miss on X?" or "Any new AI videos?" queries pull from cached social media data and generate contextual summaries. |
| | | | |
| | **— Phase 4: Production Deployment & Gmail —** | | |
| ✅ done | `server-deployment` | backend-engineer | Deploy `apps/server` to a production host (Railway, Fly.io, or VPS). Add health check, environment variable config, and deployment workflow. Update frontend API base URL to point to production server. |
| ✅ done | `gmail-oauth-flow` | backend-engineer | Implement Gmail OAuth 2.0 consent flow: redirect user to Google consent screen, handle callback, store refresh token securely. Config: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` env vars. |
| ✅ done | `gmail-sync-api` | backend-engineer | Add Gmail sync service: fetch recent unread emails (subjects, senders, snippets), generate summaries for LLM context. Sync every 30 min. Scope: `gmail.readonly`. |
| ✅ done | `gmail-context-injection` | backend-engineer | Add email summary to Gemini context window: inject unread count, important sender highlights, and actionable items (Canvas notifications, deadline reminders from profs) into chat context. |
| ✅ done | `voice-chat-interaction` | frontend-engineer | Add voice input/output to chat: Web Speech API for voice-to-text input and Speech Synthesis API for AI responses read aloud. Add toggle for "talk mode" with visual sound wave feedback on iPhone. |
| ✅ done | `swipe-gesture-actions` | frontend-engineer | Add swipe gestures to deadline and journal cards: swipe right to complete/archive, swipe left to snooze/delete. Include haptic feedback and undo toast for accidental swipes. |
| ✅ done | `weekly-study-plan-generator` | backend-engineer | Add POST /api/study-plan/generate endpoint that analyzes all upcoming deadlines (Canvas + GitHub + manual) and user's schedule to create an optimized week plan with time-blocked study sessions. |
| ✅ done | `content-recommendation-engine` | backend-engineer | Build recommendation system that matches YouTube videos and X threads to upcoming assignments/lectures. When user has DAT560 assignment due, surface relevant ML tutorials from subscribed channels. |
| ✅ done | `progress-visualization-dashboard` | frontend-engineer | Add analytics dashboard with charts showing deadline completion rate over time, habit streak calendar heatmap, energy/stress patterns, and week-over-week productivity trends using Chart.js or similar. |
| ✅ done | `gemini-function-calling` | backend-engineer | Add Gemini function calling (tools): define callable functions (`getSchedule`, `getDeadlines`, `searchJournal`, `getEmails`, `getSocialDigest`) that Gemini can invoke on demand instead of relying solely on context injection. |
| | | | |
| | **— Phase 5: Product Polish & Daily Workflow —** | | |
| ✅ done | `study-plan-ui` | frontend-engineer | Build a Study Plan screen that calls `POST /api/study-plan/generate`, shows day-by-day time blocks, and supports regenerate controls (horizon/session length) optimized for iPhone touch usage. |
| ✅ done | `content-recommendations-ui` | frontend-engineer | Surface `/api/recommendations/content` in the app with course-linked recommendation cards (YouTube/X), relevance reasons, and quick-open actions from Social and Chat contexts. |
| ✅ done | `integration-date-window-filtering` | backend-engineer | Add strict date-window filtering for TP iCal import/sync and Canvas sync so only current-semester and near-horizon academic items are kept in schedule/deadlines context. Exclude stale historical and far-future records by default, with configurable horizon limits. |
| ✅ done | `chat-action-executor` | backend-engineer | Extend chat tool-calling so Gemini can perform safe actions (complete/snooze deadlines, create schedule blocks, create journal draft) behind explicit user confirmation. |
| ✅ done | `notification-deep-link-routing` | frontend-engineer | Add deep-link handling for push notifications and action buttons so tapping a notification navigates directly to the relevant deadline, chat thread, or review screen. |
| ✅ done | `study-plan-calendar-export` | backend-engineer | Add ICS export for generated study plans so users can add planned study sessions to iPhone Calendar in one tap (download endpoint + stable event IDs). |
| | | | |
| | **— Phase 6: Reliability & Integration Controls —** | | |
| ✅ done | `integration-scope-settings-ui` | frontend-engineer | Add integration scope controls in Settings: selectable Canvas courses, editable TP course IDs, and date-window inputs with a preview of records that will sync before applying changes. |
| ✅ done | `integration-status-railway-routing` | frontend-engineer | Route TP/Gemini status requests through the shared web API client so GitHub Pages correctly targets Railway (`VITE_API_BASE_URL`) and integration cards reflect true server-side configuration/state. |
| ✅ done | `tp-settings-dedup-manual-ical` | frontend-engineer | Remove redundant TP API sync controls from Integrations and clarify that TP lecture plans are managed through the manual iCal import workflow in Settings. |
| ✅ done | `gemini-provider-rate-limit-handling` | backend-engineer | Remove backend-side Gemini request waiting/throttling and rely on provider-enforced quota/rate responses, while keeping transparent error surfacing and telemetry counters. |
| ✅ done | `gemini-rate-limit-status-pass-through` | backend-engineer | Remove internal Gemini limiter telemetry from status endpoints, pass through provider-originated 429 details (without hardcoded 15 RPM messaging), and show provider-managed quota in Integrations UI. |
| ✅ done | `gemini-chat-system-instruction-compat` | backend-engineer | Fix Gemini chat request formatting by supplying system instructions through model configuration (SDK-normalized Content) instead of raw `startChat` string params to prevent provider 400 errors. |
| ✅ done | `gemini-transient-429-resilience` | backend-engineer | Add short retry/backoff for transient Gemini 429 responses and reduce chat token pressure by trimming function-calling history payload size to reduce false-looking rate-limit failures in web usage. |
| ✅ done | `env-prefix-cleanup` | backend-engineer | Use canonical non-prefixed server env names (`TIMEZONE`, `USER_NAME`, `VAPID_*`, provider vars) with backward-compatible fallback from legacy `AXIS_*` aliases. |
| ✅ done | `integration-scope-enforcement` | backend-engineer | Enforce per-user integration scope in TP/Canvas ingestion and sync pipelines so only selected courses and in-window records are stored and bridged into deadlines/schedule. |
| ✅ done | `deadline-dedup-merge` | backend-engineer | Add duplicate deadline detection across Canvas, GitHub, and manual sources with merge suggestions and a canonical-record strategy to prevent multi-source assignment duplicates. |
| ✅ done | `notification-digest-batching` | backend-engineer | Batch non-urgent nudges into configurable morning/evening digest notifications with deep links, while preserving immediate delivery for critical reminders. |
| ✅ done | `offline-readonly-cache-ui` | frontend-engineer | Cache last-known schedule, deadlines, study plan, and social digest snapshots for offline viewing with stale-data indicators and one-tap refresh when back online. |
| | | | |
| | **— Phase 7: Execution Feedback & Trust —** | | |
| ✅ done | `study-plan-session-checkins-api` | backend-engineer | Add API + storage for marking generated study-plan sessions as done/skipped, with completion timestamps and per-week adherence metrics for replanning. |
| ✅ done | `study-plan-session-checkins-ui` | frontend-engineer | Add tap-to-complete controls on Study Plan sessions, show daily completion progress, and support quick skip/reschedule actions optimized for iPhone touch input. |
| ✅ done | `chat-citations` | backend-engineer | Extend chat responses with structured citations to schedule/deadline/journal/email/social records so guidance is traceable to concrete data. |
| ✅ done | `chat-citation-chips-ui` | frontend-engineer | Render citation chips under assistant messages and deep-link taps to referenced deadlines, schedule blocks, journal entries, or settings screens. |
| ✅ done | `sync-failure-recovery-prompts` | backend-engineer | Detect repeated TP/Canvas/Gmail sync failures and create actionable recovery prompts with root-cause hints and suggested fixes before data becomes stale. |
| | | | |
| | **— Phase 8: Personalization & Execution Quality —** | | |
| ✅ done | `study-session-energy-tracking` | backend-engineer | Extend study-plan session check-ins with optional perceived-focus/energy ratings and short notes, then expose trends for adaptive planning inputs. |
| ⬜ todo | `study-session-energy-ui` | frontend-engineer | Add quick post-session check-in UI (1-tap energy/focus scale + optional note) in Study Plan view, optimized for iPhone thumb reach and minimal friction. |
| ⬜ todo | `deadline-effort-budgeting` | backend-engineer | Add per-deadline effort estimates (hours remaining + confidence) and use them as constraints in weekly plan generation to avoid under/over-allocation. |
| ⬜ todo | `deadline-effort-editor-ui` | frontend-engineer | Add effort-estimate controls on deadline cards with sensible defaults and inline validation, and surface “hours remaining” context in schedule/planning views. |
| ⬜ todo | `integration-health-log-api` | backend-engineer | Persist TP/Canvas/Gmail sync attempt history (success/failure, latency, root-cause category) and expose an API for troubleshooting and reliability analytics. |
