# CLAUDE.md — Project Context

## Project

**Who Dies in This Movie?** — A website where users look up movies to see which characters die, when, how, and by whose hand.

- Domain: `whodiesinthismovie.com`
- Status: MVP (greenfield build)

## Tech Stack

- **Framework**: Next.js 14+ with App Router, TypeScript
- **Styling**: Tailwind CSS (utility-first, no CSS modules)
- **Database**: PostgreSQL 15+ via Prisma ORM
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
├── components/                 # Shared React components
├── lib/                        # Utilities (prisma client, etc.)
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

- **ORM**: Prisma with PostgreSQL
- **Models**: `Movie` (1) → (many) `Death`, linked via `movieId` foreign key
- **Seed data**: JSON files in `data/`. The seed script upserts by `tmdbId`, so it's safe to re-run after adding movies.
- **Migrations**: Run `npx prisma migrate dev` after schema changes.

## Design System

Full design system documented in `docs/SPEC.md` Section 2. Key points:

- **Fonts**: Space Grotesk (headings), Inter (body) — loaded via Google Fonts in layout
- **Colors**: Primary `#030213`, death cards `#1F1F1F`, easter egg gradient `#8B5CF6` → `#6D28D9`
- **Background**: Movie posters with 60% black overlay + heavy blur
- **Reference**: `figma-make-prototype/` is visual reference only. Rebuild all components from scratch using Next.js best practices.

## API Routes

| Endpoint | Method | Request | Response |
|----------|--------|---------|----------|
| `/api/movies/search?q=` | GET | `q`: search string (3+ chars) | `Movie[]` (max 8) or `{ tooMany: true }` |
| `/api/movies/[tmdbId]` | GET | — | `Movie` with `deaths: Death[]` |
| `/api/smart-search` | POST | `{ query: string }` | `{ answer: string, movieTmdbId?: number }` |

## Important Notes

- The Figma prototype in `figma-make-prototype/` is for visual reference only. Do NOT copy its code. Rebuild all components from scratch with proper Next.js patterns.
- Movie poster images come from TMDB CDN: `https://image.tmdb.org/t/p/w300{posterPath}`
- The RAG easter egg (triggered by `!!` prefix) requires a separate Python service on `localhost:8000`. The Next.js app only proxies requests to it.
- Seed data in `data/` will be expanded over time. The seed script should handle re-runs gracefully (upsert pattern).
