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

## Nutrition

### GET `/api/nutrition/summary?date=YYYY-MM-DD`

Response:

```json
{
  "summary": {
    "date": "2026-02-17",
    "totals": {
      "calories": 1860,
      "proteinGrams": 132,
      "carbsGrams": 201,
      "fatGrams": 58
    },
    "targetProfile": {
      "date": "2026-02-17",
      "weightKg": 73,
      "maintenanceCalories": 2621,
      "surplusCalories": 300,
      "targetCalories": 2921,
      "targetProteinGrams": 128.7,
      "targetCarbsGrams": 456.7,
      "targetFatGrams": 64.4,
      "createdAt": "2026-02-17T07:00:00.000Z",
      "updatedAt": "2026-02-17T07:00:00.000Z"
    },
    "remainingToTarget": {
      "calories": 1061,
      "proteinGrams": -3.3,
      "carbsGrams": 255.7,
      "fatGrams": 6.4
    },
    "mealsLogged": 3,
    "meals": []
  }
}
```

### GET `/api/nutrition/targets?date=YYYY-MM-DD`

Response:

```json
{
  "profile": {
    "date": "2026-02-17",
    "weightKg": 73,
    "maintenanceCalories": 2621,
    "surplusCalories": 300,
    "targetCalories": 2921,
    "targetProteinGrams": 128.7,
    "targetCarbsGrams": 456.7,
    "targetFatGrams": 64.4,
    "createdAt": "2026-02-17T07:00:00.000Z",
    "updatedAt": "2026-02-17T07:00:00.000Z"
  }
}
```

### PUT `/api/nutrition/targets`

Request:

```json
{
  "date": "2026-02-17",
  "weightKg": 73,
  "maintenanceCalories": 2621,
  "surplusCalories": 300
}
```

Derivation behavior: when `weightKg`, `maintenanceCalories`, and `surplusCalories` are present, calories are `maintenance+surplus`, protein/fat follow `0.8/0.4 g per lb`, and carbs are auto-filled from remaining calories.

Response:

```json
{
  "profile": {
    "date": "2026-02-17",
    "weightKg": 73,
    "maintenanceCalories": 2621,
    "surplusCalories": 300,
    "targetCalories": 2921,
    "targetProteinGrams": 128.7,
    "targetCarbsGrams": 456.7,
    "targetFatGrams": 64.4,
    "createdAt": "2026-02-17T07:00:00.000Z",
    "updatedAt": "2026-02-17T07:00:00.000Z"
  }
}
```

### POST `/api/nutrition/meals`

Request:

```json
{
  "name": "Chicken bowl",
  "mealType": "lunch",
  "items": [
    {
      "name": "Chicken breast",
      "quantity": 1,
      "unitLabel": "portion",
      "caloriesPerUnit": 330,
      "proteinGramsPerUnit": 62,
      "carbsGramsPerUnit": 0,
      "fatGramsPerUnit": 7
    },
    {
      "name": "Rice",
      "quantity": 1.5,
      "unitLabel": "cup",
      "caloriesPerUnit": 252,
      "proteinGramsPerUnit": 5.4,
      "carbsGramsPerUnit": 55.5,
      "fatGramsPerUnit": 0.4
    }
  ]
}
```

Response:

```json
{
  "meal": {
    "id": "meal-123",
    "name": "Chicken bowl",
    "mealType": "lunch",
    "consumedAt": "2026-02-17T11:45:00.000Z",
    "items": [
      {
        "id": "nutrition-meal-item-1",
        "name": "Chicken breast",
        "quantity": 1,
        "unitLabel": "portion",
        "caloriesPerUnit": 330,
        "proteinGramsPerUnit": 62,
        "carbsGramsPerUnit": 0,
        "fatGramsPerUnit": 7
      }
    ],
    "calories": 710,
    "proteinGrams": 54,
    "carbsGrams": 76,
    "fatGrams": 18,
    "createdAt": "2026-02-17T11:45:01.000Z"
  }
}
```

### PATCH `/api/nutrition/meals/:id`

Request (all fields optional, at least one required):

```json
{
  "items": [
    {
      "name": "Whey isolate",
      "quantity": 1.25,
      "unitLabel": "scoop",
      "caloriesPerUnit": 110,
      "proteinGramsPerUnit": 25,
      "carbsGramsPerUnit": 2,
      "fatGramsPerUnit": 1
    }
  ]
}
```

Response:

```json
{
  "meal": {
    "id": "meal-123",
    "name": "Protein shake",
    "mealType": "snack",
    "consumedAt": "2026-02-17T10:00:00.000Z",
    "calories": 250,
    "proteinGrams": 37.5,
    "carbsGrams": 10,
    "fatGrams": 3.8,
    "createdAt": "2026-02-17T10:00:01.000Z"
  }
}
```

### GET `/api/nutrition/custom-foods?query=...&limit=200`

Response:

```json
{
  "foods": [
    {
      "id": "custom-food-1",
      "name": "Whey isolate",
      "unitLabel": "scoop",
      "caloriesPerUnit": 110,
      "proteinGramsPerUnit": 25,
      "carbsGramsPerUnit": 2,
      "fatGramsPerUnit": 1,
      "createdAt": "2026-02-17T08:00:00.000Z",
      "updatedAt": "2026-02-17T08:00:00.000Z"
    }
  ]
}
```

### POST `/api/nutrition/custom-foods`

Request:

```json
{
  "name": "Whey isolate",
  "unitLabel": "scoop",
  "caloriesPerUnit": 110,
  "proteinGramsPerUnit": 25,
  "carbsGramsPerUnit": 2,
  "fatGramsPerUnit": 1
}
```

Response:

```json
{
  "food": {
    "id": "custom-food-1",
    "name": "Whey isolate",
    "unitLabel": "scoop",
    "caloriesPerUnit": 110,
    "proteinGramsPerUnit": 25,
    "carbsGramsPerUnit": 2,
    "fatGramsPerUnit": 1,
    "createdAt": "2026-02-17T08:00:00.000Z",
    "updatedAt": "2026-02-17T08:00:00.000Z"
  }
}
```

### PATCH `/api/nutrition/custom-foods/:id`

Request: same fields as POST, all optional.

Response:

```json
{
  "food": {
    "id": "custom-food-1",
    "name": "Whey isolate",
    "unitLabel": "scoop",
    "caloriesPerUnit": 115,
    "proteinGramsPerUnit": 25,
    "carbsGramsPerUnit": 2,
    "fatGramsPerUnit": 1,
    "createdAt": "2026-02-17T08:00:00.000Z",
    "updatedAt": "2026-02-17T08:10:00.000Z"
  }
}
```

### DELETE `/api/nutrition/custom-foods/:id`

Response: `204 No Content`

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
    "model": "gemini-3-flash-preview"
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

### POST `/api/integrations/scope/preview`

Preview matched records for integration scope before syncing.

Request (all fields optional):

```json
{
  "semester": "26v",
  "tpCourseIds": ["DAT520,1", "DAT560,1"],
  "canvasCourseIds": [17649],
  "pastDays": 30,
  "futureDays": 180
}
```

Response:

```json
{
  "preview": {
    "window": {
      "pastDays": 30,
      "futureDays": 180,
      "start": "2026-01-18T11:00:00.000Z",
      "end": "2026-08-16T11:00:00.000Z"
    },
    "canvas": {
      "coursesMatched": 1,
      "coursesTotal": 3,
      "assignmentsMatched": 4,
      "assignmentsTotal": 11
    },
    "tp": {
      "semester": "26v",
      "courseIdsApplied": ["DAT520,1", "DAT560,1"],
      "eventsMatched": 26,
      "eventsTotal": 39
    }
  }
}
```

### POST `/api/canvas/sync`

Trigger manual Canvas sync with optional scope overrides.

Request (all fields optional):

```json
{
  "token": "canvas-api-token",
  "baseUrl": "https://stavanger.instructure.com",
  "courseIds": [17649, 17650],
  "pastDays": 30,
  "futureDays": 180
}
```

Response:

```json
{
  "success": true,
  "coursesCount": 2,
  "assignmentsCount": 7,
  "modulesCount": 10,
  "announcementsCount": 4
}
```

### POST `/api/sync/tp`

Trigger manual TP EduCloud schedule sync (fetches public iCal feed, no API key needed) with optional scope overrides.

Request (all fields optional):

```json
{
  "semester": "26v",
  "courseIds": ["DAT520,1", "DAT560,1", "DAT600,1"],
  "pastDays": 30,
  "futureDays": 180
}
```

Response:

```json
{
  "success": true,
  "eventsProcessed": 151,
  "lecturesCreated": 8,
  "lecturesUpdated": 3,
  "lecturesDeleted": 1,
  "appliedScope": {
    "semester": "26v",
    "courseIds": ["DAT520,1", "DAT560,1", "DAT600,1"],
    "pastDays": 30,
    "futureDays": 180
  }
}
```

### POST `/api/sync/github`

Trigger manual GitHub course sync (deadlines + syllabus/course-info docs).

Response:

```json
{
  "success": true,
  "reposProcessed": 2,
  "deadlinesCreated": 1,
  "deadlinesUpdated": 2,
  "courseDocsSynced": 5,
  "lastSyncedAt": "2026-02-17T15:20:00.000Z"
}
```

### GET `/api/github/status`

Read current GitHub sync status and repository coverage.

Response:

```json
{
  "configured": true,
  "lastSyncedAt": "2026-02-17T15:20:00.000Z",
  "repositories": [
    { "owner": "dat520-2026", "repo": "assignments", "courseCode": "DAT520" },
    { "owner": "dat560-2026", "repo": "info", "courseCode": "DAT560" }
  ],
  "courseDocsSynced": 5,
  "deadlinesFound": 7
}
```

### GET `/api/github/course-content?courseCode=DAT560&limit=12`

Return extracted syllabus/course-information docs from synced GitHub repos.

Response:

```json
{
  "configured": true,
  "lastSyncedAt": "2026-02-17T15:20:00.000Z",
  "repositories": [
    { "owner": "dat520-2026", "repo": "assignments", "courseCode": "DAT520" },
    { "owner": "dat560-2026", "repo": "info", "courseCode": "DAT560" }
  ],
  "total": 2,
  "documents": [
    {
      "id": "github-doc-dat560-abc123",
      "courseCode": "DAT560",
      "owner": "dat560-2026",
      "repo": "info",
      "path": "README.md",
      "url": "https://github.com/dat560-2026/info/blob/HEAD/README.md",
      "title": "DAT560 Syllabus",
      "summary": "Key milestones and assessment details...",
      "highlights": ["Project deliverable due March 10"],
      "snippet": "Longer extracted excerpt...",
      "syncedAt": "2026-02-17T15:20:00.000Z"
    }
  ]
}
```

### GET `/api/sync/status`

Integration sync status overview.

Response:

```json
{
  "storage": {
    "backend": "postgres-snapshot",
    "sqlitePath": "/app/data/companion.db",
    "snapshotRestoredAt": "2026-02-17T15:40:00.000Z",
    "snapshotPersistedAt": "2026-02-17T15:45:00.000Z",
    "snapshotSizeBytes": 284672,
    "lastError": null
  },
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
    "lastSyncAt": "2026-02-17T15:20:00.000Z",
    "status": "ok",
    "reposTracked": 2,
    "courseDocsSynced": 5,
    "deadlinesFound": 7
  },
  "gemini": {
    "status": "ok",
    "model": "gemini-3-flash-preview",
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
  "autoHealing": {
    "tp": {
      "integration": "tp",
      "consecutiveFailures": 0,
      "lastSuccessAt": "2026-02-17T16:20:00.000Z",
      "lastFailureAt": null,
      "lastError": null,
      "backoffUntil": null,
      "circuitOpenUntil": null,
      "nextAttemptAt": null,
      "lastBackoffMs": 0,
      "skipCounts": {
        "backoff": 0,
        "circuitOpen": 0
      }
    }
  }
}
```

### GET `/api/integrations/health-log?integration=canvas&status=failure&limit=50&hours=168`

Return persisted TP/Canvas/Gmail sync attempts for troubleshooting.

Response:

```json
{
  "generatedAt": "2026-02-17T16:30:00.000Z",
  "total": 3,
  "attempts": [
    {
      "id": "sync-attempt-1739809800000-1",
      "integration": "canvas",
      "status": "failure",
      "latencyMs": 1842,
      "rootCause": "auth",
      "errorMessage": "401 unauthorized",
      "attemptedAt": "2026-02-17T16:25:00.000Z"
    }
  ]
}
```

### GET `/api/integrations/health-log/summary?hours=168`

Return reliability analytics for TP/Canvas/Gmail sync attempts.

Response:

```json
{
  "generatedAt": "2026-02-17T16:30:00.000Z",
  "windowHours": 168,
  "totals": {
    "attempts": 22,
    "successes": 18,
    "failures": 4,
    "successRate": 81.8
  },
  "integrations": [
    {
      "integration": "gmail",
      "attempts": 8,
      "successes": 6,
      "failures": 2,
      "successRate": 75,
      "averageLatencyMs": 921,
      "lastAttemptAt": "2026-02-17T16:20:00.000Z",
      "lastSuccessAt": "2026-02-17T15:50:00.000Z",
      "failuresByRootCause": {
        "none": 0,
        "auth": 1,
        "network": 1,
        "rate_limit": 0,
        "validation": 0,
        "provider": 0,
        "unknown": 0
      }
    }
  ]
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

### GET `/api/deadlines/duplicates`

Detect likely duplicate deadlines and propose canonical merge suggestions.

Response:

```json
{
  "generatedAt": "2026-02-17T12:00:00.000Z",
  "totalDeadlines": 12,
  "duplicateGroups": 1,
  "suggestions": [
    {
      "canonicalId": "deadline-manual-1",
      "canonicalSource": "manual",
      "duplicateIds": ["deadline-canvas-1", "github-dat560-assignment-3-report"],
      "confidence": "high",
      "score": 0.93,
      "reason": "3 deadlines appear duplicated for DAT560; tasks are textually similar with same due day.",
      "mergedPreview": {
        "course": "DAT560",
        "task": "Assignment 3 Report",
        "dueDate": "2026-03-20T23:59:00.000Z",
        "priority": "high",
        "completed": false
      },
      "members": [
        {
          "id": "deadline-manual-1",
          "source": "manual",
          "course": "DAT560",
          "task": "Assignment 3 Report",
          "dueDate": "2026-03-20T23:59:00.000Z",
          "priority": "high",
          "completed": false
        }
      ]
    }
  ]
}
```

### POST `/api/study-plan/generate`

Generate a deterministic weekly study plan from upcoming deadlines and open schedule gaps.
Allocation now uses uniform priority-based estimates; custom effort metadata does not change planning.

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
        "id": "study-session-deadline-1739700000000-1-20260217110000000",
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
  },
  "adherence": {
    "windowStart": "2026-02-17T10:00:00.000Z",
    "windowEnd": "2026-02-24T10:00:00.000Z",
    "sessionsPlanned": 4,
    "sessionsDone": 1,
    "sessionsSkipped": 1,
    "sessionsPending": 2,
    "completionRate": 25,
    "adherenceRate": 50,
    "totalPlannedMinutes": 360,
    "completedMinutes": 90,
    "skippedMinutes": 60,
    "pendingMinutes": 210
  }
}
```

### GET `/api/study-plan/sessions`

List persisted study-plan sessions with status metadata.

Query params (optional):
- `windowStart`: ISO datetime
- `windowEnd`: ISO datetime
- `status`: `pending | done | skipped`
- `limit`: integer `1..500`

Response:

```json
{
  "sessions": [
    {
      "id": "study-session-deadline-1739700000000-1-20260217110000000",
      "deadlineId": "deadline-1739700000000-1",
      "course": "DAT560",
      "task": "Assignment 3",
      "priority": "high",
      "startTime": "2026-02-17T11:00:00.000Z",
      "endTime": "2026-02-17T12:30:00.000Z",
      "durationMinutes": 90,
      "score": 680,
      "rationale": "Due soon (32h). This block is prioritized to reduce deadline risk.",
      "generatedAt": "2026-02-17T10:00:00.000Z",
      "status": "done",
      "checkedAt": "2026-02-17T12:35:00.000Z",
      "energyLevel": 4,
      "focusLevel": 3,
      "checkInNote": "Good progress."
    }
  ]
}
```

### POST `/api/study-plan/sessions/:id/check-in`

Mark a stored study-plan session as done/skipped.

Request:

```json
{
  "status": "done",
  "checkedAt": "2026-02-17T12:35:00.000Z",
  "energyLevel": 4,
  "focusLevel": 3,
  "checkInNote": "Good momentum after lunch."
}
```

Validation:
- `status`: required, one of `done`, `skipped`
- `checkedAt`: optional ISO datetime; defaults to current server time
- `energyLevel`: optional integer `1..5`
- `focusLevel`: optional integer `1..5`
- `checkInNote`: optional trimmed string `1..500`

Response:

```json
{
  "session": {
    "id": "study-session-deadline-1739700000000-1-20260217110000000",
    "status": "done",
    "checkedAt": "2026-02-17T12:35:00.000Z",
    "energyLevel": 4,
    "focusLevel": 3,
    "checkInNote": "Good momentum after lunch."
  }
}
```

### GET `/api/study-plan/adherence`

Aggregate weekly adherence metrics from stored study-plan sessions.

Query params (optional):
- `windowStart`: ISO datetime
- `windowEnd`: ISO datetime

Response:

```json
{
  "metrics": {
    "windowStart": "2026-02-17T00:00:00.000Z",
    "windowEnd": "2026-02-24T00:00:00.000Z",
    "sessionsPlanned": 6,
    "sessionsDone": 3,
    "sessionsSkipped": 1,
    "sessionsPending": 2,
    "completionRate": 50,
    "adherenceRate": 75,
    "totalPlannedMinutes": 510,
    "completedMinutes": 270,
    "skippedMinutes": 90,
    "pendingMinutes": 150,
    "checkInTrends": {
      "sessionsChecked": 4,
      "sessionsWithEnergy": 3,
      "sessionsWithFocus": 2,
      "sessionsWithNotes": 2,
      "averageEnergy": 3.3,
      "averageFocus": 3.5,
      "lowEnergyCount": 1,
      "highEnergyCount": 1,
      "lowFocusCount": 0,
      "highFocusCount": 1,
      "recentNotes": [
        {
          "sessionId": "study-session-deadline-1739700000000-1-20260217110000000",
          "course": "DAT560",
          "task": "Assignment 3",
          "status": "done",
          "checkedAt": "2026-02-17T12:35:00.000Z",
          "note": "Felt sharp for most of this block."
        }
      ]
    }
  }
}
```

### GET `/api/analytics/coach?periodDays=14`

Generate narrative analytics coaching (Gemini-backed with deterministic fallback).

Query params:
- `periodDays` (optional): one of `7`, `14`, `30` (default `7`)

Response:

```json
{
  "insight": {
    "periodDays": 14,
    "windowStart": "2026-02-03T16:00:00.000Z",
    "windowEnd": "2026-02-17T16:00:00.000Z",
    "generatedAt": "2026-02-17T16:00:01.000Z",
    "source": "gemini",
    "summary": "Over the last two weeks, deadline follow-through improved but high-priority work is clustering near due dates.",
    "strengths": [
      "You are consistently checking in on habits.",
      "Study-plan completion stayed above baseline."
    ],
    "risks": [
      "Two high-priority deadlines are due within the next week.",
      "Reflection volume is low on heavy workload days."
    ],
    "recommendations": [
      "Reserve one deep-work block in the next 24 hours for the nearest high-priority deadline.",
      "Do a two-line end-of-day reflection to improve tomorrow's coaching precision.",
      "Anchor your key habit check-in to a fixed daily event after your first lecture."
    ],
    "metrics": {
      "deadlinesDue": 5,
      "deadlinesCompleted": 3,
      "openHighPriorityDeadlines": 2,
      "habitsTracked": 3,
      "habitsCompletedToday": 2,
      "averageHabitCompletion7d": 67,
      "goalsTracked": 2,
      "goalsCompletedToday": 1,
      "journalEntries": 4,
      "userReflections": 7,
      "studySessionsPlanned": 8,
      "studySessionsDone": 5,
      "studyCompletionRate": 63,
      "dominantEnergy": "medium",
      "dominantStress": "medium"
    }
  }
}
```

### GET `/api/study-plan/export?horizonDays=7&minSessionMinutes=45&maxSessionMinutes=120`

Generate and download study plan sessions as an ICS file.

Query params are optional and match `/api/study-plan/generate` validation.

Response headers:

```http
Content-Type: text/calendar; charset=utf-8
Content-Disposition: attachment; filename="study-plan-YYYY-MM-DD.ics"
```

Notes:
- Each `VEVENT` UID is deterministic (`deadlineId + startTime + duration`) to keep stable event IDs across exports.

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
