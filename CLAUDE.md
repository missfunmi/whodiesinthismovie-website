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
- **LLM**: Ollama + Llama 3.2 3B (easter egg feature, via separate Python RAG service)
- **Logging**: Sentry
- **Hosting**: Vercel

## Commands

```bash
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npx prisma migrate dev   # Run database migrations
npx prisma db seed       # Seed database from data/ JSON files
npx prisma studio        # Visual database browser
```

## Project Structure

```
├── app/
│   ├── layout.tsx              # Root layout (fonts, metadata)
│   ├── page.tsx                # Welcome page (search + poster background)
│   ├── movie/
│   │   └── [tmdbId]/
│   │       └── page.tsx        # Movie detail page
│   └── api/
│       ├── movies/
│       │   ├── search/route.ts # GET - search movies by title
│       │   └── [tmdbId]/route.ts # GET - movie + deaths
│       └── smart-search/route.ts # POST - RAG easter egg
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
│   └── skeleton-loader.tsx     # Pulsing skeleton grid (presentational)
├── lib/
│   ├── prisma.ts               # Prisma client singleton
│   ├── types.ts                # Shared TypeScript types (decoupled from Prisma)
│   └── utils.ts                # formatRuntime, getPosterUrl helpers
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

- **App Router**: Use server components by default. Add `"use client"` only for interactivity (search input, death reveal toggle, animations).
- **Styling**: Tailwind only. No CSS modules, no styled-components. Design tokens defined in `tailwind.config.ts` and `globals.css`.
- **Naming**: PascalCase for components, camelCase for functions/variables, kebab-case for files.
- **Components**: One component per file in `components/`. Co-locate component-specific types in the same file.
- **API routes**: Use Next.js Route Handlers (`route.ts`). Return `NextResponse.json()`. Validate inputs at the handler level.
- **Database**: Access via shared Prisma client singleton in `lib/prisma.ts`. Never import `@prisma/client` directly in components.

## Database

- **ORM**: Prisma v7 with PostgreSQL via `@prisma/adapter-pg`
- **Models**: `Movie` (1) → (many) `Death`, linked via `movieId` foreign key
- **Seed data**: JSON files in `data/`. The seed script upserts by `tmdbId`, so it's safe to re-run after adding movies.
- **Migrations**: Run `npx prisma migrate dev` after schema changes.
- **Config**: Prisma v7 uses `prisma.config.ts` for CLI config (seed command, datasource URL). The seed command is `npx tsx prisma/seed.ts`.

## Design System

Full design system documented in `docs/SPEC.md` Section 2. Key points:

- **Fonts**: Space Grotesk (headings), Inter (body) — loaded via Google Fonts in layout
- **Colors**: Primary `#2c2b32`, death cards `#1F1F1F`, easter egg gradient `#8B5CF6` → `#6D28D9`
- **Background**: Movie posters with 60% black overlay + heavy blur
- **Reference**: `figma-make-prototype/` is visual reference only. Rebuild all components from scratch using Next.js best practices.

## API Routes

| Endpoint                | Method | Request                       | Response                                   |
| ----------------------- | ------ | ----------------------------- | ------------------------------------------ |
| `/api/movies/search?q=` | GET    | `q`: search string (3+ chars) | `Movie[]` (max 8) or `{ tooMany: true }`   |
| `/api/movies/[tmdbId]`  | GET    | —                             | `Movie` with `deaths: Death[]`             |
| `/api/smart-search`     | POST   | `{ query: string }`           | `{ answer: string, movieTmdbId?: number }` |

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

## Important Notes

- The Figma prototype in `figma-make-prototype/` is for visual reference only. Do NOT copy its code. Rebuild all components from scratch with proper Next.js patterns.
- Movie poster images come from TMDB CDN: `https://image.tmdb.org/t/p/w300{posterPath}`
- The RAG easter egg (triggered by `!!` prefix) requires a separate Python service on `localhost:8000`. The Next.js app only proxies requests to it.
- Seed data in `data/` will be expanded over time. The seed script should handle re-runs gracefully (upsert pattern).
