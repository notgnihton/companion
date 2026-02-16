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
- `recurrence` (optional): Recurrence rule object
  - `frequency`: `daily | weekly | monthly`
  - `interval` (optional): positive integer (how often to repeat, e.g., every 2 weeks)
  - `count` (optional): positive integer (number of occurrences)
  - `until` (optional): ISO datetime string (end date)
  - `byWeekDay` (optional): array of integers 0-6 (0=Sunday, 6=Saturday) for weekly recurrence
  - `byMonthDay` (optional): integer 1-31 (day of month) for monthly recurrence
  - Note: Cannot specify both `count` and `until`
- `recurrenceParentId` (optional): string (ID of parent recurring event)

### `POST /api/schedule`

Request (non-recurring):

```json
{
  "title": "Algorithms",
  "startTime": "2026-02-16T10:00:00.000Z",
  "durationMinutes": 90,
  "workload": "high"
}
```

Request (daily recurrence with count):

```json
{
  "title": "Morning Standup",
  "startTime": "2026-02-17T09:00:00.000Z",
  "durationMinutes": 15,
  "workload": "low",
  "recurrence": {
    "frequency": "daily",
    "count": 10
  }
}
```

Request (weekly recurrence on specific days):

```json
{
  "title": "Algorithms Lecture",
  "startTime": "2026-02-17T10:00:00.000Z",
  "durationMinutes": 90,
  "workload": "high",
  "recurrence": {
    "frequency": "weekly",
    "byWeekDay": [1, 3, 5],
    "until": "2026-05-01T00:00:00.000Z"
  }
}
```

Request (monthly recurrence on specific day):

```json
{
  "title": "Monthly Review",
  "startTime": "2026-02-15T16:00:00.000Z",
  "durationMinutes": 60,
  "workload": "medium",
  "recurrence": {
    "frequency": "monthly",
    "byMonthDay": 15,
    "count": 6
  }
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
    "workload": "high",
    "recurrence": {
      "frequency": "weekly",
      "byWeekDay": [1, 3, 5],
      "until": "2026-05-01T00:00:00.000Z"
    }
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

### `GET /api/deadlines/suggestions`

Analyzes schedule gaps and recommends optimal work time blocks for upcoming deadlines. Returns smart suggestions based on deadline priority, urgency, available time slots, and time-of-day quality.

The endpoint looks ahead 72 hours by default and suggests the best times to work on each incomplete deadline by considering:
- Schedule gaps (free time between lectures/events)
- Deadline urgency (how soon it's due)
- Deadline priority (critical, high, medium, low)
- Time of day quality (peak productivity hours)
- Proximity to current time (sooner is more actionable)

Response `200`:

```json
{
  "suggestions": [
    {
      "deadline": {
        "id": "deadline-1739570000000-3",
        "course": "Algorithms",
        "task": "Problem Set 4",
        "dueDate": "2026-02-17T23:59:00.000Z",
        "priority": "high",
        "completed": false
      },
      "suggestedStartTime": "2026-02-15T14:00:00.000Z",
      "suggestedEndTime": "2026-02-15T16:00:00.000Z",
      "durationMinutes": 120,
      "gapQualityScore": 85,
      "priorityScore": 135,
      "overallScore": 110,
      "rationale": "⏰ Due tomorrow. You have 180 minutes free - plenty of time to complete this task (estimated 120 min). Coming up soon - good time to prepare."
    }
  ]
}
```

**Response Fields**:
- `deadline`: The deadline object this suggestion is for
- `suggestedStartTime`: ISO datetime when to start working
- `suggestedEndTime`: ISO datetime when the work block ends
- `durationMinutes`: Length of suggested work session
- `gapQualityScore`: Score (0-100) for how good this time slot is
- `priorityScore`: Score based on deadline priority and urgency
- `overallScore`: Combined score used for ranking suggestions
- `rationale`: Human-readable explanation of why this suggestion is recommended

**Notes**:
- Returns up to 10 suggestions, sorted by overall score (highest first)
- Only includes incomplete deadlines
- Only suggests gaps of at least 60 minutes
- Only includes suggestions with overall score ≥ 30

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

## Background Sync

Background sync API enables queuing operations for automatic synchronization when connectivity is restored or the app reopens.

### `POST /api/sync/queue`

Add an operation to the background sync queue.

Request:

```json
{
  "operationType": "journal|deadline|context",
  "payload": {
    "...": "operation-specific data"
  }
}
```

**Journal Sync Payload**:
```json
{
  "operationType": "journal",
  "payload": {
    "clientEntryId": "client-uuid",
    "content": "Journal entry text",
    "timestamp": "2026-02-15T01:00:00.000Z",
    "baseVersion": 1,
    "tags": ["tag-id-1", "tag-id-2"],
    "photos": [
      {
        "dataUrl": "data:image/png;base64,...",
        "fileName": "photo.png"
      }
    ]
  }
}
```

**Deadline Sync Payload (create)**:
```json
{
  "operationType": "deadline",
  "payload": {
    "deadlineId": "temp-new-deadline-uuid",
    "updates": {
      "course": "CS101",
      "task": "Assignment 1",
      "dueDate": "2026-02-20T23:59:00.000Z",
      "priority": "high",
      "completed": false
    }
  }
}
```

**Deadline Sync Payload (update)**:
```json
{
  "operationType": "deadline",
  "payload": {
    "deadlineId": "deadline-existing-id",
    "updates": {
      "completed": true,
      "priority": "low"
    }
  }
}
```

**Context Sync Payload**:
```json
{
  "operationType": "context",
  "payload": {
    "stressLevel": "low",
    "energyLevel": "high",
    "mode": "focus"
  }
}
```

Response `201`:

```json
{
  "item": {
    "id": "sync-1739570000000-1",
    "operationType": "journal",
    "payload": { "...": "..." },
    "status": "pending",
    "attempts": 0,
    "lastAttemptAt": null,
    "createdAt": "2026-02-15T01:00:00.000Z",
    "completedAt": null,
    "error": null
  }
}
```

### `POST /api/sync/process`

Manually trigger sync queue processing (processes all pending items).

Response `200`:

```json
{
  "success": true,
  "processed": 5,
  "failed": 1
}
```

Error Response `500`:

```json
{
  "error": "Sync processing failed",
  "message": "Detailed error message"
}
```

### `GET /api/sync/status`

Get the current status of the sync queue.

Response `200`:

```json
{
  "status": {
    "pending": 3,
    "processing": 0,
    "failed": 1,
    "recentItems": [
      {
        "id": "sync-1739570000000-1",
        "operationType": "journal",
        "payload": { "...": "..." },
        "status": "completed",
        "attempts": 1,
        "lastAttemptAt": "2026-02-15T01:00:30.000Z",
        "createdAt": "2026-02-15T01:00:00.000Z",
        "completedAt": "2026-02-15T01:00:30.000Z",
        "error": null
      }
    ]
  },
  "isProcessing": false
}
```

**Status Field Values**:
- `pending`: Items waiting to be processed or retried
- `processing`: Items currently being processed
- `failed`: Items that failed after max retries (5 attempts)
- `completed`: Successfully processed items

**Item Status Values**:
- `pending`: Waiting for processing or retry
- `processing`: Currently being processed
- `completed`: Successfully synced
- `failed`: Failed after max retries

### `DELETE /api/sync/cleanup`

Clean up completed sync items older than 7 days.

Response `200`:

```json
{
  "deleted": 15
}
```

**Automatic Sync Processing**:
- Background sync service runs every 30 seconds automatically
- Failed operations are retried with exponential backoff (1s, 2s, 4s, 8s, 16s)
- Operations are marked as failed after 5 retry attempts
- Completed items older than 7 days can be cleaned up via the cleanup endpoint

## Canvas LMS Integration

Canvas LMS sync requires configuration:
- `CANVAS_API_TOKEN`: Personal access token from Canvas Settings
- `CANVAS_BASE_URL`: Canvas instance URL (default: `https://stavanger.instructure.com`)

### `GET /api/canvas/status`

Get Canvas sync status including last sync time, next scheduled sync, and counts.

Response `200`:

```json
{
  "status": {
    "lastSyncAt": "2026-02-16T12:00:00.000Z",
    "nextSyncAt": "2026-02-16T12:30:00.000Z",
    "syncing": false,
    "coursesCount": 3,
    "assignmentsCount": 15,
    "modulesCount": 8,
    "announcementsCount": 5,
    "errors": []
  }
}
```

### `POST /api/canvas/sync`

Trigger a manual Canvas sync. Fetches courses, assignments, modules, and announcements from Canvas LMS.

Response `200`:

```json
{
  "status": {
    "lastSyncAt": "2026-02-16T12:00:00.000Z",
    "nextSyncAt": "2026-02-16T12:30:00.000Z",
    "syncing": false,
    "coursesCount": 3,
    "assignmentsCount": 15,
    "modulesCount": 8,
    "announcementsCount": 5,
    "errors": []
  },
  "message": "Canvas sync completed"
}
```

Response `500` (on error):

```json
{
  "error": "Canvas sync failed",
  "message": "Canvas API request failed: Unauthorized"
}
```

### `GET /api/canvas/courses`

Get all synced Canvas courses.

Response `200`:

```json
{
  "courses": [
    {
      "id": 12345,
      "name": "DAT520 Distributed Systems",
      "courseCode": "DAT520",
      "enrollmentTermId": 100,
      "startAt": "2026-01-13T00:00:00Z",
      "endAt": "2026-06-13T00:00:00Z",
      "workflowState": "available"
    }
  ]
}
```

### `GET /api/canvas/assignments`

Get all synced Canvas assignments. Optionally filter by course.

Query parameters:
- `courseId` (optional): Filter assignments by course ID

Response `200`:

```json
{
  "assignments": [
    {
      "id": 67890,
      "courseId": 12345,
      "name": "Lab 1: MapReduce",
      "description": "Implement MapReduce framework",
      "dueAt": "2026-01-22T23:59:00Z",
      "pointsPossible": 100,
      "submissionTypes": ["online_upload"],
      "hasSubmittedSubmissions": false,
      "workflowState": "published",
      "htmlUrl": "https://stavanger.instructure.com/courses/12345/assignments/67890"
    }
  ]
}
```

### `GET /api/canvas/modules`

Get all synced Canvas modules. Optionally filter by course.

Query parameters:
- `courseId` (optional): Filter modules by course ID

Response `200`:

```json
{
  "modules": [
    {
      "id": 11111,
      "courseId": 12345,
      "name": "Week 1: Introduction to Distributed Systems",
      "position": 1,
      "unlockAt": null,
      "requireSequentialProgress": false,
      "state": "unlocked"
    }
  ]
}
```

### `GET /api/canvas/announcements`

Get all synced Canvas announcements. Optionally filter by course.

Query parameters:
- `courseId` (optional): Filter announcements by course ID

Response `200`:

```json
{
  "announcements": [
    {
      "id": 22222,
      "courseId": 12345,
      "title": "Welcome to DAT520!",
      "message": "<p>Looking forward to a great semester.</p>",
      "postedAt": "2026-01-13T10:00:00Z",
      "author": {
        "displayName": "Professor Smith"
      }
    }
  ]
}
```

**Automatic Canvas Sync**:
- Canvas sync runs automatically every 30 minutes after service start
- Syncs courses, assignments, modules, and announcements for all active courses
- Errors during sync are logged in the sync status
- Manual sync can be triggered via `POST /api/canvas/sync`
