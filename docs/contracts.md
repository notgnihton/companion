# Companion API Contracts

This file is the source of truth for payload shapes used by `apps/server` and `apps/web`.

## GET `/api/health`

Response:

```json
{ "status": "ok" }
```

## GET `/api/dashboard`

Response:

```json
{
  "generatedAt": "2026-02-14T15:00:00.000Z",
  "summary": {
    "todayFocus": "Deep work + assignment completion",
    "pendingDeadlines": 3,
    "activeAgents": 2,
    "journalStreak": 5
  },
  "agentStates": [
    {
      "name": "notes",
      "status": "idle",
      "lastRunAt": "2026-02-14T14:59:55.000Z"
    }
  ],
  "notifications": [
    {
      "id": "notif-1",
      "title": "Deadline alert",
      "message": "Problem Set 4 for Algorithms is approaching.",
      "priority": "high",
      "source": "assignment-tracker",
      "timestamp": "2026-02-14T14:59:50.000Z"
    }
  ],
  "events": []
}
```

## POST `/api/context`

Request:

```json
{
  "stressLevel": "low|medium|high",
  "energyLevel": "low|medium|high",
  "mode": "focus|balanced|recovery"
}
```

Response:

```json
{
  "context": {
    "stressLevel": "medium",
    "energyLevel": "high",
    "mode": "focus"
  }
}
```

---

## Phase 2: Conversational AI & Data Integrations

### POST `/api/chat`

Send a message and get an AI response (Gemini-powered, context-aware).

Request:

```json
{
  "message": "What's my day look like?",
  "conversationId": "conv-abc123"
}
```

Response:

```json
{
  "id": "msg-xyz",
  "conversationId": "conv-abc123",
  "role": "assistant",
  "content": "You've got DAT520 at 10:15 in KE E-101, then a 3-hour gap...",
  "timestamp": "2026-02-14T08:05:00.000Z",
  "context": {
    "scheduledEvents": 2,
    "upcomingDeadlines": 3,
    "model": "gemini-2.0-flash"
  }
}
```

### GET `/api/chat/history?conversationId=conv-abc123&limit=50&before=msg-xyz`

Paginated conversation history.

Response:

```json
{
  "conversationId": "conv-abc123",
  "messages": [
    {
      "id": "msg-001",
      "role": "user",
      "content": "What's my day look like?",
      "timestamp": "2026-02-14T08:04:55.000Z"
    },
    {
      "id": "msg-002",
      "role": "assistant",
      "content": "You've got DAT520 at 10:15...",
      "timestamp": "2026-02-14T08:05:00.000Z"
    }
  ],
  "hasMore": false
}
```

### GET `/api/canvas/courses`

Synced Canvas courses.

Response:

```json
{
  "courses": [
    {
      "id": 17649,
      "name": "DAT520-1 Distribuerte systemer 26V",
      "courseCode": "DAT520-1",
      "enrollmentType": "StudentEnrollment",
      "lastSyncedAt": "2026-02-14T14:30:00.000Z"
    }
  ]
}
```

### GET `/api/canvas/assignments?courseId=17649`

Synced assignments for a course.

Response:

```json
{
  "assignments": [
    {
      "id": 12345,
      "courseId": 17649,
      "name": "Lab 1: UDP Echo Server",
      "dueAt": "2026-01-15T22:59:00.000Z",
      "pointsPossible": 100,
      "submissionStatus": "submitted",
      "htmlUrl": "https://stavanger.instructure.com/courses/17649/assignments/12345"
    }
  ]
}
```

### POST `/api/sync/canvas`

Trigger manual Canvas sync.

Response:

```json
{
  "status": "syncing",
  "coursesFound": 3,
  "startedAt": "2026-02-14T15:00:00.000Z"
}
```

### POST `/api/sync/tp`

Trigger manual TP EduCloud schedule sync (fetches public iCal feed, no API key needed).

Response:

```json
{
  "status": "syncing",
  "eventsFound": 151,
  "source": "ical",
  "icalUrl": "https://tp.educloud.no/uis/timeplan/ical.php?type=courseact&sem=26v&id[]=DAT520,1&id[]=DAT560,1&id[]=DAT600,1",
  "startedAt": "2026-02-14T15:00:00.000Z"
}
```

### POST `/api/sync/github`

Trigger manual GitHub course sync (parse lab deadlines from repos).

Response:

```json
{
  "status": "syncing",
  "repos": ["dat520-2026/assignments", "dat560-2026/info"],
  "startedAt": "2026-02-14T15:00:00.000Z"
}
```

### GET `/api/sync/status`

Integration sync status overview.

Response:

```json
{
  "canvas": {
    "lastSyncAt": "2026-02-14T14:30:00.000Z",
    "status": "ok",
    "coursesCount": 3,
    "assignmentsCount": 8
  },
  "tp": {
    "lastSyncAt": "2026-02-12T03:00:00.000Z",
    "status": "ok",
    "source": "ical",
    "eventsCount": 151
  },
  "github": {
    "lastSyncAt": "2026-02-14T06:00:00.000Z",
    "status": "ok",
    "deadlinesFound": 6
  },
  "gemini": {
    "status": "ok",
    "model": "gemini-2.0-flash",
    "requestsToday": 42,
    "dailyLimit": 1500
  },
  "youtube": {
    "lastSyncAt": "2026-02-14T12:00:00.000Z",
    "status": "ok",
    "videosTracked": 24,
    "quotaUsedToday": 350,
    "quotaLimit": 10000
  },
  "x": {
    "lastSyncAt": "2026-02-14T10:00:00.000Z",
    "status": "ok",
    "tweetsProcessed": 85
  },
  "twitch": {
    "lastSyncAt": "2026-02-14T14:45:00.000Z",
    "status": "ok",
    "followedChannels": 12,
    "currentlyLive": 1
  }
}
```

---

## Phase 3: Social Media Summary & Content Digest

### GET `/api/social/digest?platforms=youtube,x,twitch&hours=24`

AI-generated social media summary.

Response:

```json
{
  "generatedAt": "2026-02-14T15:00:00.000Z",
  "period": { "from": "2026-02-13T15:00:00.000Z", "to": "2026-02-14T15:00:00.000Z" },
  "digest": "## AI & Tech Highlights\n- OpenAI released GPT-5 turbo with...\n- Google announced Gemini 2.5...\n\n## YouTube\n- Fireship: \"GPT-5 in 100 seconds\" (12min)...\n\n## Twitch\n- ThePrimeagen is live now: \"Reviewing Go 1.24\"",
  "sections": [
    {
      "platform": "youtube",
      "items": [
        {
          "type": "video",
          "channelName": "Fireship",
          "title": "GPT-5 in 100 seconds",
          "videoId": "abc123",
          "publishedAt": "2026-02-14T10:00:00.000Z",
          "duration": "PT12M30S",
          "thumbnailUrl": "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
          "summary": "Covers the new GPT-5 turbo model features..."
        }
      ]
    },
    {
      "platform": "x",
      "items": [
        {
          "type": "tweet_thread",
          "authorHandle": "@kaborneai",
          "content": "Major announcement: Anthropic released Claude 4...",
          "tweetId": "1234567890",
          "publishedAt": "2026-02-14T08:30:00.000Z",
          "engagement": { "likes": 4500, "retweets": 1200 },
          "summary": "Thread discussing Claude 4 capabilities and benchmarks"
        }
      ]
    },
    {
      "platform": "twitch",
      "items": [
        {
          "type": "live_stream",
          "channelName": "ThePrimeagen",
          "title": "Reviewing Go 1.24 features",
          "isLive": true,
          "viewerCount": 8500,
          "startedAt": "2026-02-14T14:00:00.000Z"
        }
      ]
    }
  ]
}
```

### POST `/api/social/sync`

Trigger manual social media sync for all or specific platforms.

Request:

```json
{
  "platforms": ["youtube", "x", "twitch"]
}
```

Response:

```json
{
  "status": "syncing",
  "platforms": {
    "youtube": { "status": "started", "quotaRemaining": 9650 },
    "x": { "status": "started", "readsRemaining": 58 },
    "twitch": { "status": "started" }
  },
  "startedAt": "2026-02-14T15:00:00.000Z"
}
```

### GET `/api/social/twitch/live`

Currently live followed Twitch channels.

Response:

```json
{
  "live": [
    {
      "channelName": "ThePrimeagen",
      "title": "Reviewing Go 1.24 features",
      "gameName": "Science & Technology",
      "viewerCount": 8500,
      "startedAt": "2026-02-14T14:00:00.000Z",
      "thumbnailUrl": "https://static-cdn.jtvnw.net/previews-ttv/live..."
    }
  ]
}
```

---

## Phase 4: Gmail Integration & LLM Tools

### GET `/api/auth/gmail`

Redirect to Google OAuth consent screen for `gmail.readonly` scope.

Response: `302 Redirect` to Google OAuth URL.

### GET `/api/auth/gmail/callback?code=...`

Handle OAuth callback, exchange code for tokens, store refresh token.

Response:

```json
{
  "status": "connected",
  "email": "user@gmail.com",
  "connectedAt": "2026-02-14T15:00:00.000Z"
}
```

### GET `/api/gmail/summary?hours=24`

AI-summarized mailbox digest (subjects + snippets, not full bodies).

Response:

```json
{
  "generatedAt": "2026-02-14T15:00:00.000Z",
  "period": { "from": "2026-02-13T15:00:00.000Z", "to": "2026-02-14T15:00:00.000Z" },
  "totalMessages": 12,
  "summary": "## Inbox Highlights\n- Canvas notification: Lab 3 graded (DAT520)\n- GitHub: PR merged in defnotai repo\n- UiS admin: Exam schedule published for spring 2026",
  "messages": [
    {
      "id": "msg-gmail-001",
      "from": "notifications@instructure.com",
      "subject": "Lab 3 has been graded",
      "snippet": "Your submission for Lab 3: gRPC has been graded. Score: 95/100",
      "receivedAt": "2026-02-14T12:30:00.000Z",
      "labels": ["INBOX", "CATEGORY_UPDATES"],
      "isRead": true
    }
  ]
}
```

### POST `/api/gmail/sync`

Trigger manual Gmail sync.

Response:

```json
{
  "status": "syncing",
  "messagesFound": 12,
  "startedAt": "2026-02-14T15:00:00.000Z"
}
```

### Sync status addition

The `GET /api/sync/status` response adds a `gmail` field:

```json
{
  "gmail": {
    "lastSyncAt": "2026-02-14T14:30:00.000Z",
    "status": "ok",
    "messagesProcessed": 12,
    "connected": true
  }
}
```

### POST `/api/study-plan/generate`

Generate a deterministic weekly study plan from upcoming deadlines and open schedule gaps.

Request:

```json
{
  "horizonDays": 7,
  "minSessionMinutes": 45,
  "maxSessionMinutes": 120
}
```

Response:

```json
{
  "plan": {
    "generatedAt": "2026-02-17T10:00:00.000Z",
    "windowStart": "2026-02-17T10:00:00.000Z",
    "windowEnd": "2026-02-24T10:00:00.000Z",
    "summary": {
      "horizonDays": 7,
      "deadlinesConsidered": 3,
      "deadlinesCovered": 2,
      "totalSessions": 4,
      "totalPlannedMinutes": 360
    },
    "sessions": [
      {
        "id": "study-session-deadline-1739700000000-1",
        "deadlineId": "deadline-1739700000000-1",
        "course": "DAT560",
        "task": "Assignment 3",
        "priority": "high",
        "startTime": "2026-02-17T11:00:00.000Z",
        "endTime": "2026-02-17T12:30:00.000Z",
        "durationMinutes": 90,
        "score": 680,
        "rationale": "Due soon (32h). This block is prioritized to reduce deadline risk."
      }
    ],
    "unallocated": [
      {
        "deadlineId": "deadline-1739700000000-3",
        "course": "DAT520",
        "task": "Lab report",
        "priority": "medium",
        "dueDate": "2026-02-24T23:59:00.000Z",
        "remainingMinutes": 45,
        "reason": "Insufficient schedule gaps within planning window."
      }
    ]
  }
}
```

### GET `/api/recommendations/content?horizonDays=7&limit=5`

Rank YouTube videos and X posts against upcoming deadlines and lectures.

Response:

```json
{
  "generatedAt": "2026-02-17T11:00:00.000Z",
  "horizonDays": 7,
  "summary": {
    "targetsConsidered": 4,
    "candidatesConsidered": 28,
    "recommendationsReturned": 5
  },
  "recommendations": [
    {
      "id": "recommendation-deadline-deadline-1739700000000-1-youtube-abc123",
      "target": {
        "type": "deadline",
        "id": "deadline-1739700000000-1",
        "course": "DAT560",
        "title": "Assignment 3",
        "dueDate": "2026-02-19T23:59:00.000Z",
        "priority": "high"
      },
      "content": {
        "platform": "youtube",
        "id": "abc123",
        "title": "Transformer and VAE tutorial for machine learning assignments",
        "description": "Practical deep learning walkthrough for students.",
        "author": "ML Academy",
        "url": "https://www.youtube.com/watch?v=abc123",
        "publishedAt": "2026-02-17T06:00:00.000Z",
        "engagement": 73400
      },
      "score": 166.2,
      "matchedKeywords": ["dat560", "vae", "machine learning"],
      "reason": "Matched DAT560 context via dat560, vae, machine learning. Fresh content from the last 24h. Boosted for DAT560 ML relevance."
    }
  ]
}
```
