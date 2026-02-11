# Technical Specification: Who Dies in This Movie?

> **Domain**: whodiesinthismovie.com
> **Timeline**: 48-hour MVP build
> **Audience**: Internal/friendly demo

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Design System Reference](#2-design-system-reference)
3. [Implementation Plan](#3-implementation-plan)
4. [User Flow Diagrams](#4-user-flow-diagrams)
5. [Specific Tasks](#5-specific-tasks)
6. [Database Schema](#6-database-schema)
7. [Edge Cases](#7-edge-cases)

---

## 1. Architecture Overview

### 1.1 Tech Stack

| Layer         | Technology               | Purpose                                  |
| ------------- | ------------------------ | ---------------------------------------- |
| Framework     | Next.js 14+ (App Router) | SSR, routing, API routes                 |
| Language      | TypeScript               | Type safety                              |
| Styling       | Tailwind CSS             | Utility-first CSS                        |
| Database      | PostgreSQL 15+           | Persistent data store                    |
| ORM           | Prisma                   | Type-safe database queries               |
| Images        | next/image + TMDB CDN    | Optimized poster loading                 |
| LLM           | Gemini 2.5 Flash (primary), Ollama (fallback) | Query validation & death data extraction |
| Queue System  | Database-based (Prisma)  | Ingestion queue with polling worker      |
| Notifications | Polling (60s interval)   | Check for new movies, localStorage       |
| Logging       | Sentry                   | Error tracking                           |
| Hosting       | Vercel                   | Deployment target                        |

### 1.2 System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER INTERFACE                        │
│  (Next.js + React + Tailwind)                               │
│                                                              │
│  • Home Page (search + rotating taglines)                   │
│  • Movie Detail Page (metadata + death cards)               │
│  • All Movies Page (alphabetical grid + pagination)         │
│  • Notification Bell (top-right, last 5 additions)          │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    NEXT.JS API ROUTES                        │
│                                                              │
│  • /api/movies/search - autocomplete search                 │
│  • /api/movies/[id] - movie detail                          │
│  • /api/movies/browse - paginated all movies list           │
│  • /api/movies/request - add to ingestion queue             │
│  • /api/notifications/poll - check for new additions        │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    POSTGRES DATABASE                         │
│                                                              │
│  • movies (metadata)                                         │
│  • deaths (character deaths)                                 │
│  • ingestion_queue (user requests with status tracking)     │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                  BACKGROUND WORKER                           │
│  (Node.js polling ingestion_queue every 30s)                │
│                                                              │
│  1. LLM Validation (Gemini primary, Ollama fallback)        │
│  2. TMDB API Lookup                                          │
│  3. Death Scraping (List of Deaths wiki)                    │
│  4. LLM Extraction (structured death data)                   │
│  5. Database Insert                                          │
│  6. Emit notification                                        │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 Route Structure

**Pages (App Router)**

| Route             | Component                     | Description                                                        |
| ----------------- | ----------------------------- | ------------------------------------------------------------------ |
| `/`               | `app/page.tsx`                | Welcome page with search bar, poster background, rotating taglines |
| `/movie/[tmdbId]` | `app/movie/[tmdbId]/page.tsx` | Movie detail with death reveal                                     |
| `/browse`         | `app/browse/page.tsx`         | All movies alphabetical grid with pagination                       |

**API Routes**

| Endpoint                       | Method | Description                                                                                 |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `/api/movies/search?q={query}` | GET    | Search movies by title. Returns max 8 results. If >100 matches, returns `{ tooMany: true }` |
| `/api/movies/[tmdbId]`         | GET    | Get movie metadata + all deaths                                                             |
| `/api/movies/browse?page={n}`  | GET    | Get paginated movies (100 per page), sorted A-Z                                             |
| `/api/movies/request`          | POST   | Add movie request to ingestion queue. Body: `{ query: string }`                             |
| `/api/notifications/poll`      | GET    | Get movies added in last 24 hours for notification bell                                     |

### 1.4 Data Flow

**Standard Search Flow**
1. User types in search input (3+ characters triggers autocomplete)
2. Client debounces (300ms) then calls `GET /api/movies/search?q={query}`
3. API performs case-insensitive partial match on `Movie.title` via Prisma
4. Returns array of `{ tmdbId, title, year, posterPath }` (max 8) or `{ tooMany: true }` if >100
5. Client renders autocomplete dropdown

**Movie Detail Flow**
1. User selects movie from autocomplete (click or Enter)
2. Client navigates to `/movie/[tmdbId]`
3. Server component fetches movie + deaths via Prisma (single query with relation include)
4. Renders movie metadata + hidden death section

**Movie Request & Ingestion Flow**
1. User searches for movie not in database → zero results
2. "Want us to look it up?" link appears
3. User clicks → `POST /api/movies/request` with `{ query: string }`
4. API validates query is not empty/malformed, parses optional year from query (e.g., "matrix 1999" → title="matrix", year=1999)
5. Check if movie already exists in main Movies DB (filtered by year if provided) → if yes, return existing movie
6. Add to ingestion_queue with status "pending" and optional year, return success message immediately (non-blocking — no LLM call)
7. Background worker polls queue every 30s
8. Worker picks up job, updates status to "processing"
9. Worker validates query is a real movie title via LLM (Gemini primary, Ollama fallback; best-effort — proceeds if both unavailable)
10. Worker calls TMDB API to get movie metadata + tmdbId (passes year filter to TMDB if available)
11. If multiple matches, take first result
12. Worker scrapes List of Deaths wiki / Wikipedia / The Movie Spoiler for death data, validates scraped content matches expected year/director to prevent disambiguation errors
13. Worker uses LLM to extract/enrich structured death data from scraped content (Gemini primary, Ollama fallback)
14. Worker inserts movie + deaths to main tables, updates queue status to "complete"
15. Frontend polls `/api/notifications/poll` every 60s, detects new movie
16. Notification appears in bell dropdown

**Notification Flow**
1. Frontend polls `/api/notifications/poll` every 60 seconds
2. API returns movies added in last 24 hours
3. Frontend compares with localStorage to find new additions
4. New movies trigger notification badge update and dropdown addition
5. User clicks bell → dropdown shows last 5 notifications
6. Clicking notification link navigates to movie page and dismisses notification
7. "Mark all as read" clears badge and localStorage entries

**All Movies Browse Flow**
1. User navigates to `/browse` or clicks "Browse All Movies" link
2. Server component fetches first 100 movies alphabetically via Prisma
3. Movies added in last 24 hours show "NEW!" badge
4. Pagination controls shown if >100 total movies
5. User can sort by "Recently Added" (changes sort to `ORDER BY createdAt DESC`)

### 1.5 Image Strategy

- TMDB poster base URL: `https://image.tmdb.org/t/p/`
- Poster sizes used: `w300` (thumbnails, detail page), `w92` (autocomplete dropdown)
- Configure in `next.config.ts`:
  ```ts
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org', pathname: '/t/p/**' }
    ]
  }
  ```
- Poster full URL format: `https://image.tmdb.org/t/p/w300${movie.posterPath}`

### 1.6 State Management

React hooks only — no external state library needed:
- `useState` for component-level state (search query, dropdown visibility, death reveal toggle, notification count)
- `useEffect` for debounced search, tagline rotation, poster animation, notification polling
- `useRef` for input focus management, animation timers, polling intervals
- `localStorage` for notification persistence across page refreshes

---

## 2. Design System Reference

> Extracted from Figma prototype (`figma-make-prototype/`) with documented refinements.
> All UI implementation must match these specs. Do NOT use Figma code directly — rebuild from scratch.

### 2.1 Color Palette

**Core Tokens**

| Token                  | Value                | Usage                        |
| ---------------------- | -------------------- | ---------------------------- |
| `--primary`            | `#2c2b32`            | Buttons, primary actions     |
| `--primary-foreground` | `#ffffff`            | Text on primary              |
| `--background`         | `#ffffff`            | Page background (light mode) |
| `--foreground`         | `oklch(0.145 0 0)`   | Default text                 |
| `--muted`              | `#ececf0`            | Muted backgrounds            |
| `--muted-foreground`   | `#717182`            | Secondary text, labels       |
| `--border`             | `rgba(0, 0, 0, 0.1)` | Borders, dividers            |
| `--destructive`        | `#d4183d`            | Error states                 |

**Component-Specific Colors**

| Element                | Value                    | Notes                     |
| ---------------------- | ------------------------ | ------------------------- |
| Death card background  | `#1F1F1F`                | Dark cards on detail page |
| Ambiguous death card   | `#1F1F1F` at 50% opacity | Grayed-out appearance     |
| Search focus ring      | Tailwind `blue-500`      | 4px ring width            |
| Dropdown selected item | Tailwind `blue-500` bg   | White text on selected    |
| Warning text           | Tailwind `orange-500`    | "Too many matches"        |
| Notification badge     | Tailwind `red-500`       | Unread count on bell      |
| "NEW!" badge           | Tailwind `green-500`     | Recently added movies     |

**Movie Detail Page (Dark Theme)**

The movie detail page uses `bg-primary` (`#2c2b32`) as the page background. All text and UI elements on this page use light-on-dark colors:

| Element                                 | Value                           |
| --------------------------------------- | ------------------------------- |
| Page background                         | `#2c2b32` (`bg-primary`)        |
| Primary text (titles, values)           | `white`                         |
| Secondary text (labels, icons, context) | Tailwind `gray-400` (`#9CA3AF`) |
| Death card field values                 | Tailwind `gray-100` (`#F3F4F6`) |

### 2.2 Typography

**Font Families**

| Role             | Font          | Weights       | Source       |
| ---------------- | ------------- | ------------- | ------------ |
| Headings (h1-h6) | Space Grotesk | 400, 500, 700 | Google Fonts |
| Body text        | Inter         | 400, 500, 600 | Google Fonts |

**Type Scale**

| Element               | Size (Desktop)                | Size (Mobile)     | Weight |
| --------------------- | ----------------------------- | ----------------- | ------ |
| Hero heading          | 56px (`text-[56px]`)          | 48px (`text-5xl`) | 700    |
| Movie title (detail)  | 48px (`text-5xl`)             | 36px (`text-4xl`) | 700    |
| Taglines              | 18-20px (`text-lg`/`text-xl`) | Same              | 400    |
| Character name (card) | 18px (`text-lg`)              | Same              | 700    |
| Body text             | 16px (`text-base`)            | Same              | 400    |

### 2.3 Spacing & Layout

**Spacing Scale** (follows Tailwind defaults)

| Token | Value     |
| ----- | --------- |
| xs    | 4px (1)   |
| sm    | 8px (2)   |
| md    | 16px (4)  |
| lg    | 24px (6)  |
| xl    | 32px (8)  |
| 2xl   | 48px (12) |

**Border Radius**

| Element           | Value | Tailwind Class |
| ----------------- | ----- | -------------- |
| Search input      | 12px  | `rounded-xl`   |
| Dropdown          | 12px  | `rounded-xl`   |
| Death cards       | 8px   | `rounded-lg`   |
| Buttons           | 6px   | `rounded-md`   |
| Notification bell | 50%   | `rounded-full` |

**Layout Containers**

| Context                     | Max Width            | Padding |
| --------------------------- | -------------------- | ------- |
| Welcome/search page content | 768px (`max-w-3xl`)  | `px-4`  |
| Movie detail page           | 1280px (`max-w-7xl`) | `px-4`  |
| Browse page                 | 1280px (`max-w-7xl`) | `px-4`  |

**Responsive Breakpoint**: 768px (`md:` prefix) — single breakpoint for mobile/desktop

### 2.4 Component Specifications

#### SearchInput

```
Container: relative
Icon: Search (lucide-react), absolute left-4, w-5 h-5, text-gray-400
Input:
  - w-full pl-12 pr-4 py-5
  - text-lg rounded-xl
  - bg-white/95 text-gray-900
  - placeholder:text-gray-500 placeholder:font-medium
  - focus:outline-none focus:ring-4 focus:ring-blue-500
  - shadow-2xl
  - fontSize: 16px (prevents iOS zoom)
  - autoFocus on mount
```

**Behavior**:
- Autocomplete triggers at 3+ characters as user types (no Enter required)
- Bare "the" / "the " queries: suppress autocomplete, return nothing
- Debounce: 300ms before API call

#### AutocompleteDropdown

```
Container:
  - absolute top-full left-0 right-0 mt-2
  - bg-white/95 backdrop-blur-md
  - rounded-xl shadow-2xl
  - max-h-[500px] overflow-y-auto

Item (button):
  - w-full flex items-center gap-4 p-4
  - transition-colors

Thumbnail: w-12 h-16 object-cover rounded shadow-md flex-shrink-0

Title: font-medium truncate
Year: text-sm, in parentheses below title
```

**States**:
- Default: `hover:bg-gray-100 text-gray-900`, year `text-gray-500`
- Keyboard selected: `bg-blue-500 text-white`, year `text-blue-100`
- Too many matches (>100): centered AlertCircle icon + "Too many matches - keep typing!"
- No results: centered "We don't have that one yet!" with link "Want us to look it up?"

**Keyboard Navigation**:
- ArrowDown: move selection down (stop at last item)
- ArrowUp: move selection up (stop at first item)
- Enter: select highlighted item and navigate to detail page

**Constraints**: Maximum 8 results displayed

#### DeathCard (Confirmed Deaths)

```
Container:
  - bg-[#1F1F1F] rounded-lg p-6
  - border border-white/10
  - hover:translate-y-[-4px] hover:shadow-xl
  - transition-all duration-200

Character name: text-lg font-bold text-white mb-4

Fields (4 rows, each with icon + label + value):
  - Icon: w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5
  - Layout: flex items-start gap-3
  - Label: text-sm text-gray-400
  - Value: text-base text-gray-100

  Row 1: Clock icon → "Time" → timeOfDeath
  Row 2: Skull icon → "Cause" → cause
  Row 3: Target icon → "By" → killedBy
  Row 4: AlignLeft icon → "Context" → context (brief 1-2 sentences)
```

**Grid Layout**: `grid grid-cols-1 md:grid-cols-2 gap-4`

#### AmbiguousDeathCard

```
Container:
  - bg-[#1F1F1F]/50 rounded-lg p-6
  - border border-white/10 relative

Question mark badge:
  - absolute top-4 right-4
  - w-8 h-8 rounded-full bg-white/10
  - flex items-center justify-center
  - Content: "?" text-xl text-gray-400

Character name: text-lg font-bold text-gray-300 mb-2 pr-10
Context: text-sm text-gray-400
```

#### RevealButton

```
Before reveal:
  - Button: bg-white text-primary "See who dies in this movie"
  - ChevronDown icon, w-5 h-5 mr-2
  - text-lg px-8 py-6 shadow-lg hover:shadow-xl hover:bg-gray-100 transition-all
  - Centered: flex justify-center mb-8

After reveal:
  - Count header above cards: "X characters died" (e.g., "12 characters died")
  - Button changes to: "Hide Deaths" with ChevronUp icon
  - Death cards grid appears below

Zero deaths:
  - Message: "No deaths! Everyone survives! 🥳"
  - No button (no cards to show/hide)
```

#### NotificationBell

```
Container:
  - fixed top-4 right-4 z-50
  - relative

Bell icon button:
  - w-12 h-12 rounded-full bg-white shadow-lg
  - hover:bg-gray-100 transition-colors
  - Bell icon (lucide-react), w-6 h-6 text-gray-700

Badge (if unread > 0):
  - absolute -top-1 -right-1
  - w-6 h-6 rounded-full bg-red-500
  - text-white text-xs font-bold
  - flex items-center justify-center
  - Content: unread count (max display: "9+")

Dropdown (when open):
  - absolute top-full right-0 mt-2
  - w-80 max-h-96 overflow-y-auto
  - bg-white rounded-xl shadow-2xl p-4
  - border border-gray-200

Notification item:
  - p-3 hover:bg-gray-50 rounded-lg cursor-pointer
  - Movie title (font-medium) with "NEW!" badge (bg-green-500 text-white px-2 py-1 text-xs rounded)
  - Timestamp (text-xs text-gray-500)

"Mark all as read" button:
  - text-sm text-blue-500 hover:text-blue-700 mt-2
  - Clears badge and localStorage
```

#### BrowseGrid

```
Container:
  - grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6

Movie card:
  - relative group cursor-pointer
  - transition-transform hover:scale-105

Poster: w-full aspect-[2/3] object-cover rounded-lg shadow-lg

Title overlay (on hover):
  - absolute bottom-0 left-0 right-0
  - bg-black/80 p-3
  - text-white text-sm font-medium

"NEW!" badge (if added in last 24h):
  - absolute top-2 right-2
  - bg-green-500 text-white px-2 py-1 text-xs rounded font-bold

Pagination controls:
  - flex justify-center items-center gap-4 mt-8
  - Previous/Next buttons: px-4 py-2 bg-white rounded-md shadow hover:bg-gray-50
  - Page indicator: "Page X of Y"
```

### 2.5 Animations

| Animation         | Trigger             | Duration | Details                                                        |
| ----------------- | ------------------- | -------- | -------------------------------------------------------------- |
| Tagline rotation  | Auto, every 4s      | 600ms    | 5 variants: slideLeft, slideRight, fadeScale, blur, typewriter |
| Poster crossfade  | Auto, every 4-5s    | 4-5s     | Fade opacity 0→0.6→0. No rotation.                             |
| Death card hover  | Mouse enter         | 200ms    | `translate-y-[-4px]` + `shadow-xl`                             |
| Reveal loading    | Click reveal button | 800ms    | 4 skeleton cards pulse                                         |
| Notification fade | New notification    | 300ms    | Fade in, slide down                                            |

### 2.6 Accessibility Requirements

| Requirement         | Implementation                                                    |
| ------------------- | ----------------------------------------------------------------- |
| Color contrast      | WCAG AA (4.5:1 body text, 3:1 large text)                         |
| Keyboard navigation | Arrow keys for dropdown, Enter to select, Tab for focus traversal |
| Focus indicators    | `focus-visible:ring-4` on interactive elements                    |
| Screen reader       | Semantic HTML, ARIA labels on icon-only elements                  |
| Touch targets       | Minimum 44x44px on all interactive elements                       |
| Reduced motion      | Respect `prefers-reduced-motion` for animations                   |

---

## 3. Implementation Plan

### PHASE 1 — Foundation *(Complete)*

**Goal**: Working API with seeded database. Demo-able via curl/Postman.

- Initialize Next.js project with TypeScript + Tailwind CSS (App Router)
- Install dependencies: `prisma`, `@prisma/client`, `lucide-react`, `@sentry/nextjs`
- Configure Tailwind with design tokens from Section 2
- Configure `next.config.ts` with TMDB image remote pattern
- Define Prisma schema (`Movie`, `Death` models)
- Run initial Prisma migration
- Write database seed script reading `data/seed-movies.json` and `data/seed-deaths.json`
- Implement `GET /api/movies/search?q={query}`
- Implement `GET /api/movies/[tmdbId]`
- Set up Sentry
- Add Google Fonts (Space Grotesk + Inter)

### PHASE 2 — Core UI *(Complete)*

**Goal**: Fully functional search-to-detail flow. Demo-able in browser.

- Welcome page with poster background + rotating taglines
- Search autocomplete with keyboard navigation
- Movie detail page with metadata + death reveal system
- Death card grid (confirmed + ambiguous deaths sections)
- "No deaths! Everyone survives!" message for zero-death movies

### PHASE 3 — All Movies Browse Page *(Complete)*

**Goal**: Browsable catalog of all movies in database. Standalone feature.

- Create `/browse` page route
- Implement `GET /api/movies/browse?page={n}&sort={field}` endpoint
  - Default sort: alphabetical (A-Z) by title
  - Alternative sort: recently added (`createdAt DESC`)
  - Pagination: 100 movies per page
  - Returns: `{ movies: Movie[], totalPages: number, currentPage: number }`
- Build BrowseGrid component (Section 2.4)
  - Grid layout: 2 cols mobile, 4 cols tablet, 5 cols desktop
  - "NEW!" badge on movies added in last 24 hours
  - Hover effect with title overlay
- Pagination controls (Previous/Next + page indicator)
- Sort filter dropdown (Alphabetical / Recently Added)
- Link from home page: "Browse All Movies" button below search

### PHASE 4 — Movie Request System (UI) *(Complete)*

**Goal**: Users can request movies not in database. UI only, no backend processing yet.

- Detect zero search results in autocomplete
- Show "Want us to look it up?" text link
- On click, show confirmation: "Okay, we'll check on that! We'll let you know when we find out who dies in this movie"
- Implement `POST /api/movies/request` endpoint
  - Validate query is not empty, max 200 chars
  - Sanitize input (strip HTML, trim whitespace)
  - Parse optional trailing year from query (e.g., "matrix 1999" → title="matrix", year=1999)
  - Check if movie already exists in main `movies` table (filtered by year if provided)
    - If yes: return existing movie data
  - Check for duplicate pending/processing queue entries
  - Add to `ingestion_queue` table with status "pending" and optional `year` field
  - Return `{ success: true, message: string }` immediately (non-blocking — LLM validation deferred to worker)

### PHASE 5 — Ingestion Worker *(Complete)*

**Goal**: Background process that fetches movie data and adds to database.

- Extend Prisma schema with `ingestion_queue` table (Section 6)
- Create worker script (`scripts/ingestion-worker.ts`)
  - Poll `ingestion_queue` every 30 seconds
  - SELECT jobs WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 1
  - Update status to 'processing' (prevents duplicate work)
- **TMDB Lookup**:
  - Call TMDB search API: `GET /search/movie?query=${query}&year=${year}` (year is optional, from IngestionQueue)
  - If multiple results, take first match
  - If no results, mark job 'failed' with reason, return
  - Extract tmdbId from search result
  - **Fetch full movie metadata** via 3 parallel API calls:
    1. `GET /movie/${tmdbId}` → title, year, tagline, posterPath, runtime, release_date
    2. `GET /movie/${tmdbId}/credits` → filter crew for job="Director", get names
    3. `GET /movie/${tmdbId}/release_dates` → find US theatrical release (type=3) for MPAA rating
  - Handle multiple directors: join with ", " (e.g., "Russo Brothers")
  - MPAA rating fallback: use "NR" (Not Rated) if no US theatrical release found
  - Store tmdbId in ingestion_queue record
- **Death Scraping** (3 sources, tried in order):
  1. List of Deaths fandom wiki: `https://listofdeaths.fandom.com/api.php` (MediaWiki API)
  2. Wikipedia plot summary: `https://en.wikipedia.org/w/api.php` (MediaWiki API)
  3. The Movie Spoiler: `https://themoviespoiler.com` (HTML scraping, with year-suffixed URL slugs)
  - **Disambiguation validation**: After fetching from each source, `validateScrapedContent()` checks that the content mentions the expected year OR director. Content that fails validation is discarded to prevent wrong-movie deaths (e.g., "The Housemaid" 1960 vs 2025)
  - If all sources fail or are rejected by disambiguation, set deaths = [] (valid zero-death movie)
- **LLM Extraction** (shared module: `lib/llm.ts`):
  - Primary: Google Gemini 2.5 Flash via `@google/generative-ai` SDK
  - Fallback: Ollama (streaming mode, `num_ctx: 8192`, 30s inactivity timeout, 180s hard ceiling)
  - If `GEMINI_API_KEY` not set, Gemini is skipped entirely (Ollama-only mode)
  - Two modes: enrichment (parsed deaths + plot → LLM fills context) or full extraction (LLM extracts from raw text)
  - Parse JSON response into structured death records with JSON repair for common LLM output quirks
  - Validate each record has all required fields
  - Set `killedBy: "N/A"` if missing
- **Database Insert**:
  - Upsert movie record by tmdbId: `prisma.movie.upsert({ where: { tmdbId }, create: {...}, update: {...} })`
  - Delete existing deaths: `prisma.death.deleteMany({ where: { movieId: movie.id } })`
  - Bulk insert deaths: `prisma.death.createMany({ data: deathRecords })`
  - Update ingestion_queue status to 'complete', set completedAt timestamp
- **Error Handling**:
  - TMDB timeout: retry with exponential backoff (2s, 4s, 8s), max 3 attempts
  - Scraping failure: log error with URL, mark job 'failed' with reason
  - LLM timeout: Gemini (8s validation, 30s extraction), Ollama (30s inactivity, 180s ceiling). Retry up to 3 times for Ollama. Falls back to parsed deaths if available
  - Invalid JSON from LLM: JSON repair (mismatched brackets, HTML entities), retry, fallback to parsed deaths
  - All errors: console.log with details, don't throw (keep worker running)
- Run worker as separate process: `npm run worker`
- **Rate limiting**: Wait 500ms between TMDB API calls to respect rate limits

### PHASE 6 — Notification System *(Complete)*

**Goal**: Real-time notifications when movies are added.

- Implement `GET /api/notifications/poll` endpoint
  - Query movies WHERE createdAt > NOW() - INTERVAL '24 hours'
  - Return array of `{ tmdbId, title, createdAt }`
- Create NotificationBell component (Section 2.4)
  - Fixed position top-right on all pages
  - Poll `/api/notifications/poll` every 60 seconds
  - Compare results with localStorage key `seenNotifications` (array of tmdbIds)
  - New movies → increment badge count, add to dropdown
  - onClick bell → show dropdown with last 5 notifications
  - onClick notification → navigate to `/movie/[tmdbId]`, remove from localStorage, dismiss
  - "Mark all as read" → clear badge, update localStorage with all current tmdbIds
- Add NotificationBell to root layout (`app/layout.tsx`)
- Persist notifications across page refreshes via localStorage

### PHASE 7 — Polish *(Complete)*

**Goal**: Production-quality MVP. Demo-ready for friendly audience.

- **Input validation & sanitization**:
  - Search query: max 200 chars, strip HTML tags, trim whitespace
  - API routes: validate query params, return proper 400/404/500 responses
  - Prevent XSS via React's default escaping + explicit sanitization

- **Error handling**:
  - API error boundaries: try/catch in all route handlers
  - Client error boundaries: React Error Boundary component
  - Network failure: show "Something went wrong" with retry option
  - Image load failure: fallback poster placeholder

- **Loading states**:
  - Search: subtle loading indicator during debounce
  - Movie detail: full-page skeleton while loading
  - Death reveal: skeleton grid (800ms)
  - Notification polling: silent (no spinner)

- **Responsive QA**:
  - Test at 375px (mobile), 768px (tablet), 1280px+ (desktop)
  - Verify death card grid collapses to single column on mobile
  - Verify browse page grid adjusts columns responsively

- **Visual QA**:
  - Verify all design token values match Section 2
  - Check all refinements are applied

- **Accessibility testing**:
  - Keyboard-only navigation through entire flow
  - Color contrast spot check with browser DevTools

---

## 4. User Flow Diagrams

### 4.1 Standard Movie Search Flow

```
User visits homepage
  ↓
Types 3+ characters in search bar
  ↓
Debounce (300ms) → GET /api/movies/search?q={query}
  ↓
<100 results: show autocomplete dropdown (max 8)
>100 results: show "Too many matches - keep typing!"
  ↓
User selects movie (click or Enter)
  ↓
Navigate to /movie/[tmdbId]
  ↓
Server component fetches movie + deaths
  ↓
Render movie metadata + "See who dies" button
  ↓
User clicks reveal button
  ↓
800ms skeleton loading
  ↓
Death cards grid appears (or "No deaths!" message)
```

### 4.2 Movie Request & Ingestion Flow

```
User searches for "Jaws"
  ↓
GET /api/movies/search?q=jaws → 0 results
  ↓
Show "Want us to look it up?" link
  ↓
User clicks link
  ↓
POST /api/movies/request { query: "Jaws" }
  ↓
API: Validate query not empty/malformed
  ↓
API: LLM validation - is "Jaws" a real movie? (YES)
  ↓
API: Check if movie already in main DB → NO
  ↓
API: INSERT INTO ingestion_queue (query, status='pending')
  ↓
API: Return { success: true, message: "Okay, we'll check on that!" }
  ↓
[30 seconds later]
  ↓
Background worker polls ingestion_queue
  ↓
Worker picks up "Jaws" job, status → 'processing'
  ↓
Worker: TMDB search API → get first result tmdbId
  ↓
Worker: Parallel fetch of 3 TMDB endpoints:
  - GET /movie/{tmdbId} → base metadata
  - GET /movie/{tmdbId}/credits → directors
  - GET /movie/{tmdbId}/release_dates → MPAA rating
  ↓
Worker: Transform to schema:
  - Extract directors (filter crew for job="Director", join names)
  - Extract MPAA rating (find US theatrical release type=3, fallback "NR")
  - Build movie object with all fields
  ↓
Worker: Wait 500ms (rate limiting)
  ↓
Worker: Scrape List of Deaths wiki for "Jaws"
  ↓
Worker: LLM extraction → structured death JSON array
  - Validate each death has required fields
  - Set killedBy="N/A" if missing
  ↓
Worker: Upsert movie + bulk insert deaths to DB
  ↓
Worker: UPDATE ingestion_queue status='complete'
  ↓
[60 seconds later]
  ↓
Frontend polls GET /api/notifications/poll
  ↓
API returns movies added in last 24h (includes "Jaws")
  ↓
Frontend compares with localStorage → "Jaws" is new!
  ↓
Notification bell badge increments, dropdown adds "Jaws has been added!"
  ↓
User clicks notification → navigate to /movie/{tmdbId}
```

### 4.3 Notification Flow

```
[On page load]
  ↓
NotificationBell component mounts
  ↓
Load seenNotifications from localStorage (array of tmdbIds)
  ↓
Start polling interval (every 60 seconds)
  ↓
[Every 60 seconds]
  ↓
GET /api/notifications/poll
  ↓
API: SELECT * FROM movies WHERE createdAt > NOW() - INTERVAL '24 hours'
  ↓
API: Return array of recent movies
  ↓
Frontend: Compare with seenNotifications
  ↓
New movies found?
  ├─ YES → Add to notification list, increment badge
  └─ NO → Do nothing
  ↓
[User clicks bell icon]
  ↓
Show dropdown with last 5 notifications
  ↓
[User clicks notification]
  ↓
Navigate to /movie/[tmdbId]
Dismiss notification (add tmdbId to seenNotifications in localStorage)
Decrement badge count
  ↓
[User clicks "Mark all as read"]
  ↓
Add all current notification tmdbIds to seenNotifications
Clear badge count
Empty notification dropdown
```

### 4.4 All Movies Browse Flow

```
User navigates to /browse (or clicks "Browse All Movies")
  ↓
Server component: GET /api/movies/browse?page=1&sort=alphabetical
  ↓
API: SELECT * FROM movies ORDER BY title ASC LIMIT 100 OFFSET 0
  ↓
API: COUNT total movies for pagination
  ↓
API: Return { movies: Movie[], totalPages: number, currentPage: 1 }
  ↓
Render BrowseGrid component
  ↓
Movies in grid with poster thumbnails
Movies added in last 24h show "NEW!" badge
  ↓
[User changes sort to "Recently Added"]
  ↓
GET /api/movies/browse?page=1&sort=recent
  ↓
API: SELECT * FROM movies ORDER BY createdAt DESC LIMIT 100 OFFSET 0
  ↓
Grid re-renders with new order
  ↓
[User clicks "Next Page"]
  ↓
GET /api/movies/browse?page=2&sort=alphabetical
  ↓
API: OFFSET 100
  ↓
Grid updates with next 100 movies
  ↓
[User clicks movie poster]
  ↓
Navigate to /movie/[tmdbId]
```

---

## 5. Specific Tasks

### Phase 1 — Foundation *(Complete)*

- [x] **P1.1**: Initialize Next.js project with `create-next-app` (TypeScript, Tailwind, App Router, ESLint). Configure `next.config.ts` with TMDB image domain. Add Google Fonts in layout.
- [x] **P1.2**: Configure Tailwind theme — add design tokens: custom colors (`primary`, `muted`, `border`), font families (Space Grotesk, Inter), border radius scale. Set up CSS variables in `globals.css`.
- [x] **P1.3**: Define Prisma schema with `Movie` and `Death` models (see Section 5). Run `npx prisma migrate dev --name init` to create tables.
- [x] **P1.4**: Write seed script (`prisma/seed.ts`) that reads both JSON files from `data/`, upserts movies by `tmdbId`, deletes + recreates deaths per movie. Add `prisma.seed` to `package.json`. Test with `npx prisma db seed`.
- [x] **P1.5**: Implement `GET /api/movies/search` — query validation, Prisma `findMany` with `contains`/`insensitive`, >100 check, max 8 limit. Test with curl.
- [x] **P1.6**: Implement `GET /api/movies/[tmdbId]` — Prisma `findUnique` with deaths included, 404 handling. Test with curl.
- [x] **P1.7**: Set up Sentry (`@sentry/nextjs`) — basic init in `instrumentation.ts`, test error capture.

### Phase 2 — Core UI *(Complete)*

- [x] **P2.1**: Build welcome page layout — full-viewport container, hero heading, tagline container (fixed 80px height). Build PosterBackground component with 8 upright poster slots, crossfade animation (4-5s), 60% black overlay + heavy blur.
- [x] **P2.2**: Build rotating taglines component — 10 taglines from PRD, 4s interval, 5 animation variants (slideLeft, slideRight, fadeScale, blur, typewriter), random variant selection per rotation.
- [x] **P2.3**: Build SearchInput component — styled per spec, autoFocus, 16px font to prevent iOS zoom. Wire up debounced API call (300ms) on input change at 3+ chars. Handle "the" exclusion.
- [x] **P2.4**: Build AutocompleteDropdown component — render up to 8 results with poster thumbnail + title + year. Implement keyboard navigation (ArrowUp/Down/Enter). Handle states: results, "too many matches", "no movies found". Wire click/Enter to navigate to `/movie/[tmdbId]`.
- [x] **P2.5**: Build movie detail page — server component data fetch, Header component with back navigation, MovieMetadata layout (poster left + metadata right on desktop, stacked on mobile). Display title, year, director, runtime, rating, tagline.
- [x] **P2.6**: Build death reveal system — "See who dies in this movie" button, 800ms skeleton loading, count header ("X characters died"), DeathCard grid (2-col desktop, 1-col mobile). Handle zero deaths with "No deaths! Everyone survives!" message.
- [x] **P2.7**: Build AmbiguousDeathCard component + section — grayed-out cards with `?` badge, separate "Ambiguous Deaths" section below confirmed deaths with HelpCircle icon header.

### Phase 3 — All Movies Browse Page *(Complete)*

**3.1** Create `/app/browse/page.tsx` server component
- [x] Fetch movies from database with pagination (100 per page)
- [x] Default sort: alphabetical by title
- [x] Pass movies + pagination data to client component

**3.2** Implement `GET /api/movies/browse` endpoint
- [x] Accept query params: `page` (default 1), `sort` (default 'alphabetical')
- [x] Query movies: `ORDER BY title ASC` or `ORDER BY createdAt DESC`
- [x] Use Prisma pagination: `take: 100, skip: (page - 1) * 100`
- [x] Count total movies for pagination calculation
- [x] Return `{ movies, totalPages, currentPage }`

**3.3** Build BrowseGrid client component
- [x] Grid layout: `grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6`
- [x] Movie card: poster + title overlay on hover
- [x] "NEW!" badge if `createdAt > NOW() - 24 hours`
- [x] Click poster → navigate to `/movie/[tmdbId]`

**3.4** Add pagination controls
- [x] Previous/Next buttons (disabled when at boundaries)
- [x] Page indicator: "Page X of Y"
- [x] URL search params: `/browse?page=2`

**3.5** Add sort filter
- [x] Dropdown: "Alphabetical" | "Recently Added"
- [x] onChange → update URL param, trigger data refetch

**3.6** Add navigation link from home page
- [x] "Browse All Movies" button below search bar
- [x] Navigates to `/browse`

### Phase 4 — Movie Request System (UI) *(Complete)*

**4.1** Update AutocompleteDropdown for zero results
- [x] Detect `results.length === 0 && !isTooMany`
- [x] Show "We don't have that one yet!" message
- [x] Add text link: "Want us to look it up?"

**4.2** Implement request confirmation
- [x] On link click, show inline confirmation: "Okay, we'll check on that! We'll let you know when we find out who dies in this movie"
- [x] Call `POST /api/movies/request` with current search query

**4.3** Create `POST /api/movies/request` endpoint
- [x] Validate request body: `{ query: string }`
- [x] Validate query: not empty, max 200 chars, sanitize (strip HTML, trim)
- [x] Parse optional year from query (e.g., "matrix 1999" → title="matrix", year=1999)
- [x] Check if movie already exists (filtered by year if present): `await prisma.movie.findFirst({ where: { title: { equals: searchTitle, mode: 'insensitive' }, ...(year ? { year } : {}) } })`
  - If found: return `{ success: true, existingMovie: movie }`
- [x] Check for duplicate pending/processing queue entries
- [x] Insert into ingestion_queue: `status: 'pending'`, `year: searchYear`
- [x] Return `{ success: true, message: "Request queued" }` immediately (non-blocking — LLM validation deferred to worker)

**4.4** Add error handling
- [x] API errors: return structured error response with 400/500 status
- [x] Client errors: show error state with retry option in dropdown

### Phase 5 — Ingestion Worker *(Complete)*

**5.1** Extend Prisma schema with ingestion_queue table *(Pulled forward to Phase 4)*
- [x] Fields: id, query, status, tmdbId, createdAt, completedAt, failureReason
- [x] Run migration: `npx prisma migrate dev`

**5.2** Create worker script: `scripts/ingestion-worker.ts`
- [x] Main loop: while(true) { processQueue(); await sleep(30000); }
- [x] processQueue function:
  - SELECT job WHERE status='pending' ORDER BY createdAt ASC LIMIT 1
  - If no job, return
  - UPDATE status='processing'
  - Call processJob(job)

**5.3** Implement TMDB metadata fetching in processJob
- [x] **Step 1: Search for tmdbId**
- [x] **Step 2: Check processing queue** (deduplication by tmdbId)
- [x] **Step 3: Fetch full metadata via 3 parallel requests**
- [x] **Step 4: Extract director(s)**
- [x] **Step 5: Extract MPAA rating**
- [x] **Step 6: Transform to schema**
- [x] **Step 7: Rate limiting** (500ms delay)

**5.4** Implement death scraping
- [x] Source 1: List of Deaths fandom wiki via MediaWiki API (`https://listofdeaths.fandom.com/api.php`)
- [x] Source 2: Wikipedia plot summary via MediaWiki API (`https://en.wikipedia.org/w/api.php`)
- [x] Source 3: The Movie Spoiler (`https://themoviespoiler.com`)
- [x] If no deaths found, set `scrapedContent = ""` (will result in empty deaths array)

**5.5** Implement LLM extraction (shared module: `lib/llm.ts`)
- [x] Primary: Google Gemini 2.5 Flash via `@google/generative-ai` SDK (8s validation, 30s extraction timeout)
- [x] Fallback: Ollama streaming (30s inactivity timeout, 180s ceiling, up to 3 retries)
- [x] Parse LLM response: strip code fences, extract JSON array, repair common formatting errors
- [x] Validate each death record with field defaults and HTML entity decoding
- [x] If scraped content was empty, set `deaths = []` (valid zero-death movie)

**5.6** Implement database insert
- [x] Upsert movie record by `tmdbId` unique constraint
- [x] Delete existing deaths by `movieId` (actual FK, not `movieTmdbId` as in SPEC)
- [x] Bulk insert deaths with `movieId` foreign key
- [x] Update ingestion queue status to 'complete'

**5.7** Error handling & retries
- [x] TMDB: Exponential backoff retry (2s, 4s, 8s), max 3 attempts
- [x] Scraping: Try all 3 sources sequentially; if all fail, proceed with empty deaths
- [x] LLM: Retry up to 3 times with 30s timeout, JSON repair on each attempt
- [x] All errors caught at processJob level; job marked 'failed', worker continues

**5.8** Run worker as separate process
- [x] npm script: `"worker": "tsx scripts/ingestion-worker.ts"`
- [x] Environment variable validation at startup (DATABASE_URL, TMDB_API_KEY)
- [x] Graceful shutdown on SIGINT/SIGTERM

### Phase 6 — Notification System *(Complete)*

**6.1** Implement `GET /api/notifications/poll` endpoint
- [x] Query: `await prisma.movie.findMany({ where: { createdAt: { gte: new Date(Date.now() - 24*60*60*1000) } }, select: { tmdbId, title, createdAt }, orderBy: { createdAt: 'desc' } })`
- [x] Return array of recent movies

**6.2** Create NotificationBell component
- [x] Fixed position: `fixed top-4 right-4 z-50`
- [x] Bell icon button with badge (if unread > 0)
- [x] Dropdown with last 5 notifications
- [x] "Mark all as read" button

**6.3** Implement polling logic
- [x] useEffect: start interval on mount (60 seconds)
- [x] On interval: call `/api/notifications/poll`
- [x] Compare results with localStorage `seenNotifications`
- [x] New movies → add to notification list, increment badge
- [x] Store in component state: `notifications: { tmdbId, title, createdAt, isRead }[]`

**6.4** Implement notification interactions
- [x] Click notification → navigate to `/movie/[tmdbId]`, mark as read (add to localStorage), remove from list
- [x] "Mark all as read" → add all current tmdbIds to localStorage, clear badge, empty list

**6.5** Add NotificationBell to root layout
- [x] Import in `app/layout.tsx`
- [x] Render above main content (fixed position)

**6.6** localStorage persistence
- [x] Key: `seenNotifications` (array of tmdbIds)
- [x] Load on mount, update on mark as read

### Phase 7 — Polish *(Complete)*

**7.1** Input validation & sanitization
- [x] Search query: max 200 chars, strip HTML (`DOMPurify` or regex), trim
- [x] API routes: validate all query/body params, return 400 if invalid
- [x] XSS prevention: rely on React's default escaping + sanitize on API input

**7.2** Error handling
- [x] Wrap all API routes in try/catch, return structured errors
- [x] Add React Error Boundary component wrapping app content
- [x] Network failure toast: "Something went wrong. Please try again."
- [x] Image load failure: fallback gray placeholder with movie icon

**7.3** Loading states
- [x] Search: show spinner icon in search input during debounce
- [x] Movie detail: full-page skeleton while server component loads
- [x] Death reveal: skeleton grid (already implemented in Phase 2)
- [x] Notification polling: silent (no visible loading)

**7.4** Responsive QA
- [x] Test at 375px, 768px, 1280px
- [x] Verify death card grid: 1 col mobile, 2 cols desktop
- [x] Verify browse grid: 2-4-5 cols at different breakpoints
- [x] Verify search dropdown doesn't overflow viewport

**7.5** Visual QA
- [x] Compare all components against Figma screenshots
- [x] Verify color tokens match Section 2.1
- [x] Verify typography matches Section 2.2
- [x] Check all animations work as specified

**7.6** Accessibility testing
- [x] Keyboard navigation: Tab through all interactive elements
- [x] Arrow key navigation in autocomplete dropdown
- [x] Enter key selects dropdown item
- [x] Focus indicators visible on all interactive elements
- [x] Color contrast check: run axe DevTools

---

## 6. Database Schema

### Prisma Schema

```prisma
model Movie {
  id         Int      @id @default(autoincrement())
  tmdbId     Int      @unique
  title      String
  year       Int
  director   String
  tagline    String?
  posterPath String?
  runtime    Int
  mpaaRating String
  deaths     Death[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([title])
  @@index([createdAt])
}

model Death {
  id          Int     @id @default(autoincrement())
  character   String
  timeOfDeath String
  cause       String
  killedBy    String
  context     String
  isAmbiguous Boolean @default(false)
  movie       Movie   @relation(fields: [movieId], references: [id], onDelete: Cascade)
  movieId     Int

  @@index([movieId])
}

model IngestionQueue {
  id            Int       @id @default(autoincrement())
  query         String
  status        String    // 'pending' | 'processing' | 'complete' | 'failed'
  tmdbId        Int?
  failureReason String?
  createdAt     DateTime  @default(now())
  completedAt   DateTime?

  @@index([status, createdAt])
  @@index([tmdbId, status])
}
```

> **Note**: The schema above matches the actual `prisma/schema.prisma` implementation. Key differences from the original spec draft: (1) `Movie.id` is an auto-increment PK with `tmdbId` as a `@unique` constraint, (2) `Death` links via `movieId` → `Movie.id` (not `movieTmdbId`), (3) `director`, `runtime`, and `mpaaRating` are required (not nullable).

### Seed Data Files

**data/seed-movies.json** (provided by user, 100 movies)
```json
[
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
]
```

**data/seed-deaths.json** (provided by user, manually curated)
```json
[
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
]
```

---

## 7. Edge Cases

### 7.1 Concurrent Movie Requests

**Scenario**: Two users request the same movie simultaneously

**Handling**:
- Both requests add to ingestion_queue (allowed)
- Worker picks up first request, updates status to 'processing', stores tmdbId
- Worker picks up second request, checks for existing 'processing' job with same tmdbId
- If found: logs "Movie already processing", marks second job 'complete', returns
- Only one movie record created in database
- Both users receive notification when movie is added

### 7.2 TMDB Multiple Matches

**Scenario**: TMDB search returns multiple movies (e.g., "The Batman" 1989 vs 2022)

**Handling**:
- Take first result from TMDB response
- Log other matches to console for debugging
- User can request specific version later if needed (e.g., "The Batman 2022")

### 7.3 Worker Failures

**Scenario**: TMDB API down, scraping fails, LLM timeout

**Handling**:
- TMDB failure: retry with exponential backoff (wait 2s, 4s, 8s), max 3 attempts
- Scraping failure: log error with URL, mark job 'failed' with reason
- LLM timeout: retry once with 10-second timeout, mark 'failed' if still timeout
- All failures: console.log detailed error, keep worker running (don't crash)
- Failed jobs stay in queue for manual inspection/retry

### 7.4 Non-English Movie Titles

**Scenario**: User searches for "Parasite" (Korean title: 기생충)

**Handling**:
- LLM validation: validate query as-is, no transliteration
- TMDB lookup: search with user's query, TMDB handles internationalization
- If no results: mark as 'failed'
- User can try alternate title (e.g., "Parasite 2019")

### 7.5 Movies in Queue vs Movies in Database

**Scenario**: User searches for movie that's in ingestion_queue but not yet in main movies table

**Handling**:
- Autocomplete search only queries main `movies` table
- Movies in queue don't appear in search results
- User sees "We don't have that one yet!" and can re-request (duplicate allowed)
- Only show movies on browse page after they're in main `movies` table
- This prevents showing incomplete/processing movies to users

### 7.6 Zero Deaths Movies

**Scenario**: Movie has no character deaths (e.g., "La La Land", "Soul")

**Handling**:
- Scraper finds no deaths → set `deaths = []`
- Worker still inserts movie record with empty deaths array
- Movie detail page shows "No deaths! Everyone survives! 🥳" message
- No "Reveal Deaths" button shown (nothing to reveal)
- Valid movie entry in database

### 7.7 localStorage Quota Exceeded

**Scenario**: User has too many notifications stored in localStorage

**Handling**:
- Only store tmdbIds in `seenNotifications` array (minimal data)
- Auto-prune entries older than 7 days on each write
- If quota still exceeded: catch exception, clear localStorage, continue
- Notification system degrades gracefully (shows all recent movies as "new")

### 7.8 Notification Polling Failure

**Scenario**: `/api/notifications/poll` endpoint fails (network error, server down)

**Handling**:
- Catch fetch errors silently (don't show error to user)
- Log error to console for debugging
- Continue polling on next interval (60 seconds)
- User may miss notifications temporarily, but system recovers on next successful poll

## Environment Variables

| Variable                      | Example                                                    | Required      |
| ----------------------------- | ---------------------------------------------------------- | ------------- |
| `DATABASE_URL`                | `postgresql://user:pass@localhost:5432/whodiesinthismovie` | Yes           |
| `TMDB_API_KEY`                | `Bearer eyJhbGc...` (bearer token from TMDB)               | Yes           |
| `NEXT_PUBLIC_TMDB_IMAGE_BASE` | `https://image.tmdb.org/t/p`                               | Yes           |
| `GEMINI_API_KEY`              | `AIzaSy...` (from Google AI Studio)                        | No (primary LLM, falls back to Ollama) |
| `OLLAMA_ENDPOINT`             | `http://localhost:11434`                                   | No (fallback LLM) |
| `OLLAMA_MODEL`                | `mistral`                                                  | No (defaults to mistral) |
| `SENTRY_DSN`                  | `https://xxx@sentry.io/xxx`                                | No (optional) |
| `NEXT_PUBLIC_SENTRY_DSN`      | Same as above for client-side                              | No (optional) |

**Setup Notes:**
- Get TMDB API key (bearer token): https://www.themoviedb.org/settings/api
- Get Gemini API key (primary LLM): https://aistudio.google.com/apikey
- Ollama fallback (optional): Install from https://ollama.ai/download, pull Mistral: `ollama pull mistral`
- Verify Ollama is running: `curl http://localhost:11434/api/tags`
