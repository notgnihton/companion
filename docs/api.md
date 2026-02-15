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
  "content": "Finished chapter 4 and outlined notes.",
  "tags": ["tag-1739570000000-1"]
}
```

Response `200`:

```json
{
  "entry": {
    "id": "journal-1739570000000-1",
    "content": "Finished chapter 4 and outlined notes.",
    "timestamp": "2026-02-15T01:00:00.000Z",
    "updatedAt": "2026-02-15T01:00:00.000Z",
    "version": 1,
    "tags": [
      { "id": "tag-1739570000000-1", "name": "study" }
    ]
  }
}
```

### `GET /api/tags`

Response `200`:

```json
{
  "tags": [
    { "id": "tag-1739570000000-1", "name": "study" }
  ]
}
```

### `POST /api/tags`

Request:

```json
{ "name": "study" }
```

Response `201` with created tag.

### `PATCH /api/tags/:id`

Request:

```json
{ "name": "research" }
```

Response `200` with updated tag or `404` if not found.

### `DELETE /api/tags/:id`

Removes a tag and its journal associations. Response `204` or `404` if not found.

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
      "timestamp": "2026-02-15T01:00:00.000Z",
      "updatedAt": "2026-02-15T01:00:00.000Z",
      "version": 1,
      "tags": [
        { "id": "tag-1739570000000-1", "name": "study" }
      ]
    }
  ]
}
```

### `GET /api/journal/search`

Search journal entries by text query and/or date range.

Query params:
- `q` (optional, string) - Text search query (case-insensitive, partial match)
- `startDate` (optional, ISO datetime string) - Filter entries on or after this date
- `endDate` (optional, ISO datetime string) - Filter entries on or before this date
- `tags` (optional, comma-separated tag ids) - Filter entries that include all listed tags
- `limit` (optional, positive integer) - Maximum number of results to return

Response `200`:

```json
{
  "entries": [
    {
      "id": "journal-1739570000000-1",
      "content": "Finished algorithms chapter 4 and outlined notes.",
      "timestamp": "2026-02-15T01:00:00.000Z",
      "updatedAt": "2026-02-15T01:00:00.000Z",
      "version": 1,
      "tags": [
        { "id": "tag-1739570000000-1", "name": "study" }
      ]
    }
  ]
}
```

Examples:
- `/api/journal/search?q=algorithms` - Find all entries containing "algorithms"
- `/api/journal/search?startDate=2026-02-01T00:00:00.000Z&endDate=2026-02-28T23:59:59.999Z` - Find entries in February 2026
- `/api/journal/search?q=algorithms&startDate=2026-02-01T00:00:00.000Z&limit=5` - Find up to 5 entries containing "algorithms" from February 2026 onwards
- `/api/journal/search?tags=tag-1739570000000-1,tag-1739570000000-2` - Entries that include both tags

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

### `POST /api/deadlines/:id/confirm-status`

Quick status confirmation for an overdue deadline reminder.

Request:

```json
{
  "completed": true
}
```

Response `200`:

```json
{
  "deadline": {
    "id": "deadline-1739570000000-3",
    "course": "Algorithms",
    "task": "Problem Set 4",
    "dueDate": "2026-02-17T23:59:00.000Z",
    "priority": "high",
    "completed": true
  },
  "reminder": {
    "deadlineId": "deadline-1739570000000-3",
    "reminderCount": 1,
    "lastReminderAt": "2026-02-18T01:00:00.000Z",
    "lastConfirmationAt": "2026-02-18T01:05:00.000Z",
    "lastConfirmedCompleted": true
  }
}
```

## Export

### `GET /api/export`

Returns all user data as downloadable JSON for backup and portability. The response includes journals, schedule events, deadlines, user context, and notification preferences.

Response `200`:

```json
{
  "exportedAt": "2026-02-15T15:00:00.000Z",
  "version": "1.0",
  "journals": [
    {
      "id": "journal-1739570000000-1",
      "content": "Finished algorithms homework",
      "timestamp": "2026-02-15T15:00:00.000Z",
      "updatedAt": "2026-02-15T15:00:00.000Z",
      "version": 1
    }
  ],
  "schedule": [
    {
      "id": "lecture-1739570000000-2",
      "title": "Algorithms Lecture",
      "startTime": "2026-02-16T10:00:00.000Z",
      "durationMinutes": 90,
      "workload": "high"
    }
  ],
  "deadlines": [
    {
      "id": "deadline-1739570000000-3",
      "course": "Systems",
      "task": "Lab Report",
      "dueDate": "2026-02-20T23:59:00.000Z",
      "priority": "high",
      "completed": false
    }
  ],
  "userContext": {
    "stressLevel": "medium",
    "energyLevel": "high",
    "mode": "focus"
  },
  "notificationPreferences": {
    "quietHours": {
      "enabled": true,
      "startHour": 22,
      "endHour": 7
    },
    "minimumPriority": "medium",
    "allowCriticalInQuietHours": true,
    "categoryToggles": {
      "notes": true,
      "lectures": true,
      "deadlines": true,
      "orchestrator": true
    }
  }
}
```

The response includes the `Content-Disposition` header with filename `companion-export.json` to trigger a download in browsers.

## Import

### `POST /api/import`

Imports user data from JSON export format with conflict resolution for existing records. Accepts partial imports (any subset of data can be provided).

Request Body:

```json
{
  "version": "1.0",
  "journals": [
    {
      "id": "journal-1739570000000-1",
      "content": "Finished algorithms homework",
      "timestamp": "2026-02-15T15:00:00.000Z",
      "updatedAt": "2026-02-15T15:00:00.000Z",
      "version": 1,
      "clientEntryId": "optional-client-id"
    }
  ],
  "schedule": [
    {
      "id": "lecture-1739570000000-2",
      "title": "Algorithms Lecture",
      "startTime": "2026-02-16T10:00:00.000Z",
      "durationMinutes": 90,
      "workload": "high"
    }
  ],
  "deadlines": [
    {
      "id": "deadline-1739570000000-3",
      "course": "Systems",
      "task": "Lab Report",
      "dueDate": "2026-02-20T23:59:00.000Z",
      "priority": "high",
      "completed": false
    }
  ],
  "habits": [
    {
      "id": "habit-1",
      "name": "Evening review",
      "cadence": "daily",
      "targetPerWeek": 6,
      "motivation": "Close the loop on the day",
      "createdAt": "2026-02-10T00:00:00.000Z"
    }
  ],
  "goals": [
    {
      "id": "goal-1",
      "title": "Ship portfolio draft",
      "cadence": "daily",
      "targetCount": 4,
      "dueDate": "2026-02-25T00:00:00.000Z",
      "createdAt": "2026-02-10T00:00:00.000Z"
    }
  ],
  "userContext": {
    "stressLevel": "medium",
    "energyLevel": "high",
    "mode": "focus"
  },
  "notificationPreferences": {
    "quietHours": {
      "enabled": true,
      "startHour": 22,
      "endHour": 7
    },
    "minimumPriority": "medium",
    "allowCriticalInQuietHours": true,
    "categoryToggles": {
      "notes": true,
      "lecture-plan": true,
      "assignment-tracker": true,
      "orchestrator": true
    }
  }
}
```

All fields are optional. You can import any subset of data (e.g., only journals, or only schedule events).

**Conflict Resolution**:
- **Journals**: Uses existing sync logic. If an entry with the same ID exists, it will be updated and version incremented.
- **Schedule, Deadlines, Habits, Goals**: If a record with the same ID exists, it will be updated with the imported data. Otherwise, a new record is created with the provided ID.
- **User Context & Preferences**: Merged with existing values (partial updates supported).

Response `200`:

```json
{
  "imported": {
    "journals": 1,
    "schedule": 1,
    "deadlines": 1,
    "habits": 1,
    "goals": 1
  },
  "conflicts": {
    "journals": []
  },
  "warnings": []
}
```

**Response Fields**:
- `imported`: Count of successfully imported items per category
- `conflicts.journals`: Array of journal entries that had version conflicts (not imported)
- `warnings`: Array of warning messages (e.g., version incompatibility, failed imports)

Error Response `400`:

```json
{
  "error": "Invalid import data",
  "issues": [
    {
      "code": "invalid_type",
      "expected": "string",
      "received": "number",
      "path": ["journals", 0, "content"],
      "message": "Expected string, received number"
    }
  ]
}
```
