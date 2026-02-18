# Server Environment Variables

This file documents all environment variables required to run the Companion server in production.

`AXIS_*` environment variable aliases are still accepted for backward compatibility, but canonical names below are preferred.

## Required Variables

### Server Configuration
- `PORT` (default: 8787) — HTTP server port
- `NODE_ENV` (recommended: "production") — Node.js environment
- `DATABASE_URL` (optional, recommended on Railway) — PostgreSQL connection string used for persistent runtime snapshots
- `SQLITE_DB_PATH` (default: `companion.db`) — Local SQLite runtime file path (restored from PostgreSQL snapshot when `DATABASE_URL` is set)

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
- `GEMINI_USE_LIVE_API` (default: `true`) — Use Gemini Live API (WebSocket) for chat + tool calling
- `GEMINI_LIVE_MODEL` (default: `gemini-2.5-flash`) — Vertex model name for chat/tool calling
- `GEMINI_GROWTH_IMAGE_MODEL` (default: `nano-banana-pro`) — Growth visual model alias for daily/long-term summary images
  - Alias mapping: `nano-banana-pro` -> `gemini-3-pro-image-preview`
- `GEMINI_LIVE_ENDPOINT` (optional) — Override Vertex Live WebSocket endpoint
- `GEMINI_VERTEX_PROJECT_ID` (required unless `GEMINI_LIVE_MODEL` is already a full `projects/...` model resource)
  - Alias supported: `GCP_PROJECT_ID`
- `GEMINI_VERTEX_LOCATION` (default: `us-central1`) — Vertex region for endpoint/model path
  - Alias supported: `GCP_LOCATION`
  - For `gemini-3-flash-preview`, use `global`
- `GOOGLE_SERVICE_ACCOUNT_JSON` (optional) — Raw service-account JSON credentials (Railway-friendly alternative to credentials file)
  - Alias supported: `GOOGLE_APPLICATION_CREDENTIALS_JSON`
- `GOOGLE_APPLICATION_CREDENTIALS` (recommended for `vertex`) — Service-account JSON path for Google IAM auth (or use other ADC methods)
- `GEMINI_LIVE_TIMEOUT_MS` (default: `25000`) — Live socket read timeout in milliseconds
- `GROWTH_DAILY_SUMMARY_MIN_REFRESH_MINUTES` (default: `180`) — Minimum interval before regenerating daily summary inference
- `GROWTH_ANALYTICS_MIN_REFRESH_MINUTES` (default: `480`) — Minimum interval before regenerating long-term analytics inference

### Authentication
- `AUTH_REQUIRED` (default: `true` in production, otherwise `false`) — Require login for all `/api/*` routes except health and auth bootstrap endpoints
- `AUTH_ADMIN_EMAIL` (required when auth is enabled) — Admin login email
- `AUTH_ADMIN_PASSWORD` (required when auth is enabled, min 8 chars) — Admin login password
- `AUTH_SESSION_TTL_HOURS` (default: 720) — Session expiration window in hours

### Canvas LMS Integration
- `CANVAS_API_TOKEN` (optional) — Canvas personal access token
- `CANVAS_BASE_URL` (default: "https://stavanger.instructure.com") — Canvas instance URL
- `INTEGRATION_WINDOW_PAST_DAYS` (default: 30) — Keep synced TP/Canvas items this many days in the past
- `INTEGRATION_WINDOW_FUTURE_DAYS` (default: 180) — Keep synced TP/Canvas items this many days in the future
- `NOTIFICATION_DIGEST_MORNING_HOUR` (default: 8) — Hour (0-23) for morning non-urgent notification digest
- `NOTIFICATION_DIGEST_EVENING_HOUR` (default: 18) — Hour (0-23) for evening non-urgent notification digest

### Course GitHub Integration
- `GITHUB_PAT` (optional) — GitHub personal access token for private course repos
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

### Withings Health Integration
- `WITHINGS_API_ENDPOINT` (default: `https://wbsapi.withings.net`) — Withings API base URL
- `WITHINGS_CLIENT_ID` (optional) — Withings OAuth client ID
- `WITHINGS_API_SECRET` (optional) — Withings OAuth client secret
- `WITHINGS_CALLBACK_URL` (default: `http://localhost:8787/api/auth/withings/callback`) — OAuth callback URL registered in Withings developer settings
- `WITHINGS_SCOPE` (default: `user.metrics,user.activity`) — OAuth scopes requested during connect flow
- `WITHINGS_ACCESS_TOKEN` (optional) — Bootstrap access token for non-interactive startup
- `WITHINGS_REFRESH_TOKEN` (optional) — Bootstrap refresh token for non-interactive startup

## Deployment Checklist

1. **Set required variables**: `TIMEZONE`, `USER_NAME`, and Vertex Live auth vars (`GEMINI_VERTEX_PROJECT_ID` + service account auth)
2. **Generate VAPID keys**: `npx web-push generate-vapid-keys`
3. **Set VAPID keys**: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
4. **Configure auth**: Set `AUTH_ADMIN_EMAIL` and `AUTH_ADMIN_PASSWORD` (and optionally `AUTH_REQUIRED=true`)
5. **Optional integrations**: Set Canvas, GitHub, YouTube, X, Gmail, and Withings keys if needed
6. **Set production port**: `PORT=8787` (or Railway's auto-assigned port)
7. **Verify health check**: `curl http://<server-url>/api/health` should return `{"status":"ok"}`

## Example Production .env

```bash
# Server config
PORT=8787
NODE_ENV=production
DATABASE_URL=postgresql://user:pass@host:5432/railway
SQLITE_DB_PATH=companion.db

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

# AI (Vertex Live API)
GEMINI_USE_LIVE_API=true
GEMINI_LIVE_MODEL=gemini-2.5-flash
GEMINI_GROWTH_IMAGE_MODEL=nano-banana-pro
GEMINI_VERTEX_PROJECT_ID=your-gcp-project-id
GEMINI_VERTEX_LOCATION=us-central1
GEMINI_LIVE_TIMEOUT_MS=25000
GROWTH_DAILY_SUMMARY_MIN_REFRESH_MINUTES=180
GROWTH_ANALYTICS_MIN_REFRESH_MINUTES=480

# Auth
AUTH_REQUIRED=true
AUTH_ADMIN_EMAIL=lucy@example.com
AUTH_ADMIN_PASSWORD=choose-a-long-random-password
AUTH_SESSION_TTL_HOURS=720

# Canvas LMS
CANVAS_API_TOKEN=your-canvas-token
CANVAS_BASE_URL=https://stavanger.instructure.com
INTEGRATION_WINDOW_PAST_DAYS=30
INTEGRATION_WINDOW_FUTURE_DAYS=180
NOTIFICATION_DIGEST_MORNING_HOUR=8
NOTIFICATION_DIGEST_EVENING_HOUR=18

# Course GitHub
GITHUB_PAT=your-github-pat

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

# Withings bootstrap (optional)
WITHINGS_API_ENDPOINT=https://wbsapi.withings.net
WITHINGS_CLIENT_ID=your-withings-client-id
WITHINGS_API_SECRET=your-withings-api-secret
WITHINGS_CALLBACK_URL=https://<your-server-domain>/api/auth/withings/callback
WITHINGS_SCOPE=user.metrics,user.activity
WITHINGS_ACCESS_TOKEN=your-withings-access-token
WITHINGS_REFRESH_TOKEN=your-withings-refresh-token
```
