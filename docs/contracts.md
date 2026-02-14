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
