# Server Deployment Guide

This guide covers deploying the Companion server to production using Railway.

## Overview

The Companion server is a Node.js application that provides:
- AI chat powered by Google Gemini
- Data sync services (Canvas LMS, TP EduCloud, GitHub courses, YouTube, X/Twitter)
- Push notifications via Web Push
- SQLite database for persistent storage

## Prerequisites

1. **Railway account**: Sign up at [railway.app](https://railway.app)
2. **GitHub repository**: This repo (already configured)
3. **Environment variables**: See [ENV.md](./ENV.md) for all required variables

## Deployment Steps

### 1. Initial Railway Setup

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click "New Project" → "Deploy from GitHub repo"
3. Select `notgnihton/companion` repository
4. Choose the `apps/server` directory as the root path
5. Railway will auto-detect the `Dockerfile` and build

### 2. Configure Environment Variables

In the Railway project dashboard:

1. Go to "Variables" tab
2. Add the required environment variables (see [ENV.md](./ENV.md)):

**Required:**
- `TIMEZONE=America/New_York`
- `USER_NAME=Lucy`
- `GEMINI_API_KEY=your-gemini-api-key`

Legacy `AXIS_*` aliases still work, but canonical names above are preferred.

**For push notifications (generate keys):**
```bash
npx web-push generate-vapid-keys
```
Then set:
- `VAPID_PUBLIC_KEY=...`
- `VAPID_PRIVATE_KEY=...`
- `VAPID_SUBJECT=mailto:companion@example.com`

**Optional integrations:**
- `CANVAS_API_TOKEN=...` (Canvas LMS sync)
- `COURSE_GITHUB_PAT=...` (Course GitHub sync)
- `YOUTUBE_API_KEY=...` (YouTube digest)
- `X_API_KEY`, `X_API_KEY_SECRET`, `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` (X/Twitter digest)

### 3. Trigger Deployment

Railway auto-deploys on push to `main` branch. Or manually trigger via Railway dashboard.

### 4. Get Your Deployment URL

Once deployed, Railway provides a public URL like:
- `https://companion-server-production.up.railway.app`

Copy this URL — you'll need it for the frontend configuration.

### 5. Update Frontend Configuration

1. In GitHub repository settings → Secrets and variables → Actions:
   - Add a new repository secret:
     - Name: `VITE_API_BASE_URL`
     - Value: `https://your-railway-app.up.railway.app` (your Railway deployment URL)

2. The GitHub Pages deployment workflow (`.github/workflows/deploy.yml`) is already configured to use this secret during build.

3. After setting the secret, trigger a new deployment:
   - Push any change to `apps/web/` on the `main` branch, OR
   - Go to Actions → "Deploy to GitHub Pages" → "Run workflow"

4. Verify the frontend now connects to the production API:
   - Open the deployed GitHub Pages site
   - Open browser DevTools → Network tab
   - Navigate the app and check that API calls go to your Railway URL (not `/api/...` relative paths)

### 6. Verify Deployment

Test the health check endpoint:
```bash
curl https://your-railway-app.up.railway.app/api/health
```

Should return:
```json
{"status":"ok"}
```

Test a real endpoint (requires auth):
```bash
curl https://your-railway-app.up.railway.app/api/dashboard
```

## Database Persistence

Railway provides ephemeral storage by default. For SQLite persistence:

1. **Option A: Railway Volumes** (recommended)
   - In Railway dashboard, go to "Settings" → "Volumes"
   - Add a volume mounted at `/app/data`
   - Update server code to use `/app/data/companion.sqlite`

2. **Option B: External PostgreSQL** (future)
   - Railway offers PostgreSQL as a service
   - Migrate from SQLite to PostgreSQL for production-grade persistence

## Monitoring & Logs

- **Logs**: Railway dashboard → "Deployments" tab → click deployment → "Logs"
- **Metrics**: Railway dashboard → "Metrics" tab shows CPU, memory, network usage
- **Health checks**: Railway automatically monitors `/api/health` endpoint

## Troubleshooting

### Build fails
- Check Dockerfile syntax
- Verify `package.json` scripts (`build`, `start`)
- Check logs in Railway dashboard

### Health check fails
- Verify server starts on correct port (Railway sets `PORT` env var)
- Check server logs for startup errors
- Ensure `/api/health` endpoint exists

### API calls fail from frontend
- Verify `VITE_API_BASE_URL` is set correctly
- Check CORS configuration in server (`apps/server/src/index.ts`)
- Verify Railway deployment URL is correct and accessible

### Database not persisting
- Confirm Railway volume is mounted at `/app/data`
- Check server logs for SQLite file path
- Ensure server has write permissions to `/app/data`

## Continuous Deployment

The GitHub Actions workflow (`.github/workflows/deploy-server.yml`) runs on every push to `main`:
1. Runs TypeScript type checks
2. Runs test suite
3. Builds Docker image
4. Tests health check
5. Railway auto-deploys if all checks pass

## Cost Estimate (Railway)

- **Starter Plan**: $5/month + usage
- **Estimated usage**: ~1-2GB RAM, <100 GB bandwidth/month
- **Total**: $5-10/month for personal use

## Alternative Platforms

### Fly.io
- Similar to Railway, uses `fly.toml` instead of `railway.toml`
- More granular control over regions and scaling
- Free tier available

### VPS (DigitalOcean, Linode)
- Full control, requires manual setup (nginx, SSL, process manager)
- $6-12/month for basic droplet
- More work but more flexibility

## Security Notes

- **Never commit** `.env` files with secrets to git
- Use Railway's environment variables feature for secrets
- Rotate API keys periodically
- Monitor Railway logs for suspicious activity
- Enable Railway's automatic SSL (provided by default)
