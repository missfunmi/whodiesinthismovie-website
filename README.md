# Who Dies in This Movie?

Look up a movie and find out which characters die — when, how, and by whose hand. Because sometimes knowing is better than wondering.

**Live site**: [whodiesinthismovie.com](https://whodiesinthismovie.com) (coming soon)

## Status

- **Phase 1** (Foundation): Next.js + Prisma + PostgreSQL + seeding + search/detail APIs
- **Phase 2** (Core UI): Welcome page, search with autocomplete, movie detail page, death reveal system
- **Phase 3** (Easter Egg): RAG-powered natural language search (planned)

## Tech Stack

- **Next.js 16** (App Router) with TypeScript and React 19
- **Tailwind CSS v4** for styling
- **PostgreSQL 15+** with Prisma ORM v7
- **Sentry** for error tracking
- **lucide-react** for icons

## Prerequisites

- **Node.js** 20+ (tested with v25)
- **PostgreSQL** 15+ (running locally)
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

### 3. Set up environment variables

```bash
cp .env.example .env
```

Edit `.env` with your PostgreSQL credentials:

```env
DATABASE_URL="postgresql://your_user:your_password@localhost:5432/whodiesinthismovie"
```

### 4. Create the database

```bash
createdb whodiesinthismovie
```

### 5. Run migrations and seed

```bash
npx prisma migrate dev    # Creates tables
npx prisma db seed        # Seeds movies and deaths from data/ JSON files
```

### 6. Start the dev server

```bash
npm run dev

# If already running, kill with:
pkill -f "next dev"

# Then rerun `npm run dev`
```

Open [http://localhost:3000](http://localhost:3000).

### 7. Verify the API

```bash
# Search for movies
curl "http://localhost:3000/api/movies/search?q=star%20wars"

# Get movie details with deaths
curl "http://localhost:3000/api/movies/245891"
```

## Available Scripts

| Script                   | Description                         |
| ------------------------ | ----------------------------------- |
| `npm run dev`            | Start development server            |
| `npm run build`          | Create production build             |
| `npm run start`          | Start production server             |
| `npm run lint`           | Run ESLint                          |
| `npx prisma migrate dev` | Run database migrations             |
| `npx prisma db seed`     | Seed database from JSON files       |
| `npx prisma studio`      | Open Prisma visual database browser |

## Features

- **Welcome page**: Full-viewport landing with animated movie poster background, rotating taglines, and instant search
- **Search**: Debounced autocomplete (300ms) with poster thumbnails, keyboard navigation (Arrow keys, Enter, Escape), and click-outside dismiss
- **Movie detail page**: Poster + metadata layout, dynamic page titles for SEO
- **Death reveal**: Spoiler-gated death cards with skeleton loading animation. Confirmed and ambiguous deaths shown separately. Zero-death movies show a friendly "Everyone survives!" message
- **Accessibility**: `prefers-reduced-motion` support, ARIA labels, semantic HTML
- **Responsive**: Mobile-first layout — poster stacks above metadata, death grid collapses to single column

## Project Structure

```
whodiesinthismovie-website/
├── app/
│   ├── layout.tsx              # Root layout (fonts, metadata)
│   ├── page.tsx                # Welcome page (search + poster background)
│   ├── globals.css             # Tailwind v4 theme + animation keyframes
│   ├── movie/[tmdbId]/
│   │   └── page.tsx            # Movie detail page (server component)
│   └── api/
│       ├── movies/
│       │   ├── search/route.ts # GET — search movies by title
│       │   └── [tmdbId]/route.ts # GET — movie + deaths
│       └── smart-search/route.ts # POST — RAG easter egg (Phase 3)
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
│   └── skeleton-loader.tsx     # Pulsing skeleton grid
├── lib/
│   ├── prisma.ts               # Prisma client singleton
│   ├── types.ts                # Shared TypeScript types
│   └── utils.ts                # formatRuntime, getPosterUrl helpers
├── prisma/
│   ├── schema.prisma           # Database schema (Movie → Death)
│   └── seed.ts                 # Seed script (upsert movies, recreate deaths)
├── data/
│   ├── seed-movies.json        # Movie metadata (117 movies)
│   └── seed-deaths.json        # Character death data per movie
├── docs/
│   ├── PRD.md                  # Product requirements
│   └── SPEC.md                 # Technical specification
├── figma-make-prototype/       # Figma prototype (visual reference only)
├── CLAUDE.md                   # AI assistant project context
└── README.md                   # This file
```

## Seed Data

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

## API Routes

| Endpoint                | Method | Description                                             |
| ----------------------- | ------ | ------------------------------------------------------- |
| `/api/movies/search?q=` | GET    | Search movies by title (3+ chars, max 8 results)        |
| `/api/movies/[tmdbId]`  | GET    | Get movie metadata with all deaths                      |
| `/api/smart-search`     | POST   | Forward natural language query to RAG service (Phase 3) |

## Environment Variables

| Variable                      | Required | Description                      |
| ----------------------------- | -------- | -------------------------------- |
| `DATABASE_URL`                | Yes      | PostgreSQL connection string     |
| `NEXT_PUBLIC_TMDB_IMAGE_BASE` | Yes      | TMDB image CDN base URL          |
| `RAG_SERVICE_URL`             | No       | Python RAG service URL (Phase 3) |
| `SENTRY_DSN`                  | No       | Sentry DSN for error tracking    |
