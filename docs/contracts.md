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
  }
}
```
