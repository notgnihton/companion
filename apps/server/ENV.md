# Server Environment Variables

This file documents all environment variables required to run the Companion server in production.

`AXIS_*` environment variable aliases are still accepted for backward compatibility, but canonical names below are preferred.

## Required Variables

### Server Configuration
- `PORT` (default: 8787) — HTTP server port
- `NODE_ENV` (recommended: "production") — Node.js environment

### User Configuration
- `TIMEZONE` (required) — User's timezone (e.g., "America/New_York")
- `USER_NAME` (required) — User's name for personalized responses

### Feature Flags / Providers
- `NOTES_PROVIDER` (default: "local") — Journal provider
- `ASSIGNMENT_PROVIDER` (default: "manual") — Assignment provider
- `FOOD_PROVIDER` (default: "manual") — Food tracking provider
- `SOCIAL_PROVIDER` (default: "manual") — Social media provider
- `VIDEO_PROVIDER` (default: "manual") — Video provider

### Push Notifications (Web Push)
- `VAPID_PUBLIC_KEY` (required for push) — VAPID public key
- `VAPID_PRIVATE_KEY` (required for push) — VAPID private key
- `VAPID_SUBJECT` (required for push) — VAPID subject (e.g., "mailto:companion@example.com")

> Generate VAPID keys: `npx web-push generate-vapid-keys`

### AI / LLM
- `GEMINI_API_KEY` (required for chat) — Google Gemini API key
  - Get key: https://ai.google.dev/
  - Free tier: 15 RPM, 1M tokens/day

### Canvas LMS Integration
- `CANVAS_API_TOKEN` (optional) — Canvas personal access token
- `CANVAS_BASE_URL` (default: "https://stavanger.instructure.com") — Canvas instance URL
- `INTEGRATION_WINDOW_PAST_DAYS` (default: 30) — Keep synced TP/Canvas items this many days in the past
- `INTEGRATION_WINDOW_FUTURE_DAYS` (default: 180) — Keep synced TP/Canvas items this many days in the future
- `NOTIFICATION_DIGEST_MORNING_HOUR` (default: 8) — Hour (0-23) for morning non-urgent notification digest
- `NOTIFICATION_DIGEST_EVENING_HOUR` (default: 18) — Hour (0-23) for evening non-urgent notification digest

### Course GitHub Integration
- `GITHUB_PAT` (optional, recommended) — GitHub personal access token for private course repos
- `COURSE_GITHUB_PAT` (optional, legacy alias) — Backward-compatible alias for `GITHUB_PAT`
  - Required scopes: `repo` (for private repos)

### Social Media Integrations

#### YouTube Data API v3
- `YOUTUBE_API_KEY` (optional) — YouTube Data API key
  - Get key: https://console.cloud.google.com/apis/credentials
  - Quota: 10,000 units/day
- `YOUTUBE_CHANNEL_IDS` (optional) — Comma-separated channel IDs to track directly (recommended when OAuth subscriptions are unavailable)
- `YOUTUBE_FALLBACK_QUERIES` (optional) — Comma-separated keyword queries used when subscriptions cannot be fetched
  - Example: `YOUTUBE_FALLBACK_QUERIES=DAT560 machine learning,DAT520 software engineering`
  - Note: API key-only mode cannot reliably use `mine=true` subscriptions; fallback channel IDs/queries are used instead.

#### X (Twitter) API v2
- `X_API_KEY` (optional) — X API consumer key
- `X_API_KEY_SECRET` (optional) — X API consumer secret
- `X_ACCESS_TOKEN` (optional) — X user access token
- `X_ACCESS_TOKEN_SECRET` (optional) — X user access token secret
- `X_BEARER_TOKEN` (optional) — X app-only bearer token (alternative to OAuth)
- `X_FALLBACK_QUERY` (optional) — Search query used in bearer-token-only mode when home timeline endpoint is unavailable

#### Gmail API (future)
- `GMAIL_CLIENT_ID` (optional) — Gmail OAuth client ID
- `GMAIL_CLIENT_SECRET` (optional) — Gmail OAuth client secret
- `GMAIL_ACCESS_TOKEN` (optional) — Bootstrap Gmail access token for non-interactive production startup
- `GMAIL_REFRESH_TOKEN` (optional) — Bootstrap Gmail refresh token for non-interactive production startup

## Deployment Checklist

1. **Set required variables**: `TIMEZONE`, `USER_NAME`, `GEMINI_API_KEY`
2. **Generate VAPID keys**: `npx web-push generate-vapid-keys`
3. **Set VAPID keys**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
4. **Optional integrations**: Set Canvas, GitHub, YouTube, X keys if needed
5. **Set production port**: `PORT=8787` (or Railway's auto-assigned port)
6. **Verify health check**: `curl http://<server-url>/api/health` should return `{"status":"ok"}`

## Example Production .env

```bash
# Server config
PORT=8787
NODE_ENV=production

# User config
TIMEZONE=America/New_York
USER_NAME=Lucy

# Providers
NOTES_PROVIDER=local
ASSIGNMENT_PROVIDER=manual
FOOD_PROVIDER=manual
SOCIAL_PROVIDER=manual
VIDEO_PROVIDER=manual

# VAPID (Web Push)
VAPID_PUBLIC_KEY=your-vapid-public-key
VAPID_PRIVATE_KEY=your-vapid-private-key
VAPID_SUBJECT=mailto:companion@example.com

# AI
GEMINI_API_KEY=your-gemini-api-key

# Canvas LMS
CANVAS_API_TOKEN=your-canvas-token
CANVAS_BASE_URL=https://stavanger.instructure.com
INTEGRATION_WINDOW_PAST_DAYS=30
INTEGRATION_WINDOW_FUTURE_DAYS=180
NOTIFICATION_DIGEST_MORNING_HOUR=8
NOTIFICATION_DIGEST_EVENING_HOUR=18

# Course GitHub
GITHUB_PAT=your-github-pat
# COURSE_GITHUB_PAT=your-github-pat  # legacy alias

# YouTube
YOUTUBE_API_KEY=your-youtube-key
YOUTUBE_CHANNEL_IDS=UCxxxxxxxx,UCyyyyyyyy
YOUTUBE_FALLBACK_QUERIES=DAT560 machine learning,DAT520 software engineering

# X (Twitter)
X_API_KEY=your-x-api-key
X_API_KEY_SECRET=your-x-api-secret
X_ACCESS_TOKEN=your-x-access-token
X_ACCESS_TOKEN_SECRET=your-x-access-token-secret
X_BEARER_TOKEN=your-x-bearer-token
X_FALLBACK_QUERY=(machine learning OR distributed systems OR software engineering) -is:retweet lang:en

# Gmail bootstrap (optional)
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret
GMAIL_ACCESS_TOKEN=your-gmail-access-token
GMAIL_REFRESH_TOKEN=your-gmail-refresh-token
```
