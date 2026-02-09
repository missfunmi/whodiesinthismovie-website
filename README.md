<a href='https://www.recurse.com/scout/click?t=c7bc9ba4cb3e6725e05e413f16f8c5a3' title='Made with love at the Recurse Center'><img src='https://cloud.githubusercontent.com/assets/2883345/11325206/336ea5f4-9150-11e5-9e90-d86ad31993d8.png' height='20px'/></a>

---

# Who Dies in This Movie?

Look up a movie and find out which characters die — when, how, and by whose hand. Because sometimes knowing is better than wondering 😇

**Live site**: [whodiesinthismovie.com](https://whodiesinthismovie.com) (coming soon)

## Status

- **Phase 1** (Foundation): ✅ Next.js + Prisma + PostgreSQL + seeding + search/detail APIs
- **Phase 2** (Core UI): ✅ Welcome page, search with autocomplete, movie detail page, death reveal system
- **Phase 3** (All Movies Browse): ✅ Paginated grid view of all movies
- **Phases 4-6** (Dynamic Ingestion): 🚧 Request movies, background worker, real-time notifications
- **Future** (Easter Egg): RAG-powered natural language search (planned)

## Tech Stack

- **Next.js 16** (App Router) with TypeScript and React 19
- **Tailwind CSS v4** for styling
- **PostgreSQL 15+** with Prisma ORM v7
- **Ollama + Llama 3.2 3B** for LLM validation and death data extraction
- **Sentry** for error tracking
- **lucide-react** for icons

## Prerequisites

- **Node.js** 20+ (tested with v25)
- **PostgreSQL** 15+ (running locally)
- **Ollama** with Llama 3.2 3B model (for dynamic ingestion)
- **TMDB API key** (bearer token from https://www.themoviedb.org/settings/api)
- **npm** 10+

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/missfunmi/whodiesinthismovie-website.git
cd whodiesinthismovie-website
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up Ollama (for dynamic movie ingestion)

```bash
# Install Ollama (macOS)
brew install ollama

# Pull Llama 3.2 3B model
ollama pull llama3.2:3b

# Verify Ollama is running
curl http://localhost:11434/api/tags
```

### 4. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
# Database
DATABASE_URL="postgresql://your_user:your_password@localhost:5432/whodiesinthismovie"

# TMDB API (get bearer token from https://www.themoviedb.org/settings/api)
TMDB_API_KEY="your_tmdb_bearer_token_here"

# TMDB Image CDN
NEXT_PUBLIC_TMDB_IMAGE_BASE="https://image.tmdb.org/t/p"

# Ollama
OLLAMA_ENDPOINT="http://localhost:11434"

# Sentry (optional)
SENTRY_DSN="your_sentry_dsn_here"
NEXT_PUBLIC_SENTRY_DSN="your_sentry_dsn_here"
```

### 5. Create the database

```bash
createdb whodiesinthismovie
```

### 6. Run migrations and seed

```bash
npx prisma migrate dev    # Creates tables
npx prisma db seed        # Seeds movies and deaths from data/ JSON files
```

### 7. Start the dev server

```bash
npm run dev

# If already running, kill with:
pkill -f "next dev"

# Then rerun `npm run dev`
```

Open [http://localhost:3000](http://localhost:3000).

### 8. Start the ingestion worker (optional, separate terminal)

```bash
npm run worker
```

This enables dynamic movie ingestion when users search for movies not in the database.

### 9. Verify the API

```bash
# Search for movies
curl "http://localhost:3000/api/movies/search?q=star%20wars"

# Get movie details with deaths
curl "http://localhost:3000/api/movies/245891"

# Browse all movies (paginated)
curl "http://localhost:3000/api/movies/browse?page=1&sort=alphabetical"

# Check for new notifications
curl "http://localhost:3000/api/notifications/poll"
```

## Available Scripts

| Script                   | Description                                |
| ------------------------ | ------------------------------------------ |
| `npm run dev`            | Start development server                   |
| `npm run build`          | Create production build                    |
| `npm run start`          | Start production server                    |
| `npm run lint`           | Run ESLint                                 |
| `npm run worker`         | Start ingestion worker (separate terminal) |
| `npx prisma migrate dev` | Run database migrations                    |
| `npx prisma db seed`     | Seed database from JSON files              |
| `npx prisma studio`      | Open Prisma visual database browser        |

## Features

### Core Features
- **Welcome page**: Full-viewport landing with animated movie poster background, 10 rotating taglines, and instant search
- **Search**: Debounced autocomplete (300ms) with poster thumbnails, keyboard navigation (Arrow keys, Enter, Escape), and click-outside dismiss
- **Movie detail page**: Poster + metadata layout, dynamic page titles for SEO
- **Death reveal**: Spoiler-gated death cards with skeleton loading animation. Confirmed and ambiguous deaths shown separately. Zero-death movies show a friendly "Everyone survives!" message
- **Browse all movies**: Paginated grid (100 per page) with poster thumbnails, "NEW!" badges for recently added movies, sort by alphabetical or recently added

### Dynamic Ingestion (Phases 4-6)
- **Request movies**: When searching for a movie not in the database, users can click "Want us to look it up?" to add it to the ingestion queue
- **Background worker**: Polls queue every 30 seconds, fetches movie metadata from TMDB (3 API calls), scrapes character death data, uses LLM to extract structured data, inserts into database
- **Real-time notifications**: Notification bell in top-right corner shows movies added in last 24 hours, badge count for unseen additions, click notification to view movie

### Accessibility & Polish
- `prefers-reduced-motion` support for all animations
- ARIA labels and semantic HTML throughout
- Responsive mobile-first layout
- Keyboard navigation for all interactive elements

## Project Structure

```
whodiesinthismovie-website/
├── app/
│   ├── layout.tsx              # Root layout (fonts, metadata, notification bell)
│   ├── page.tsx                # Welcome page (search + poster background)
│   ├── globals.css             # Tailwind v4 theme + animation keyframes
│   ├── browse/
│   │   └── page.tsx            # All movies browse page (grid + pagination)
│   ├── movie/[tmdbId]/
│   │   └── page.tsx            # Movie detail page (server component)
│   └── api/
│       ├── movies/
│       │   ├── search/route.ts # GET — search movies by title
│       │   ├── [tmdbId]/route.ts # GET — movie + deaths
│       │   ├── browse/route.ts # GET — paginated all movies
│       │   └── request/route.ts # POST — add to ingestion queue
│       └── notifications/
│           └── poll/route.ts   # GET — movies added in last 24h
├── components/
│   ├── search.tsx              # Search orchestrator (debounce + keyboard)
│   ├── search-input.tsx        # Styled search input with auto-focus
│   ├── autocomplete-dropdown.tsx # Search results dropdown
│   ├── poster-background.tsx   # Animated poster crossfade grid
│   ├── rotating-taglines.tsx   # Tagline rotation with 5 animation variants
│   ├── movie-header.tsx        # Sticky header with logo
│   ├── movie-metadata.tsx      # Poster + metadata layout
│   ├── death-reveal.tsx        # Reveal toggle + skeleton + death cards
│   ├── death-card.tsx          # Confirmed death card
│   ├── ambiguous-death-card.tsx # Ambiguous death card
│   ├── skeleton-loader.tsx     # Pulsing skeleton grid
│   ├── notification-bell.tsx   # Top-right notification bell with dropdown
│   └── browse-grid.tsx         # Movie grid with pagination controls
├── lib/
│   ├── prisma.ts               # Prisma client singleton
│   ├── types.ts                # Shared TypeScript types
│   └── utils.ts                # formatRuntime, getPosterUrl helpers
├── scripts/
│   └── ingestion-worker.ts     # Background worker for movie ingestion
├── prisma/
│   ├── schema.prisma           # Database schema (Movie, Death, IngestionQueue)
│   └── seed.ts                 # Seed script (upsert movies, recreate deaths)
├── data/
│   ├── seed-movies.json        # Movie metadata (100+ movies)
│   └── seed-deaths.json        # Character death data per movie
├── docs/
│   ├── PRD.md                  # Product requirements
│   └── SPEC.md                 # Technical specification
├── figma-make-prototype/       # Figma prototype (visual reference only)
├── CLAUDE.md                   # AI assistant project context
└── README.md                   # This file
```

## Database Schema

### Movies
- `tmdbId` (primary key): The Movie Database ID
- `title`, `year`, `director`, `tagline`, `posterPath`, `runtime`, `mpaaRating`
- `createdAt`: Timestamp for "NEW!" badge logic (last 24 hours)

### Deaths
- Linked to movie via `movieTmdbId` foreign key
- Fields: `character`, `timeOfDeath`, `cause`, `killedBy`, `context`, `isAmbiguous`

### IngestionQueue
- Tracks user-requested movies not yet in database
- Fields: `query`, `status` ('pending' | 'processing' | 'complete' | 'failed'), `tmdbId`, `failureReason`, `createdAt`, `completedAt`

## Adding Movies Manually

Movie data lives in `data/` as JSON files. To add a new movie:

1. Add the movie metadata to `data/seed-movies.json`:
   ```json
   {
     "tmdbId": 245891,
     "title": "John Wick",
     "year": 2014,
     "director": "Chad Stahelski",
     "tagline": "Don't set him off.",
     "posterPath": "/fZPSd91yGE9fCcCe6OoQr6E3Bev.jpg",
     "runtime": 101,
     "mpaaRating": "R"
   }
   ```

2. Add the death data to `data/seed-deaths.json`:
   ```json
   {
     "movieTitle": "John Wick",
     "tmdbId": 245891,
     "deaths": [
       {
         "character": "Iosef Tarasov",
         "timeOfDeath": "Act 3, nightclub basement",
         "cause": "Gunshot",
         "killedBy": "John Wick",
         "context": "Final confrontation after stealing John's car and killing his dog",
         "isAmbiguous": false
       }
     ]
   }
   ```

3. Re-run the seed script:
   ```bash
   npx prisma db seed
   ```

The seed script uses upsert, so it's safe to run repeatedly.

## Dynamic Movie Ingestion

Users can request movies not in the database by clicking "Want us to look it up?" when search returns zero results. The ingestion worker:

1. **Validates query** with LLM (rejects obvious fake queries)
2. **Searches TMDB** for movie metadata via 3 parallel API calls:
   - Base movie data (`/movie/{tmdbId}`)
   - Credits for directors (`/movie/{tmdbId}/credits`)
   - Release dates for MPAA rating (`/movie/{tmdbId}/release_dates`)
3. **Scrapes death data** from List of Deaths wiki or The Movie Spoiler
4. **Extracts structured data** using LLM (Ollama + Llama 3.2 3B)
5. **Inserts into database** (movie + deaths)
6. **Notifies user** via notification bell

Worker respects TMDB rate limits (500ms between requests) and handles failures with exponential backoff.

## API Routes

| Endpoint                         | Method | Description                                        |
| -------------------------------- | ------ | -------------------------------------------------- |
| `/api/movies/search?q=`          | GET    | Search movies by title (3+ chars, max 8 results)   |
| `/api/movies/[tmdbId]`           | GET    | Get movie metadata with all deaths                 |
| `/api/movies/browse?page=&sort=` | GET    | Paginated all movies (100 per page, A-Z or recent) |
| `/api/movies/request`            | POST   | Add movie request to ingestion queue               |
| `/api/notifications/poll`        | GET    | Get movies added in last 24 hours                  |

## Environment Variables

| Variable                      | Required | Description                               |
| ----------------------------- | -------- | ----------------------------------------- |
| `DATABASE_URL`                | Yes      | PostgreSQL connection string              |
| `TMDB_API_KEY`                | Yes      | TMDB bearer token for API access          |
| `NEXT_PUBLIC_TMDB_IMAGE_BASE` | Yes      | TMDB image CDN base URL                   |
| `OLLAMA_ENDPOINT`             | Yes*     | Ollama endpoint (required for ingestion)  |
| `SENTRY_DSN`                  | No       | Sentry DSN for error tracking             |
| `NEXT_PUBLIC_SENTRY_DSN`      | No       | Sentry DSN for client-side error tracking |

*Required for Phases 4-6 (dynamic ingestion). Not needed for basic functionality.

## Troubleshooting

### Ollama not responding
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve

# Pull model if missing
ollama pull llama3.2:3b
```

### Worker not processing jobs
```bash
# Check ingestion queue status
npx prisma studio
# Navigate to IngestionQueue table, check status column

# Check worker logs
npm run worker
# Look for errors in console output
```

### TMDB API rate limit
The worker waits 500ms between requests (max 200 movies/hour). If you hit rate limits:
- Check TMDB API status: https://status.themoviedb.org
- Verify your API key is valid
- Increase delay in `scripts/ingestion-worker.ts` if needed

## License

MIT
