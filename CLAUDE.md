# CLAUDE.md — Project Context

## Project

**Who Dies in This Movie?** — A website where users look up movies to see which characters die, when, how, and by whose hand.

- Domain: `whodiesinthismovie.com`
- Status: MVP (greenfield build)

## Tech Stack

- **Framework**: Next.js 16 (App Router), TypeScript, React 19
- **Styling**: Tailwind CSS v4 (utility-first, no CSS modules)
- **Database**: PostgreSQL 15+ via Prisma ORM v7
- **Images**: next/image with TMDB CDN (`image.tmdb.org`)
- **LLM**: Ollama + Llama 3.2 3B (query validation & death extraction in ingestion worker)
- **Queue**: Database-based polling queue (no Redis/BullMQ)
- **Notifications**: Polling-based (60s interval) with localStorage persistence
- **Logging**: Sentry
- **Hosting**: Vercel

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run worker       # Start ingestion worker (separate terminal)
npx prisma migrate dev   # Run database migrations
npx prisma db seed       # Seed database from data/ JSON files
npx prisma studio        # Visual database browser
```

## Project Structure

```
├── app/
│   ├── layout.tsx              # Root layout (fonts, metadata, notification bell)
│   ├── page.tsx                # Welcome page (search + poster background)
│   ├── browse/
│   │   └── page.tsx            # All movies browse page (grid + pagination)
│   ├── movie/
│   │   └── [tmdbId]/
│   │       └── page.tsx        # Movie detail page
│   └── api/
│       ├── movies/
│       │   ├── search/route.ts # GET - search movies by title
│       │   ├── [tmdbId]/route.ts # GET - movie + deaths
│       │   ├── browse/route.ts # GET - paginated all movies
│       │   └── request/route.ts # POST - add movie to ingestion queue
│       └── notifications/
│           └── poll/route.ts   # GET - movies added in last 24h
├── components/
│   ├── search.tsx              # Search orchestrator (client, debounced fetch + keyboard nav)
│   ├── search-input.tsx        # Styled search input with auto-focus
│   ├── autocomplete-dropdown.tsx # Search results dropdown with keyboard nav
│   ├── poster-background.tsx   # Animated poster crossfade grid (client)
│   ├── rotating-taglines.tsx   # Tagline rotation with animation variants (client)
│   ├── movie-header.tsx        # Sticky header with logo (server)
│   ├── movie-metadata.tsx      # Poster + metadata layout (server)
│   ├── death-reveal.tsx        # Reveal toggle + skeleton + death cards (client)
│   ├── death-card.tsx          # Confirmed death card (presentational)
│   ├── ambiguous-death-card.tsx # Ambiguous death card (presentational)
│   ├── skeleton-loader.tsx     # Pulsing skeleton grid (presentational)
│   ├── notification-bell.tsx   # Top-right notification bell with dropdown (client)
│   └── browse-grid.tsx         # Movie grid with pagination (client)
├── lib/
│   ├── prisma.ts               # Prisma client singleton
│   ├── types.ts                # Shared TypeScript types (decoupled from Prisma)
│   └── utils.ts                # formatRuntime, getPosterUrl helpers
├── scripts/
│   └── ingestion-worker.ts     # Background worker for movie ingestion
├── prisma/
│   ├── schema.prisma           # Database schema
│   └── seed.ts                 # Seed script
├── data/
│   ├── seed-movies.json        # Movie metadata (TMDB format)
│   └── seed-deaths.json        # Character deaths per movie
├── docs/
│   ├── PRD.md                  # Product requirements
│   └── SPEC.md                 # Technical specification
└── figma-make-prototype/       # Visual reference only — do NOT copy code
```

## Conventions

- **App Router**: Use server components by default. Add `"use client"` only for interactivity (search input, death reveal toggle, animations, notification bell).
- **Styling**: Tailwind only. No CSS modules, no styled-components. Design tokens defined in `tailwind.config.ts` and `globals.css`.
- **Naming**: PascalCase for components, camelCase for functions/variables, kebab-case for files.
- **Components**: One component per file in `components/`. Co-locate component-specific types in the same file.
- **API routes**: Use Next.js Route Handlers (`route.ts`). Return `NextResponse.json()`. Validate inputs at the handler level.
- **Database**: Access via shared Prisma client singleton in `lib/prisma.ts`. Never import `@prisma/client` directly in components.

## Database

- **ORM**: Prisma v7 with PostgreSQL via `@prisma/adapter-pg`
- **Models**: 
  - `Movie` (1) → (many) `Death`, linked via `movieTmdbId` foreign key
  - `IngestionQueue` for background movie ingestion tracking
- **Seed data**: JSON files in `data/`. The seed script upserts by `tmdbId`, so it's safe to re-run after adding movies.
- **Migrations**: Run `npx prisma migrate dev` after schema changes.
- **Config**: Prisma v7 uses `prisma.config.ts` for CLI config (seed command, datasource URL). The seed command is `npx tsx prisma/seed.ts`.

## Design System

Full design system documented in `docs/SPEC.md` Section 2. Key points:

- **Fonts**: Space Grotesk (headings), Inter (body) — loaded via Google Fonts in layout
- **Colors**: Primary `#2c2b32`, death cards `#1F1F1F`, notification badge `red-500`, "NEW!" badge `green-500`
- **Background**: Movie posters with 60% black overlay + heavy blur
- **Reference**: `figma-make-prototype/` is visual reference only. Rebuild all components from scratch using Next.js best practices.

## API Routes

| Endpoint                         | Method | Request                        | Response                                       |
| -------------------------------- | ------ | ------------------------------ | ---------------------------------------------- |
| `/api/movies/search?q=`          | GET    | `q`: search string (3+ chars)  | `Movie[]` (max 8) or `{ tooMany: true }`       |
| `/api/movies/[tmdbId]`           | GET    | —                              | `Movie` with `deaths: Death[]`                 |
| `/api/movies/browse?page=&sort=` | GET    | `page`: number, `sort`: string | `{ movies: Movie[], totalPages, currentPage }` |
| `/api/movies/request`            | POST   | `{ query: string }`            | `{ success: boolean, message: string }`        |
| `/api/notifications/poll`        | GET    | —                              | `Movie[]` (added in last 24h)                  |

## Architectural Decisions (Phase 1)

### Prisma v7 + Driver Adapter
- SPEC.md references `prisma-client-js` (Prisma v5/v6), but we're on Prisma v7 which defaults to the `prisma-client` generator with Wasm-based query engine.
- Prisma v7's `prisma-client` generator requires a driver adapter for direct PostgreSQL connections. We use `@prisma/adapter-pg` with the `pg` driver.
- The generated client lives at `app/generated/prisma/` (Prisma v7 default). Import from `@/app/generated/prisma/client` in app code, and from relative path `../app/generated/prisma/client.js` in the seed script.
- `PrismaClient` must be constructed with `{ adapter }` — passing `datasourceUrl` directly is not supported in v7.
- CLI config (datasource URL, seed command) lives in `prisma.config.ts`, not in `package.json`.

### Tailwind CSS v4
- Uses `@theme` directive in `globals.css` instead of `tailwind.config.ts` for design tokens (Tailwind v4 approach).
- PostCSS plugin is `@tailwindcss/postcss` (not the legacy `tailwindcss` plugin).

### SPEC Deviations
- `posterPath` in the Prisma schema is `String?` (nullable) instead of `String`, because some movies in the seed data have `null` posterPath.
- Search results are ordered by `year: "desc"` to show newer movies first (not specified in SPEC but better UX).

## Architectural Decisions (Phase 2)

### Component Architecture
- **Server components by default**: `movie-header.tsx`, `movie-metadata.tsx`, and `app/movie/[tmdbId]/page.tsx` are server components (no `"use client"`). Client boundary is pushed as far down as possible.
- **Shared types in `lib/types.ts`**: `DeathInfo`, `MovieSearchResult`, etc. are plain TypeScript types decoupled from Prisma, so they can be imported safely in client components.
- **Presentational components**: `death-card.tsx`, `ambiguous-death-card.tsx`, and `skeleton-loader.tsx` are stateless — they receive props and render. No hooks, no state.

### Search Component — Derived State Pattern
- The `react-hooks/set-state-in-effect` ESLint rule prohibits calling `setState` synchronously in `useEffect` bodies (causes cascading renders).
- Easter egg detection (`!!` prefix) uses `useMemo` for derived state instead of `useState` + `useEffect`.
- Clearing results when a query becomes non-searchable is handled in the `handleQueryChange` callback (event handler), not in the effect. The effect only runs the debounced async fetch.
- `shouldSearch()` is a pure helper function extracted outside the component for testability.

### Poster Background — Hydration Safety
- Initial 8 posters are chosen deterministically (`posterPaths.slice(0, 8)`) to avoid hydration mismatch between server and client renders. Randomization only occurs after mount via `setInterval`.
- Poster slots use `key={`slot-${index}`}` (stable keys) since the array index is a fixed slot position, not a list identity.

### Animation Keyframes
- All 10 tagline animation keyframes are defined in `app/globals.css` as standard CSS `@keyframes` (not Tailwind utilities), since Tailwind v4 doesn't support arbitrary keyframe definitions via utility classes.
- `prefers-reduced-motion` media query disables all custom animations globally.

### Death Reveal — Zero Deaths Handling
- Movies absent from `seed-deaths.json` have zero `Death` rows in the database (the seed script only creates deaths for movies present in the file).
- The `DeathReveal` component checks `confirmedDeaths.length === 0 && ambiguousDeaths.length === 0` and renders a "No deaths! Everyone survives!" message directly — no reveal button is shown.

## Architectural Decisions (Phase 3-6)

### All Movies Browse Page (Phase 3) *(Complete)*
- **Server component** (`app/browse/page.tsx`) fetches initial paginated movies (100 per page) via Prisma, then passes to `BrowseGrid` client component
- **Added `@@index([createdAt])` to Movie model** — required for efficient "Recently Added" sorting (SPEC Section 6 defines it but it was missing from the schema)
- **`BrowseMovie` type** extends `MovieSearchResult` with `createdAt: string` — serialized from Date on server, used client-side for "NEW!" badge check
- **Client-side pagination/sort:** `BrowseGrid` manages state locally and fetches from `/api/movies/browse` API on page/sort changes, updating URL via `router.push()` with `{ scroll: false }`
- **Page clamping:** Both API and server component clamp out-of-range pages to the last valid page (e.g., page=999 with 2 pages returns page 2)
- **"NEW!" badge:** Client-side comparison `Date.now() - new Date(createdAt).getTime() < 24h` — gated behind `mounted` state flag to prevent SSR/hydration mismatch (server renders no badge, client adds badges post-mount)
- **Sort validation:** Browse API returns 400 for invalid `sort` params (strict validation, not silent fallback) — surfaces frontend bugs early
- **Sort dropdown options:** "Alphabetical" (default, `ORDER BY title ASC`) and "Recently Added" (`ORDER BY createdAt DESC`). Changing sort resets to page 1
- **Loading state:** Grid dims to 50% opacity with `pointer-events-none` during fetches
- **Empty state:** Shows Film icon + "No movies found" when database has zero movies
- **"Browse All Movies" link** added to home page below search bar as a subtle white/60 text link

### Movie Request System (Phase 4) *(Complete)*
- **IngestionQueue model pulled forward from Phase 5** — Phase 4 API route needs to insert into the queue, so the model was added in Phase 4 (SPEC Phase 5 task 5.1 marked done)
- **LLM validation is best-effort** — Ollama call uses a 5-second timeout with AbortController. If Ollama is unavailable, timeout, or errors, validation is skipped and the request still succeeds. Per SPEC: "don't expose validation to user"
- **Inline confirmation instead of toast/modal** — SPEC says "toast/modal" but we use inline state in the autocomplete dropdown. Simpler, no toast infrastructure needed, feedback appears right where the user is looking
- **RequestStatus state machine** — `"idle" | "loading" | "success" | "error"` union type in `lib/types.ts` drives the zero-results UI in the dropdown. State resets to `"idle"` when the user types a new query
- **Existing movie redirect** — When the API finds an existing movie matching the query, it returns `{ existingMovie }` and the UI navigates directly to `/movie/{tmdbId}` instead of showing "we already have it"
- **Duplicate queue entries are allowed** — Multiple requests for the same movie each create a queue entry. The worker (Phase 5) deduplicates by tmdbId during processing

### Ingestion Worker (Phase 5) — Planned
- **Worker as separate process**: `npm run worker` polls queue every 30 seconds in separate terminal
- **TMDB metadata fetching**: 3 parallel API calls per movie:
  1. Base movie data (`GET /movie/{tmdbId}`)
  2. Credits for directors (`GET /movie/{tmdbId}/credits`)
  3. Release dates for MPAA rating (`GET /movie/{tmdbId}/release_dates`)
- **Rate limiting**: 500ms delay between TMDB requests to respect API limits
- **Deduplication by tmdbId**: If movie with same tmdbId is already 'processing', mark duplicate job as 'complete' without re-fetching
- **Death scraping + LLM extraction**: Scrape List of Deaths wiki, use Ollama to extract structured JSON
- **Error handling**: Exponential backoff for TMDB retries (2s, 4s, 8s), mark jobs 'failed' with reason, log to console (no user-facing errors)

### Notification System (Phase 6)
- **Polling-based**: Frontend polls `/api/notifications/poll` every 60 seconds (no WebSocket/SSE)
- **localStorage persistence**: `seenNotifications` array stores tmdbIds user has already seen
- **Badge count**: Shows number of unseen movies added in last 24 hours
- **Notification bell**: Fixed top-right on all pages via root layout
- **Auto-dismiss**: Clicking notification navigates to movie page and marks as read
- **"Mark all as read"**: Clears badge, updates localStorage with all current tmdbIds

### TMDB API Integration Details
- **Bearer token authentication**: All TMDB requests use `Authorization: Bearer ${API_KEY}` header
- **Director extraction**: Filter `credits.crew` for `job === "Director"`, join multiple names with ", "
- **MPAA rating extraction**: Find US theatrical release (type=3) in release_dates, fallback to "NR" if not found
- **Rate limiting**: 500ms delay between requests (200 movies/hour max)
- **Poster URLs**: `https://image.tmdb.org/t/p/w300${posterPath}` for display, `w92` for thumbnails

### Death Data Structure
- CSV format matches script output: movieTitle, tmdbId, character, timeOfDeath, cause, killedBy, context, isAmbiguous
- LLM prompt enforces exact JSON structure with validation
- `killedBy` defaults to "N/A" if missing or empty
- Zero-death movies insert movie record with empty deaths array (valid state)

## Important Notes

- The Figma prototype in `figma-make-prototype/` is for visual reference only. Do NOT copy its code. Rebuild all components from scratch with proper Next.js patterns.
- Movie poster images come from TMDB CDN: `https://image.tmdb.org/t/p/w300{posterPath}`
- The ingestion worker requires Ollama running locally (`http://localhost:11434`) with Llama 3.2 3B model pulled
- Seed data in `data/` will be expanded over time. The seed script should handle re-runs gracefully (upsert pattern).
- Environment variables must include TMDB_API_KEY (bearer token) and OLLAMA_ENDPOINT for Phases 4+
