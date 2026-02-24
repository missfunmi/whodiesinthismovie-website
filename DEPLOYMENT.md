# Deployment Guide

Step-by-step instructions for deploying **Who Dies in This Movie?** to Vercel with GitHub Actions for background ingestion.

## Prerequisites

- [Vercel account](https://vercel.com/signup)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A PostgreSQL database (options: [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres), [Neon](https://neon.tech), [Supabase](https://supabase.com), or any hosted PostgreSQL)
- [TMDB API key](https://www.themoviedb.org/settings/api) (bearer token)
- [Gemini API key](https://aistudio.google.com/apikey) (free tier)

---

## Step 1: Install Vercel CLI and link the project

```bash
npm i -g vercel
vercel login
vercel link
```

When prompted, link to an existing project or create a new one.

---

## Step 2: Set up a PostgreSQL database

### Option A: Vercel Postgres (recommended for simplicity)
1. In the Vercel dashboard, go to **Storage** → **Create Database** → **Postgres**
2. Connect it to your project — Vercel auto-populates `DATABASE_URL`

### Option B: External PostgreSQL (Neon, Supabase, Railway, etc.)
1. Create a database and get the connection string
2. Set it as an environment variable (Step 3 below)

---

## Step 3: Set environment variables

Set each variable using the Vercel CLI or the Vercel dashboard:

```bash
# Required
vercel env add DATABASE_URL
vercel env add TMDB_API_KEY
vercel env add NEXT_PUBLIC_TMDB_IMAGE_BASE   # value: https://image.tmdb.org/t/p
vercel env add GEMINI_API_KEY
vercel env add GEMINI_MODEL                  # value: gemini-2.5-flash

# Optional
vercel env add SENTRY_DSN
vercel env add NEXT_PUBLIC_SENTRY_DSN
```

Each command will prompt you to choose environments (Production, Preview, Development). Select **Production** (and Preview if desired).

Alternatively, set variables via the Vercel dashboard: **Project Settings → Environment Variables**.

---

## Step 4: Deploy

```bash
vercel --prod
```

Vercel runs `npm run vercel-build` automatically, which:
1. `prisma generate` — generates the Prisma client
2. `prisma migrate deploy` — applies pending migrations to the production database
3. `next build` — builds the Next.js app

---

## Step 5: Seed the database (one-time setup)

After the first deployment, seed the database with the initial movie data:

```bash
# Point Prisma at your production database
DATABASE_URL="<your-production-database-url>" npx prisma db seed
```

This loads `data/seed-movies.json` and `data/seed-deaths.json` into the production database.

---

## Step 6: Configure GitHub Actions for automated ingestion

Movie ingestion runs every 15 minutes via GitHub Actions (`.github/workflows/process-ingestion-queue.yml`). This workflow processes one pending job from the `IngestionQueue` table per run.

### Add GitHub repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret | Value |
|--------|-------|
| `DATABASE_URL` | Your production database connection string |
| `TMDB_API_KEY` | Your TMDB bearer token |
| `GEMINI_API_KEY` | Your Gemini API key |
| `GEMINI_MODEL` | `gemini-2.5-flash` (or leave unset to use default) |

### Verify the workflow

1. Go to **GitHub → Actions tab**
2. Select **"Process Ingestion Queue"**
3. Click **"Run workflow"** to trigger a manual test run
4. Check the logs to verify it connects to the database and exits cleanly

Expected output when no jobs are pending:
```
[worker] Ingestion worker starting...
[ingestion] No pending jobs in queue
[worker] Done.
```

Expected output when a job is processed:
```
[worker] Ingestion worker starting...
[ingestion] Processing job 1: The Movie Title (2024)
...
[ingestion] Job 1 complete: The Movie Title
[worker] Done.
```

The workflow runs automatically on schedule (every 15 minutes) once the workflow file is on the default branch.

---

## Step 7: Verify the deployment

```bash
# Search for movies
curl "https://whodiesinthismovie.com/api/movies/search?q=star%20wars"

# Browse all movies
curl "https://whodiesinthismovie.com/api/movies/browse?page=1&sort=alphabetical"

# Check notifications
curl "https://whodiesinthismovie.com/api/notifications/poll"
```

---

## How Ingestion Works

When a user requests a movie that isn't in the database:

1. The request is queued in the `IngestionQueue` table via `POST /api/movies/request`
2. GitHub Actions runs the worker every 15 minutes (`npm run worker`)
3. The worker processes ONE job per run:
   - Fetches metadata from TMDB (3 parallel API calls)
   - Scrapes death data from List of Deaths wiki / Wikipedia / The Movie Spoiler
   - Uses Gemini 2.5 Flash to extract and enrich structured death records
   - Inserts movie + deaths into the database atomically
4. The user is notified via the notification bell (polling-based, 60s interval)

The `/api/cron/process-queue` route remains available for manual HTTP testing:

```bash
curl -H "Authorization: Bearer <your-CRON_SECRET>" \
  https://whodiesinthismovie.com/api/cron/process-queue
```

---

## Local Development

```bash
# Copy env template and fill in values
cp .env.example .env

# Start database migrations
npx prisma migrate dev

# Seed with initial data
npx prisma db seed

# Start the app
npm run dev

# (Separate terminal) Process one job from the queue
npm run worker
```

For continuous local polling, re-run the worker periodically:

```bash
# macOS/Linux: re-run every 30 seconds
watch -n 30 npm run worker
```

---

## Troubleshooting

### GitHub Actions workflow not triggering
- Schedules only run on the default branch — ensure the workflow file is merged to `main`/`master`
- GitHub may delay scheduled workflows by up to 15 minutes under load
- Use **"Run workflow"** in the Actions tab to trigger manually

### Worker failing in GitHub Actions
- Check the Actions run logs for the specific error
- Verify all four secrets (`DATABASE_URL`, `TMDB_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`) are set in repository settings
- Ensure the database allows connections from GitHub Actions IP ranges (or use 0.0.0.0/0 for development)

### Prisma migration errors on deploy
- Ensure `DATABASE_URL` is correctly set in Vercel environment variables
- If using Vercel Postgres, confirm the database is connected to the project

### Gemini rate limit errors (429)
- The worker retries up to 5 times with exponential backoff (2/4/8/16/32s)
- Free tier limit is 5 RPM — one job per 15-minute run is well within this
- If errors persist, check the Actions logs for the full retry sequence

### Database connection issues
- The app uses `@prisma/adapter-pg` with standard PostgreSQL connections
- Vercel Postgres automatically handles IP allowlisting; external databases may need it configured
