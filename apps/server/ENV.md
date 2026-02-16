# Server Environment Variables

This file documents all environment variables required to run the Companion server in production.

## Required Variables

### Server Configuration
- `PORT` (default: 8787) — HTTP server port
- `NODE_ENV` (recommended: "production") — Node.js environment

### User Configuration
- `AXIS_TIMEZONE` (required) — User's timezone (e.g., "America/New_York")
- `AXIS_USER_NAME` (required) — User's name for personalized responses

### Feature Flags / Providers
- `AXIS_NOTES_PROVIDER` (default: "local") — Journal provider
- `AXIS_ASSIGNMENT_PROVIDER` (default: "manual") — Assignment provider
- `AXIS_FOOD_PROVIDER` (default: "manual") — Food tracking provider
- `AXIS_SOCIAL_PROVIDER` (default: "manual") — Social media provider
- `AXIS_VIDEO_PROVIDER` (default: "manual") — Video provider

### Push Notifications (Web Push)
- `AXIS_VAPID_PUBLIC_KEY` (required for push) — VAPID public key
- `AXIS_VAPID_PRIVATE_KEY` (required for push) — VAPID private key
- `AXIS_VAPID_SUBJECT` (required for push) — VAPID subject (e.g., "mailto:companion@example.com")

> Generate VAPID keys: `npx web-push generate-vapid-keys`

### AI / LLM
- `GEMINI_API_KEY` (required for chat) — Google Gemini API key
  - Get key: https://ai.google.dev/
  - Free tier: 15 RPM, 1M tokens/day

### Canvas LMS Integration
- `CANVAS_API_TOKEN` (optional) — Canvas personal access token
- `CANVAS_BASE_URL` (default: "https://stavanger.instructure.com") — Canvas instance URL

### Course GitHub Integration
- `COURSE_GITHUB_PAT` (optional) — GitHub personal access token for private course repos
  - Required scopes: `repo` (for private repos)

### Social Media Integrations

#### YouTube Data API v3
- `YOUTUBE_API_KEY` (optional) — YouTube Data API key
  - Get key: https://console.cloud.google.com/apis/credentials
  - Quota: 10,000 units/day

#### X (Twitter) API v2
- `X_API_KEY` (optional) — X API consumer key
- `X_API_KEY_SECRET` (optional) — X API consumer secret
- `X_ACCESS_TOKEN` (optional) — X user access token
- `X_ACCESS_TOKEN_SECRET` (optional) — X user access token secret
- `X_BEARER_TOKEN` (optional) — X app-only bearer token (alternative to OAuth)

#### Gmail API (future)
- `GMAIL_CLIENT_ID` (optional) — Gmail OAuth client ID
- `GMAIL_CLIENT_SECRET` (optional) — Gmail OAuth client secret

## Deployment Checklist

1. **Set required variables**: `AXIS_TIMEZONE`, `AXIS_USER_NAME`, `GEMINI_API_KEY`
2. **Generate VAPID keys**: `npx web-push generate-vapid-keys`
3. **Set VAPID keys**: `AXIS_VAPID_PUBLIC_KEY`, `AXIS_VAPID_PRIVATE_KEY`, `AXIS_VAPID_SUBJECT`
4. **Optional integrations**: Set Canvas, GitHub, YouTube, X keys if needed
5. **Set production port**: `PORT=8787` (or Railway's auto-assigned port)
6. **Verify health check**: `curl http://<server-url>/api/health` should return `{"status":"ok"}`

## Example Production .env

```bash
# Server config
PORT=8787
NODE_ENV=production

# User config
AXIS_TIMEZONE=America/New_York
AXIS_USER_NAME=Lucy

# Providers
AXIS_NOTES_PROVIDER=local
AXIS_ASSIGNMENT_PROVIDER=manual
AXIS_FOOD_PROVIDER=manual
AXIS_SOCIAL_PROVIDER=manual
AXIS_VIDEO_PROVIDER=manual

# VAPID (Web Push)
AXIS_VAPID_PUBLIC_KEY=your-vapid-public-key
AXIS_VAPID_PRIVATE_KEY=your-vapid-private-key
AXIS_VAPID_SUBJECT=mailto:companion@example.com

# AI
GEMINI_API_KEY=your-gemini-api-key

# Canvas LMS
CANVAS_API_TOKEN=your-canvas-token
CANVAS_BASE_URL=https://stavanger.instructure.com

# Course GitHub
COURSE_GITHUB_PAT=your-github-pat

# YouTube
YOUTUBE_API_KEY=your-youtube-key

# X (Twitter)
X_API_KEY=your-x-api-key
X_API_KEY_SECRET=your-x-api-secret
X_ACCESS_TOKEN=your-x-access-token
X_ACCESS_TOKEN_SECRET=your-x-access-token-secret
X_BEARER_TOKEN=your-x-bearer-token
```
