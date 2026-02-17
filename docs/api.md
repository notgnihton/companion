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

## Integrations

### `POST /api/integrations/scope/preview`

Previews how many records match the current integration scope settings before running sync.

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

Response `200`:

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

### `POST /api/canvas/sync`

Runs manual Canvas sync with optional scope overrides.

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

Validation:
- `courseIds`: array of positive integers (max 100)
- `pastDays`: integer `0..365`
- `futureDays`: integer `1..730`

Response `200`:

```json
{
  "success": true,
  "coursesCount": 2,
  "assignmentsCount": 7,
  "modulesCount": 10,
  "announcementsCount": 4
}
```

### `POST /api/sync/tp`

Runs manual TP iCal sync with optional scope overrides.

Request (all fields optional):

```json
{
  "semester": "26v",
  "courseIds": ["DAT520,1", "DAT560,1", "DAT600,1"],
  "pastDays": 30,
  "futureDays": 180
}
```

Validation:
- `semester`: non-empty string, max 16 chars
- `courseIds`: array of non-empty strings, max 100
- `pastDays`: integer `0..365`
- `futureDays`: integer `1..730`

Response `200`:

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
- `effortHoursRemaining`: number (optional, `0..200`, remaining hours estimate)
- `effortConfidence`: `low | medium | high` (optional, confidence for effort estimate)

### `POST /api/deadlines`

Request:

```json
{
  "course": "Algorithms",
  "task": "Problem Set 4",
  "dueDate": "2026-02-17T23:59:00.000Z",
  "priority": "high",
  "effortHoursRemaining": 5.5,
  "effortConfidence": "medium"
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
    "completed": false,
    "effortHoursRemaining": 5.5,
    "effortConfidence": "medium"
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
      "completed": false,
      "effortHoursRemaining": 5.5,
      "effortConfidence": "medium"
    }
  ]
}
```

### `GET /api/deadlines/duplicates`

Detects likely duplicate deadlines across manual, Canvas, and GitHub sources and returns canonical merge suggestions.

Response `200`:

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
          "course": "DAT560",
          "task": "Assignment 3 Report",
          "dueDate": "2026-03-20T23:59:00.000Z",
          "priority": "high",
          "completed": false,
          "source": "manual"
        }
      ]
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
  "completed": true,
  "effortHoursRemaining": 2,
  "effortConfidence": "low"
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

## Study Plan

### `POST /api/study-plan/generate`

Generates a deterministic weekly study plan by combining incomplete deadlines with schedule gaps.
If a deadline includes `effortHoursRemaining`, planning uses that value (adjusted by `effortConfidence`) instead of the priority-based default estimate.

Request:

```json
{
  "horizonDays": 7,
  "minSessionMinutes": 45,
  "maxSessionMinutes": 120
}
```

All fields are optional. Defaults:
- `horizonDays`: `7` (range `1..14`)
- `minSessionMinutes`: `45` (range `30..180`)
- `maxSessionMinutes`: `120` (range `45..240`, must be `>= minSessionMinutes`)

Response `200`:

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
    "unallocated": []
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

### `GET /api/study-plan/sessions`

Returns stored study-plan sessions with status (`pending`, `done`, `skipped`).

Query params (all optional):
- `windowStart`: ISO datetime
- `windowEnd`: ISO datetime
- `status`: `pending | done | skipped`
- `limit`: integer `1..500`

Response `200`:

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

### `POST /api/study-plan/sessions/:id/check-in`

Mark a stored study-plan session as completed or skipped.

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
- `status`: `done | skipped`
- `checkedAt`: optional ISO datetime (defaults to current server time)
- `energyLevel`: optional integer `1..5`
- `focusLevel`: optional integer `1..5`
- `checkInNote`: optional trimmed string `1..500`

Response `200`:

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

### `GET /api/study-plan/adherence`

Returns aggregated adherence metrics for stored study-plan sessions.

Query params (optional):
- `windowStart`: ISO datetime
- `windowEnd`: ISO datetime

Response `200`:

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

### `GET /api/study-plan/export`

Exports a generated study plan as an ICS calendar file for one-tap import into iPhone Calendar.

Query params (all optional, same constraints/defaults as generate endpoint):
- `horizonDays` (`1..14`, default `7`)
- `minSessionMinutes` (`30..180`, default `45`)
- `maxSessionMinutes` (`45..240`, default `120`, must be `>= minSessionMinutes`)

Example:

```http
GET /api/study-plan/export?horizonDays=7&minSessionMinutes=45&maxSessionMinutes=120
```

Response `200`:
- `Content-Type: text/calendar; charset=utf-8`
- `Content-Disposition: attachment; filename="study-plan-YYYY-MM-DD.ics"`

ICS events use stable deterministic `UID` values based on deadline ID, session start time, and duration.

## Content Recommendations

### `GET /api/recommendations/content`

Returns ranked YouTube/X recommendations mapped to upcoming deadlines and lectures.

Query params:
- `horizonDays` (optional, integer `1..14`, default `7`)
- `limit` (optional, integer `1..25`, default `10`)

Example:

```http
GET /api/recommendations/content?horizonDays=7&limit=5
```

Response `200`:

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
      "completed": false,
      "effortHoursRemaining": 8,
      "effortConfidence": "medium"
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
      "priority": "low",
      "effortHoursRemaining": 1,
      "effortConfidence": "high"
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
