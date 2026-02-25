# Deployment Guide

Step-by-step instructions for deploying **Who Dies in This Movie?** to Vercel with Inngest for background ingestion.

## Prerequisites

- [Vercel account](https://vercel.com/signup)
- [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`
- A PostgreSQL database (options: [Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres), [Neon](https://neon.tech), [Supabase](https://supabase.com), or any hosted PostgreSQL)
- [TMDB API key](https://www.themoviedb.org/settings/api) (bearer token)
- [Gemini API key](https://aistudio.google.com/apikey) (free tier)
- [Inngest account](https://app.inngest.com) (free tier)

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

1. In the Vercel dashboard, go to **Storage** → **Create Database** → **Postgres**
2. Connect it to your project — Vercel auto-populates `DATABASE_URL`, so no need to set it in Step 3

---

## Step 3: Set environment variables

Set each variable using the Vercel CLI or the Vercel dashboard:

```bash
# Required
vercel env add TMDB_API_KEY
vercel env add NEXT_PUBLIC_TMDB_IMAGE_BASE   # value: https://image.tmdb.org/t/p
vercel env add GEMINI_API_KEY
vercel env add GEMINI_MODEL                  # value: gemini-2.5-flash

# Inngest (required for event-driven ingestion)
vercel env add INNGEST_SIGNING_KEY
vercel env add INNGEST_EVENT_KEY

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

## Step 6: Set up Inngest

Movie ingestion is powered by [Inngest](https://inngest.com) — an event-driven job queue that processes requests immediately when users submit them (no cron delays).

### Create an Inngest app

1. Sign up at [app.inngest.com](https://app.inngest.com) (free)
2. Create a new app called **"Who Dies in This Movie"**
3. Copy the **Signing Key** and **Event Key** from the app dashboard

### Add keys to Vercel

```bash
vercel env add INNGEST_SIGNING_KEY   # paste your signing key
vercel env add INNGEST_EVENT_KEY     # paste your event key
```

Or set them in **Vercel Dashboard → Project Settings → Environment Variables**.

### Register the webhook endpoint

After deploying, register your app's Inngest endpoint in the Inngest dashboard:

1. Go to **Inngest Dashboard → Apps → Sync**
2. Enter your production URL: `https://<your-domain>/api/inngest`
3. Click **Sync** — Inngest will detect the registered function (`process-movie-ingestion`)

### Verify the connection

1. In the Inngest dashboard, go to **Functions** — you should see `process-movie-ingestion` listed
2. Request a movie via the UI
3. Check **Inngest Dashboard → Runs** — you should see the function triggered and executing within seconds

---

## Step 7: Verify the deployment

```bash
# Search for movies
curl "https://whodiesinthismovie.missfunmi.com/api/movies/search?q=star%20wars"

# Browse all movies
curl "https://whodiesinthismovie.missfunmi.com/api/movies/browse?page=1&sort=alphabetical"

# Check notifications
curl "https://whodiesinthismovie.missfunmi.com/api/notifications/poll"
```

---

## How Ingestion Works

When a user requests a movie that isn't in the database:

1. `POST /api/movies/request` queues the job in the `IngestionQueue` table
2. The request handler immediately sends a `movie/ingestion.requested` event to Inngest
3. Inngest triggers the `process-movie-ingestion` function within seconds
4. The function runs the full pipeline: TMDB lookup → death scraping → LLM extraction → DB insert
5. The user is notified via the notification bell (polling-based, 60s interval)

If Inngest is unavailable (e.g., during a deployment), the job remains in the queue with `status: "pending"`. You can process it manually with `npm run worker`.

---

## Local Development

```bash
# Copy env template and fill in values
cp .env.example .env

# Start database migrations
npx prisma migrate dev

# Seed with initial data
npx prisma db seed

# Terminal 1: Start the Next.js app
npm run dev

# Terminal 2: Start the Inngest Dev Server (separate process)
npm run inngest:dev
```

Visit [http://localhost:8288](http://localhost:8288) to view the Inngest Dev Server — it shows all triggered events and function runs in real time. The Dev Server must be running to process movie requests locally.

To manually process a job without Inngest (e.g., for debugging):

```bash
npm run worker
```

---

## Troubleshooting

### Inngest function not triggering

- Verify `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` are set in Vercel env vars
- Ensure the endpoint is synced in the Inngest dashboard (`/api/inngest`)
- Check the Inngest dashboard **Runs** tab for error details
- In local dev, ensure `npm run dev` is running (Inngest Dev Server auto-starts)

### Prisma migration errors on deploy

- Ensure `DATABASE_URL` is correctly set in Vercel environment variables
- If using Vercel Postgres, confirm the database is connected to the project

### Gemini rate limit errors (429)

- The worker retries up to 5 times with exponential backoff (2/4/8/16/32s)
- Free tier limit is 5 RPM — Inngest's immediate processing stays well within this
- If errors persist, check the Inngest run logs for the full retry sequence

### Database connection issues

- The app uses `@prisma/adapter-pg` with standard PostgreSQL connections
- Vercel Postgres automatically handles IP allowlisting; external databases may need it configured
