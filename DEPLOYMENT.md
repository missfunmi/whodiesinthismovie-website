# Vercel Deployment Guide

Step-by-step instructions for deploying **Who Dies in This Movie?** to Vercel.

## Prerequisites

- [Vercel account](https://vercel.com/signup) (Pro plan required — see note below)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A PostgreSQL database (options: [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres), [Neon](https://neon.tech), [Supabase](https://supabase.com), or any hosted PostgreSQL)
- [TMDB API key](https://www.themoviedb.org/settings/api) (bearer token)
- [Gemini API key](https://aistudio.google.com/apikey) (free tier)

> **Note on Vercel plan**: The ingestion pipeline (TMDB fetch + web scraping + Gemini LLM) typically takes 30-60 seconds per movie. Vercel's Hobby plan has a 10-second function timeout, which is insufficient. **A Pro plan (or higher) is required** for the cron job to work reliably.

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

Generate a secure cron secret first:

```bash
openssl rand -base64 32
```

Then set each variable using the Vercel CLI or the Vercel dashboard:

```bash
# Required
vercel env add DATABASE_URL
vercel env add TMDB_API_KEY
vercel env add NEXT_PUBLIC_TMDB_IMAGE_BASE   # value: https://image.tmdb.org/t/p
vercel env add GEMINI_API_KEY
vercel env add GEMINI_MODEL                  # value: gemini-2.5-flash
vercel env add CRON_SECRET                   # paste the value from openssl above

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

## Step 6: Verify the Cron job

1. In the Vercel dashboard, go to **Project → Functions → Cron Jobs**
2. Confirm `/api/cron/process-queue` is listed with schedule `*/15 * * * *` (every 15 minutes)

To test the cron manually:

```bash
curl -H "Authorization: Bearer <your-CRON_SECRET>" \
  https://whodiesinthismovie.com/api/cron/process-queue
```

Expected response when no jobs are pending:
```json
{"success": true, "processed": false, "reason": "no_jobs"}
```

Expected response when a job is processed:
```json
{"success": true, "processed": true, "jobId": 1, "title": "The Movie Title"}
```

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

## How the Cron Job Works

The Vercel Cron function (`/api/cron/process-queue`) runs every 15 minutes:

1. Vercel sends a `GET` request with `Authorization: Bearer <CRON_SECRET>`
2. The route picks one pending job from the `IngestionQueue` table
3. Fetches metadata from TMDB (3 parallel API calls)
4. Scrapes death data from List of Deaths wiki / Wikipedia / The Movie Spoiler
5. Uses Gemini 2.5 Flash to extract and enrich structured death records
6. Inserts movie + deaths into the database atomically
7. Returns `{ success: true, processed: true, jobId: N, title: "..." }`

If there are no pending jobs, returns `{ success: true, processed: false, reason: "no_jobs" }`.

---

## Local Development

For local development, use the polling worker instead of the cron route:

```bash
# Copy env template and fill in values
cp .env.example .env

# Start database migrations
npx prisma migrate dev

# Seed with initial data
npx prisma db seed

# Start the app
npm run dev

# (Optional, separate terminal) Start the local ingestion worker
npm run worker
```

The local worker polls the queue every 30 seconds (vs. every 15 minutes for the cron job).

---

## Troubleshooting

### Cron job returning 401
- Verify `CRON_SECRET` is set correctly in Vercel environment variables
- Verify the Authorization header in your test curl matches exactly

### Cron job timing out
- Vercel Hobby plan has a 10-second limit — upgrade to Pro for the 60-second limit
- The ingestion pipeline typically takes 30-60 seconds per movie

### Prisma migration errors on deploy
- Ensure `DATABASE_URL` is correctly set in Vercel environment variables
- If using Vercel Postgres, confirm the database is connected to the project

### Gemini rate limit errors (429)
- The cron runs every 15 minutes, so at most 1 Gemini call per invocation
- This is well within the free tier limit of 5 requests per minute
- If you see 429 errors, check if multiple cron invocations overlapped

### Database connection issues on Vercel
- The app uses `@prisma/adapter-pg` with standard PostgreSQL connections
- Ensure your database allows connections from Vercel's IP ranges (or use 0.0.0.0/0 for development)
- Vercel Postgres automatically handles this; external databases may need allowlisting
