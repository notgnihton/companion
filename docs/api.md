# Companion API

Base URL (local dev): `http://localhost:8787`

All request/response bodies are JSON.  
Validation errors return HTTP `400` with:

```json
{
  "error": "Validation message",
  "issues": []
}
```

## Health

### `GET /api/health`

Response `200`:

```json
{ "status": "ok" }
```

## Dashboard

### `GET /api/dashboard`

Returns the current runtime snapshot used by the web dashboard.

Response `200`:

```json
{
  "generatedAt": "2026-02-15T01:00:00.000Z",
  "summary": {
    "todayFocus": "Balanced schedule with deadlines first",
    "pendingDeadlines": 2,
    "activeAgents": 1,
    "journalStreak": 0
  },
  "agentStates": [],
  "notifications": [],
  "events": []
}
```

## Context

### `POST /api/context`

Request:

```json
{
  "stressLevel": "low|medium|high",
  "energyLevel": "low|medium|high",
  "mode": "focus|balanced|recovery"
}
```

Response `200`:

```json
{
  "context": {
    "stressLevel": "medium",
    "energyLevel": "high",
    "mode": "focus"
  }
}
```

## Journal

### `POST /api/journal`

Request:

```json
{
  "content": "Finished chapter 4 and outlined notes."
}
```

## Calendar Import

### `POST /api/calendar/import/preview`

Parses ICS content and returns what would be imported without writing schedule/deadline records.

Request body is the same as `/api/calendar/import` (`ics` or `url`).

Response `200`:

```json
{
  "importedEvents": 2,
  "lecturesPlanned": 1,
  "deadlinesPlanned": 1,
  "lectures": [
    {
      "title": "Algorithms Lecture",
      "startTime": "2026-03-01T10:00:00.000Z",
      "durationMinutes": 90,
      "workload": "medium"
    }
  ],
  "deadlines": [
    {
      "course": "General",
      "task": "Systems Assignment Due",
      "dueDate": "2026-03-02T23:59:00.000Z",
      "priority": "high",
      "completed": false
    }
  ]
}
```

### `POST /api/calendar/import`

Imports events from an ICS payload or remote ICS URL, then normalizes them into
schedule lectures and deadlines.

Request (inline ICS):

```json
{
  "ics": "BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:Algorithms Lecture\nDTSTART:20260301T100000Z\nDTEND:20260301T113000Z\nEND:VEVENT\nEND:VCALENDAR"
}
```

Request (remote ICS URL):

```json
{
  "url": "https://example.edu/calendar.ics"
}
```

Response `201`:

```json
{
  "importedEvents": 2,
  "lecturesCreated": 1,
  "deadlinesCreated": 1,
  "lectures": [
    {
      "id": "lecture-1739570000000-4",
      "title": "Algorithms Lecture",
      "startTime": "2026-03-01T10:00:00.000Z",
      "durationMinutes": 90,
      "workload": "medium"
    }
  ],
  "deadlines": [
    {
      "id": "deadline-1739570000000-5",
      "course": "Systems",
      "task": "Systems Assignment Due",
      "dueDate": "2026-03-02T23:59:00.000Z",
      "priority": "critical",
      "completed": false
    }
  ]
}
```

Response `200`:

```json
{
  "entry": {
    "id": "journal-1739570000000-1",
    "content": "Finished chapter 4 and outlined notes.",
    "timestamp": "2026-02-15T01:00:00.000Z"
  }
}
```

### `GET /api/journal?limit=10`

Query params:
- `limit` (optional, positive integer)

Response `200`:

```json
{
  "entries": [
    {
      "id": "journal-1739570000000-1",
      "content": "Finished chapter 4 and outlined notes.",
      "timestamp": "2026-02-15T01:00:00.000Z"
    }
  ]
}
```

## Schedule

Schedule payload fields:
- `title`: string
- `startTime`: ISO datetime string
- `durationMinutes`: positive integer (max `1440`)
- `workload`: `low | medium | high`

### `POST /api/schedule`

Request:

```json
{
  "title": "Algorithms",
  "startTime": "2026-02-16T10:00:00.000Z",
  "durationMinutes": 90,
  "workload": "high"
}
```

Response `201`:

```json
{
  "lecture": {
    "id": "lecture-1739570000000-2",
    "title": "Algorithms",
    "startTime": "2026-02-16T10:00:00.000Z",
    "durationMinutes": 90,
    "workload": "high"
  }
}
```

### `GET /api/schedule`

Response `200`:

```json
{
  "schedule": [
    {
      "id": "lecture-1739570000000-2",
      "title": "Algorithms",
      "startTime": "2026-02-16T10:00:00.000Z",
      "durationMinutes": 90,
      "workload": "high"
    }
  ]
}
```

### `GET /api/schedule/:id`

Response `200`:

```json
{
  "lecture": {
    "id": "lecture-1739570000000-2",
    "title": "Algorithms",
    "startTime": "2026-02-16T10:00:00.000Z",
    "durationMinutes": 90,
    "workload": "high"
  }
}
```

Not found response `404`:

```json
{ "error": "Schedule entry not found" }
```

### `PATCH /api/schedule/:id`

Request (any subset of fields):

```json
{
  "durationMinutes": 120,
  "workload": "medium"
}
```

Response `200`: same shape as `GET /api/schedule/:id`.

### `DELETE /api/schedule/:id`

Response `204` with empty body.

## Deadlines

Deadline payload fields:
- `course`: string
- `task`: string
- `dueDate`: ISO datetime string
- `priority`: `low | medium | high | critical`
- `completed`: boolean (`false` by default on create)

### `POST /api/deadlines`

Request:

```json
{
  "course": "Algorithms",
  "task": "Problem Set 4",
  "dueDate": "2026-02-17T23:59:00.000Z",
  "priority": "high"
}
```

Response `201`:

```json
{
  "deadline": {
    "id": "deadline-1739570000000-3",
    "course": "Algorithms",
    "task": "Problem Set 4",
    "dueDate": "2026-02-17T23:59:00.000Z",
    "priority": "high",
    "completed": false
  }
}
```

### `GET /api/deadlines`

Response `200`:

```json
{
  "deadlines": [
    {
      "id": "deadline-1739570000000-3",
      "course": "Algorithms",
      "task": "Problem Set 4",
      "dueDate": "2026-02-17T23:59:00.000Z",
      "priority": "high",
      "completed": false
    }
  ]
}
```

### `GET /api/deadlines/:id`

Response `200`: same shape as deadline item above.

Not found response `404`:

```json
{ "error": "Deadline not found" }
```

### `PATCH /api/deadlines/:id`

Request (any subset of fields):

```json
{
  "completed": true
}
```

Response `200`: same shape as `GET /api/deadlines/:id`.

### `DELETE /api/deadlines/:id`

Response `204` with empty body.
