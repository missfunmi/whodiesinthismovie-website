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
- **LLM**: Ollama + Mistral 7B (query validation & death extraction in ingestion worker; configurable via `OLLAMA_MODEL` env var)
- **Queue**: Database-based polling queue (no Redis/BullMQ)
- **Notifications**: Polling-based (60s interval) with localStorage persistence for read state
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
│   ├── error.tsx               # Root error boundary (client)
│   ├── browse/
│   │   ├── page.tsx            # All movies browse page (grid + pagination)
│   │   ├── loading.tsx         # Browse page loading skeleton
│   │   └── error.tsx           # Browse error boundary (client)
│   ├── movie/
│   │   └── [tmdbId]/
│   │       ├── page.tsx        # Movie detail page
│   │       ├── loading.tsx     # Movie detail loading skeleton
│   │       └── error.tsx       # Movie detail error boundary (client)
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
│   ├── poster-image.tsx        # Image with onError fallback to Film icon (client)
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
- The `DeathReveal` component always shows the reveal button, even for zero-death movies. The "No deaths! Everyone survives!" message is only shown after the user clicks the button — maintaining the spoiler-protection pattern consistently.

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
- **Empty state:** Shows Film icon + "We don't have that one yet!" when database has zero movies
- **"Browse All Movies" link** added to home page below search bar as a subtle white/60 text link
- **Grid/List layout toggle:** Users can switch between grid (default) and list view. List view renders a compact table with poster thumbnail, title, year, and runtime — useful for Cmd+F text searching

### Movie Request System (Phase 4) *(Complete)*
- **IngestionQueue model pulled forward from Phase 5** — Phase 4 API route needs to insert into the queue, so the model was added in Phase 4 (SPEC Phase 5 task 5.1 marked done)
- **LLM validation gates queue inserts** — Ollama call uses a 5-second timeout with AbortController. If the LLM identifies a query as not a real movie title, the queue insert is silently skipped (user still sees success per SPEC). If Ollama is unavailable/timeout/errors, validation is skipped and the request proceeds normally. AbortController timeout cleanup uses `finally` block to prevent timer leaks
- **Ollama model is configurable** — `OLLAMA_MODEL` env var (defaults to `mistral`). Switched from Llama 3.2 3B to Mistral 7B — the 3B model timed out on enrichment prompts with large inputs
- **Inline confirmation instead of toast/modal** — SPEC says "toast/modal" but we use inline state in the autocomplete dropdown. Simpler, no toast infrastructure needed, feedback appears right where the user is looking
- **RequestStatus state machine** — `"idle" | "loading" | "success" | "error"` union type in `lib/types.ts` drives the zero-results UI in the dropdown. State resets to `"idle"` only when the query substantively changes (trimmed value differs), preventing accidental whitespace from wiping success messages
- **Existing movie check uses `equals` (not `contains`)** — Prevents false redirects where a broad query like "Alien" might match "Alien vs. Predator". SPEC prescribes `contains` but `equals` with `mode: "insensitive"` is more precise for the request flow
- **Queue-level deduplication** — API checks `IngestionQueue` for existing `pending`/`processing` entries with the same query (case-insensitive) before inserting. Prevents queue flooding from repeated requests. The worker (Phase 5) also deduplicates by tmdbId during processing
- **CSRF protection** — Production-only `Origin` header validation. Parses origin URL and compares host against the `Host` header to prevent cross-site request forgery on the POST endpoint

### Ingestion Worker (Phase 5) *(Complete)*
- **Worker as separate process**: `npm run worker` runs `tsx scripts/ingestion-worker.ts`, polls queue every 30 seconds
- **Prisma client setup**: Worker runs outside Next.js, so it creates its own PrismaClient with `import "dotenv/config"` and direct `PrismaPg` adapter (same pattern as `prisma/seed.ts`)
- **LLM title validation**: Step 1 in the processing pipeline (per SPEC architecture diagram). Best-effort with 5s timeout — if Ollama is unavailable, validation is skipped and processing continues. Rejects queries the LLM identifies as not real movie titles
- **TMDB authentication**: Supports both raw API key and "Bearer "-prefixed key in `TMDB_API_KEY`. Auto-detects format and adds `Bearer ` prefix if needed. Startup log confirms which format was detected
- **TMDB metadata fetching**: 3 parallel API calls per movie via `Promise.all`:
  1. Base movie data (`GET /movie/{tmdbId}`)
  2. Credits for directors (`GET /movie/{tmdbId}/credits`)
  3. Release dates for MPAA rating (`GET /movie/{tmdbId}/release_dates`)
- **MPAA rating**: Extracts from US theatrical release (type=3), filters out TMDB's empty string and "0" values, falls back to "NR"
- **Rate limiting**: 500ms delay after TMDB calls before scraping
- **Deduplication**: Checks both `IngestionQueue` (another job processing same tmdbId) and `Movie` table (movie already exists). Marks duplicate jobs as 'complete' without re-processing
- **Death scraping uses MediaWiki APIs** (not HTML scraping):
  1. List of Deaths fandom wiki (`listofdeaths.fandom.com/api.php`) — returns structured wikitext with Victims section
  2. Wikipedia (`en.wikipedia.org/w/api.php`) — returns HTML extracts, parses Plot section
  3. The Movie Spoiler (`themoviespoiler.com`) — HTML scraping fallback
  - Year-specific page titles tried first (e.g., "Jaws (1975)") to avoid franchise pages
  - If all sources fail, proceeds with empty deaths (not a hard failure)
  - User-Agent includes contact email per Wikipedia/Fandom policies
- **Memory management**: HTML inputs are truncated before cheerio parsing (100KB for Wikipedia, 500KB for Movie Spoiler). Cheerio DOM instances are explicitly nullified after extraction to assist garbage collection in this long-running process
- **LLM extraction**: Ollama streaming mode with `num_ctx: 8192` (default 2048 too small for enrichment prompts with plot text), 30s inactivity timeout + 180s hard ceiling, up to 3 retries, JSON repair for common LLM output quirks (mismatched brackets, HTML entities). Prompt includes example JSON to guide formatting
- **Atomic database insert**: Movie upsert + death delete + death insert + queue update are wrapped in `prisma.$transaction()` for atomicity. If the process crashes mid-write, PostgreSQL rolls back — no risk of a movie being left with zero deaths due to interrupted writes
- **Error handling**: TMDB exponential backoff (2s, 4s, 8s), scraping failures cascade to next source, LLM retries with JSON repair. All errors caught at processJob level — job marked 'failed' with reason, worker continues
- **Graceful shutdown**: SIGINT/SIGTERM disconnects Prisma cleanly
- **Schema alignment**: SPEC.md Section 6 schema updated to match actual `prisma/schema.prisma` (uses `movieId` FK, not `movieTmdbId`). Prevents future LLM code generation from reverting to the incorrect FK

### Notification System (Phase 6) *(Complete)*
- **Polling-based**: Frontend polls `/api/notifications/poll` every 60 seconds (no WebSocket/SSE).
- **localStorage persistence**: `seenNotifications` array stores tmdbIds user has already seen.
- **Badge count**: Shows number of unseen movies added in last 24 hours.
- **Notification bell**: Fixed top-right on all pages via root layout.
- **Auto-dismiss**: Clicking notification navigates to movie page and marks as read.
- **"Mark all as read"**: Clears badge, updates localStorage with all current tmdbIds.

### Bug Fixes & Hardening (Pre-Phase 6) *(Complete)*
- **Tagline visibility fix**: `flex flex-col items-center` on parent caused taglines container to have zero intrinsic width (only contains `absolute` children). Fixed by adding `w-full` to the container div
- **Unmount safety in rotating-taglines**: Added `isMountedRef` guard to prevent state updates after component unmount. The `rotateTimeoutRef` is also cleaned up in the interval effect's teardown
- **onBlur race condition in search**: `isRequestingRef` is now cleared with a 200ms delay (via `setTimeout`) so the 150ms onBlur timer doesn't race ahead and close the dropdown before the success/error message renders
- **Fandom wiki parser hardening**: `parseFandomDeaths` now processes only top-level bullets (`*`), collects `**` sub-bullets as additional context, and uses an extended killedBy regex with more cause-of-death verbs (beheaded, strangled, crushed, drowned, poisoned, mauled, devoured, impaled, decapitated) plus "at the hands of" pattern
- **Success message UX**: Movie request success confirmation now uses a green-tinted background (`bg-green-500/10` + `border-green-500/20`) for visual distinction

### Polish (Phase 7) *(Complete)*
- **Error boundaries**: Three `error.tsx` files (root, movie detail, browse) using Next.js App Router convention. All use `"use client"`, `bg-primary` dark background, white text, "Try Again" button calling `reset()`, and optional "Back to Search" link. Error boundaries catch server component errors and rendering crashes
- **PosterImage client component**: Reusable `components/poster-image.tsx` wraps `next/image` with `onError` → Film icon fallback. Prevents broken image icons when TMDB CDN is down. Used in `movie-metadata.tsx`, `autocomplete-dropdown.tsx`, `browse-grid.tsx`. Server component `movie-metadata.tsx` can use it because PosterImage is a client component child (client boundary is at the component, not the parent)
- **Loading skeletons**: `app/movie/[tmdbId]/loading.tsx` and `app/browse/loading.tsx` render `<MovieHeader>` immediately + `animate-pulse` skeleton layouts matching the actual page structure. Next.js automatically wraps pages in `<Suspense>` with these as fallbacks
- **Search loading spinner**: `isSearching` state in `search.tsx` drives `isLoading` prop on `SearchInput`, which swaps `<Search>` icon for `<Loader2 className="animate-spin">`. Set true on debounce start, false in `finally` after fetch
- **Browse grid fetch error state**: `fetchError` boolean state shows inline error message with "Try again" button. Resets on each new fetch attempt
- **Smart search validation**: Added max 200 char limit + HTML strip regex to `/api/smart-search/route.ts`, matching search/request route patterns
- **Global focus-visible rings**: CSS rule in `globals.css` for `a:focus-visible`, `button:focus-visible`, `select:focus-visible` with `outline: 2px solid #3B82F6; outline-offset: 2px`. Consistent blue ring on keyboard navigation without affecting mouse clicks
- **Notification items as buttons**: Changed notification `<div role="menuitem">` to `<button>` elements for native keyboard accessibility (Enter/Space activation, focusable). Added Escape key handler on dropdown container
- **aria-live search announcements**: `<div aria-live="polite" className="sr-only">` in search component announces result counts and status changes to screen readers
- **sr-only loading text**: Added `<span className="sr-only">` for loading states in search, browse grid, and death reveal
- **Responsive overflow fixes**: Autocomplete dropdown uses `max-h-[60vh] sm:max-h-125` to prevent overflow on small screens. Notification dropdown uses `max-w-[calc(100vw-2rem)]` to constrain width on 375px viewports
- **hasRotated ref → state**: `rotating-taglines.tsx` used `hasRotated.current` during render which violated `react-hooks/refs` lint rule. Converted to `useState` since it controls render output (whether to apply animation CSS)
- **SPEC deviation**: SPEC says "Network failure toast" but we use inline error states (browse grid) and error boundaries (page-level) instead. No toast library needed; error feedback appears contextually where the user is looking

### TMDB API Integration Details
- **Bearer token authentication**: All TMDB requests use `Authorization: Bearer ${API_KEY}` header. The worker auto-detects whether `TMDB_API_KEY` includes the "Bearer " prefix and adds it if missing
- **Director extraction**: Filter `credits.crew` for `job === "Director"`, join multiple names with ", "
- **MPAA rating extraction**: Find US theatrical release (type=3) in release_dates, filter out empty strings and "0" values, fallback to "NR" if not found
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
- The ingestion worker requires Ollama running locally (`http://localhost:11434`) with Mistral model pulled (`ollama pull mistral`)
- Seed data in `data/` will be expanded over time. The seed script should handle re-runs gracefully (upsert pattern).
- Environment variables must include TMDB_API_KEY (raw key or "Bearer ..." token both supported) and OLLAMA_ENDPOINT for Phases 4+
- ALWAYS commit all changes on `feature/` or `bugfix/` branches, as necessary — never on main or master
