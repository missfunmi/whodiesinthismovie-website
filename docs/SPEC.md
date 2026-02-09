# Technical Specification: Who Dies in This Movie?

> **Domain**: whodiesinthismovie.com
> **Timeline**: 48-hour MVP build
> **Audience**: Internal/friendly demo

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Design System Reference](#2-design-system-reference)
3. [Implementation Plan](#3-implementation-plan)
4. [Specific Tasks](#4-specific-tasks)
5. [Database Schema](#5-database-schema)

---

## 1. Architecture Overview

### 1.1 Tech Stack

| Layer     | Technology               | Purpose                                              |
| --------- | ------------------------ | ---------------------------------------------------- |
| Framework | Next.js 14+ (App Router) | SSR, routing, API routes                             |
| Language  | TypeScript               | Type safety                                          |
| Styling   | Tailwind CSS             | Utility-first CSS                                    |
| Database  | PostgreSQL 15+           | Persistent data store                                |
| ORM       | Prisma                   | Type-safe database queries                           |
| Images    | next/image + TMDB CDN    | Optimized poster loading                             |
| LLM       | Ollama + Llama 3.2 3B    | Easter egg RAG queries (via external Python service) |
| Logging   | Sentry                   | Error tracking                                       |
| Hosting   | Vercel                   | Deployment target                                    |

### 1.2 System Architecture

```
                    ┌─────────────────────────────────────────┐
                    │              Browser                     │
                    └──────────┬──────────────────┬───────────┘
                               │                  │
                    Standard Search          "!!" Easter Egg
                               │                  │
                    ┌──────────▼──────────┐ ┌─────▼───────────┐
                    │  /api/movies/search  │ │ /api/smart-search│
                    │  /api/movies/[tmdbId]│ └─────┬───────────┘
                    └──────────┬──────────┘       │
                               │            ┌─────▼───────────┐
                    ┌──────────▼──────────┐ │ Python RAG Svc  │
                    │    Prisma ORM        │ │ localhost:8000   │
                    └──────────┬──────────┘ └─────┬───────────┘
                               │                  │
                    ┌──────────▼──────────┐ ┌─────▼───────────┐
                    │    PostgreSQL        │ │ Ollama + Llama  │
                    └─────────────────────┘ │ ChromaDB         │
                                            └─────────────────┘
```

### 1.3 Route Structure

**Pages (App Router)**

| Route             | Component                     | Description                                                        |
| ----------------- | ----------------------------- | ------------------------------------------------------------------ |
| `/`               | `app/page.tsx`                | Welcome page with search bar, poster background, rotating taglines |
| `/movie/[tmdbId]` | `app/movie/[tmdbId]/page.tsx` | Movie detail with death reveal                                     |

**API Routes**

| Endpoint                       | Method | Description                                                                                 |
| ------------------------------ | ------ | ------------------------------------------------------------------------------------------- |
| `/api/movies/search?q={query}` | GET    | Search movies by title. Returns max 8 results. If >100 matches, returns `{ tooMany: true }` |
| `/api/movies/[tmdbId]`         | GET    | Get movie metadata + all deaths                                                             |
| `/api/smart-search`            | POST   | Forward natural language query to RAG service. Body: `{ query: string }`                    |

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

**Easter Egg Flow**
1. User types `!!` prefix (e.g., `!! does jack die in titanic?`)
2. Client detects prefix, suppresses autocomplete dropdown
3. User presses Enter → client calls `POST /api/smart-search` with `{ query: "does jack die in titanic?" }`
4. API route proxies to Python RAG service at `http://localhost:8000/query` (5s timeout)
5. Returns natural language answer; client renders purple gradient card

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
- `useState` for component-level state (search query, dropdown visibility, death reveal toggle)
- `useEffect` for debounced search, tagline rotation, poster animation
- `useRef` for input focus management, animation timers

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

| Element                | Value                    | Notes                        |
| ---------------------- | ------------------------ | ---------------------------- |
| Death card background  | `#1F1F1F`                | Dark cards on detail page    |
| Ambiguous death card   | `#1F1F1F` at 50% opacity | Grayed-out appearance        |
| Easter egg gradient    | `#8B5CF6` → `#6D28D9`    | `bg-gradient-to-br` (violet) |
| Search focus ring      | Tailwind `blue-500`      | 4px ring width               |
| Dropdown selected item | Tailwind `blue-500` bg   | White text on selected       |
| Dropdown selected year | Tailwind `blue-100`      | Lighter on selected          |
| Warning text           | Tailwind `orange-500`    | "Too many matches"           |
| Search input bg        | `white` at 95% opacity   | `bg-white/95`                |
| Tagline text           | Tailwind `gray-300`      | On dark background           |
| Back button            | `white` at 80% opacity   | `hover:text-white`           |

**Movie Detail Page (Dark Theme)**

The movie detail page uses `bg-primary` (`#2c2b32`) as the page background. All text and UI elements on this page use light-on-dark colors instead of the core light-mode tokens:

| Element                                 | Value                           | Contrast on `#2c2b32` / `#1F1F1F` |
| --------------------------------------- | ------------------------------- | --------------------------------- |
| Page background                         | `#2c2b32` (`bg-primary`)        | —                                 |
| Primary text (titles, values)           | `white`                         | ≥15:1                             |
| Secondary text (labels, icons, context) | Tailwind `gray-400` (`#9CA3AF`) | ≥5:1 (AA)                         |
| Death card field values                 | Tailwind `gray-100` (`#F3F4F6`) | ≥12:1                             |
| Ambiguous card character name           | Tailwind `gray-300` (`#D1D5DB`) | ≥8:1                              |
| Borders (cards, header, dividers)       | `white` at 10% opacity          | Subtle on dark                    |
| Header background                       | `#2c2b32` at 80% opacity        | Matches page bg                   |
| Reveal button                           | `bg-white text-primary`         | High contrast                     |
| Skeleton loader                         | `white` at 10% opacity          | Subtle pulse on dark              |
| Poster placeholder                      | `white` at 10% opacity          | Matches dark theme                |
| Ambiguous section wrapper               | `white` at 5% opacity           | Subtle grouping                   |
| Question mark badge bg                  | `white` at 10% opacity          | Subtle on dark                    |

### 2.2 Typography

**Font Families**

| Role             | Font          | Weights       | Source       |
| ---------------- | ------------- | ------------- | ------------ |
| Headings (h1-h6) | Space Grotesk | 400, 500, 700 | Google Fonts |
| Body text        | Inter         | 400, 500, 600 | Google Fonts |

**Type Scale**

| Element               | Size (Desktop)                | Size (Mobile)     | Weight | Line Height |
| --------------------- | ----------------------------- | ----------------- | ------ | ----------- |
| Hero heading          | 56px (`text-[56px]`)          | 48px (`text-5xl`) | 700    | 1.1         |
| Movie title (detail)  | 48px (`text-5xl`)             | 36px (`text-4xl`) | 700    | 1.2         |
| Taglines              | 18-20px (`text-lg`/`text-xl`) | Same              | 400    | 1.5         |
| Character name (card) | 18px (`text-lg`)              | Same              | 700    | 1.4         |
| Body text             | 16px (`text-base`)            | Same              | 400    | 1.5         |
| Field labels (card)   | 14px (`text-sm`)              | Same              | 400    | 1.5         |
| Search placeholder    | 16px                          | Same              | 500    | —           |
| Year in dropdown      | 14px (`text-sm`)              | Same              | 400    | —           |

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

| Element               | Value | Tailwind Class       |
| --------------------- | ----- | -------------------- |
| Base radius (CSS var) | 10px  | `--radius: 0.625rem` |
| Search input          | 12px  | `rounded-xl`         |
| Dropdown              | 12px  | `rounded-xl`         |
| Easter egg card       | 12px  | `rounded-xl`         |
| Death cards           | 8px   | `rounded-lg`         |
| Buttons               | 6px   | `rounded-md`         |
| Poster thumbnails     | 4px   | `rounded`            |

**Layout Containers**

| Context                     | Max Width                   | Padding |
| --------------------------- | --------------------------- | ------- |
| Welcome/search page content | 768px (`max-w-3xl`)         | `px-4`  |
| Movie detail page           | 1280px (`max-w-7xl`)        | `px-4`  |
| Death card grid             | Full width within container | `gap-4` |

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
- `!!` prefix: set easter egg mode, suppress dropdown entirely
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
- Too many matches (>100): centered AlertCircle icon (`orange-500`, `w-8 h-8`) + "Too many matches - keep typing!" (`text-gray-700`)
- No results: centered "No movies found" (`text-gray-500`)

**Keyboard Navigation**:
- ArrowDown: move selection down (stop at last item)
- ArrowUp: move selection up (stop at first item)
- Enter: select highlighted item and navigate to detail page
- First item highlighted by default

**Constraints**: Maximum 8 results displayed

#### DeathCard (Confirmed Deaths)

```
Container:
  - bg-[#1F1F1F] rounded-lg p-6
  - border border-white/10
  - hover:translate-y-[-4px] hover:shadow-xl
  - transition-all duration-200

Character name: text-lg font-bold text-white mb-4

Fields (3 rows, each with icon + label + value):
  - Icon: w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5
  - Layout: flex items-start gap-3
  - Label: text-sm text-gray-400
  - Value: text-base text-gray-100

  Row 1: Clock icon → "Time" → timeOfDeath
  Row 2: Skull icon → "Cause" → cause
  Row 3: Target icon → "By" → killedBy

Context section:
  - mt-4 pt-4 border-t border-white/10
  - text-sm text-gray-400
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

**Wrapper section**:
```
- rounded-lg border border-white/10 bg-white/5 p-6
- Section header: HelpCircle icon (text-gray-400) + "Ambiguous Deaths" (text-xl font-bold text-white)
- Same grid layout as confirmed deaths
```

#### EasterEggCard

```
Container:
  - mt-4 p-6 rounded-xl
  - bg-gradient-to-br from-[#8B5CF6] to-[#6D28D9]
  - backdrop-blur-md shadow-2xl

Layout: flex items-start gap-3

Icon: AlertCircle (lucide-react), w-6 h-6 text-white flex-shrink-0 mt-1
Answer text: text-white text-lg
Action link: mt-3 text-sm text-white hover:text-purple-100 underline
  - "Show full details →"
  - Links to /movie/[tmdbId] for the referenced movie
```

**Behavior**:
- Shown below search input (not a dropdown)
- Only appears after user presses Enter with `!!` prefix
- Loading spinner shown while awaiting RAG response (3-5s typical)

#### RevealButton

```
Before reveal:
  - Button: bg-white text-primary "See who dies in this movie"
  - ChevronDown icon, w-5 h-5 mr-2
  - text-lg px-8 py-6 shadow-lg hover:shadow-xl hover:bg-gray-100 transition-all
  - Centered: flex justify-center mb-8

Loading state (after click, before reveal):
  - Skeleton grid: 4 skeleton cards in 2x2 grid
  - Duration: 800ms

After reveal:
  - Count header above cards: "X characters died" (e.g., "12 characters died")
  - Button changes to: "Hide Deaths" with ChevronUp icon
  - Death cards grid appears below

Zero deaths:
  - Message: "No deaths! Everyone survives!" with party emoji
  - No button interaction needed (no cards to show)
```

#### MovieMetadata

```
Layout: flex flex-col md:flex-row gap-8 mb-12

Poster:
  - flex-shrink-0
  - w-full md:w-[300px] rounded-lg shadow-2xl

Metadata section:
  - flex-1
  - Title: text-4xl md:text-5xl font-bold mb-2 text-white
  - Year: text-xl text-gray-400 mb-4
  - Fields (space-y-3 mb-6):
    - Label: text-gray-400
    - Value: text-white
    - Shows: Director, Runtime (formatted as "Xh Ym"), Rating
  - Tagline: italic text-lg text-gray-400, in quotes
```

**Fields displayed**: poster, title, year, director, tagline, runtime, MPAA rating
**Fields NOT displayed**: budget, box office, full cast (per PRD)

#### PosterBackground

```
Container: absolute inset-0 overflow-hidden

Poster images:
  - 8 visible at a time
  - Each: 300px x 450px, object-cover, rounded-lg, shadow-2xl
  - NO rotation (posters stay upright) ← REFINEMENT
  - Crossfade in/out with 4-5s transition duration
  - opacity: 0.6
  - Positioned in a distributed grid pattern

Dark overlay:
  - absolute inset-0
  - bg-black/60 ← REFINEMENT (was bg-black/40 in Figma)
  - backdrop-blur-sm ← REFINEMENT (reduced from backdrop-blur-lg so poster details are visible)
```

**Poster Rotation Logic**:
- Maintain array of 8 currently-visible poster indices
- Every 4-5 seconds, fade out oldest poster, fade in next one
- Cycle through all available poster images

#### Header (Movie Detail Page)

```
Container:
  - border-b border-white/10
  - bg-primary/80 backdrop-blur-sm
  - sticky top-0 z-50

Inner:
  - max-w-7xl mx-auto px-4 py-4

Logo button:
  - text-xl font-bold
  - text-white hover:text-white/80
  - transition-colors
  - Navigates back to home/search
```

#### SkeletonLoader

```
Base: bg-white/10 rounded-lg animate-pulse
Layout: grid grid-cols-1 md:grid-cols-2 gap-4
Used in: death card loading (4x h-40 in 2x2 grid)
```

### 2.5 Animations

| Animation        | Trigger                | Duration    | Details                                                                                          |
| ---------------- | ---------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| Tagline rotation | Auto, every 4s         | 600ms       | 5 variants: slideLeft, slideRight, fadeScale, blur, typewriter. Random selection per transition. |
| Poster crossfade | Auto, every 4-5s       | 4-5s        | Fade opacity 0→0.6→0. No rotation. Staggered across 8 poster slots.                              |
| Death card hover | Mouse enter            | 200ms       | `translate-y-[-4px]` + `shadow-xl`. `transition-all duration-200`                                |
| Reveal loading   | Click reveal button    | 800ms       | 4 skeleton cards pulse, then replaced by actual death cards                                      |
| Dropdown appear  | Search results change  | CSS default | No explicit animation — instant show/hide                                                        |
| Easter egg card  | Enter key in `!!` mode | CSS default | Appears below search input                                                                       |

**Tagline Animation Keyframes** (defined in component `<style>` tag):

```css
/* slideLeft */
@keyframes slideInLeft { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slideOutRight { from { transform: translateX(0); opacity: 1; } to { transform: translateX(100%); opacity: 0; } }

/* slideRight */
@keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
@keyframes slideOutLeft { from { transform: translateX(0); opacity: 1; } to { transform: translateX(-100%); opacity: 0; } }

/* fadeScale */
@keyframes fadeScaleIn { from { transform: scale(0.8); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes fadeScaleOut { from { transform: scale(1); opacity: 1; } to { transform: scale(0.8); opacity: 0; } }

/* blur */
@keyframes blurIn { from { filter: blur(10px); opacity: 0; } to { filter: blur(0); opacity: 1; } }
@keyframes blurOut { from { filter: blur(0); opacity: 1; } to { filter: blur(10px); opacity: 0; } }

/* typewriter */
@keyframes typewriter { from { width: 0; } to { width: 100%; } }
/* timing-function: steps(40) */
```

**Tagline Container**: Fixed height `h-20` (80px) to prevent layout shift during transitions.

### 2.6 Accessibility Requirements

| Requirement         | Implementation                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Color contrast      | WCAG AA (4.5:1 body text, 3:1 large text). All text/background combos verified.                            |
| Keyboard navigation | Arrow keys for dropdown, Enter to select, Tab for focus traversal                                          |
| Focus indicators    | `focus-visible:ring-[3px]` with `ring-ring/50` on interactive elements                                     |
| Screen reader       | Semantic HTML (`<button>`, `<nav>`, `<main>`), ARIA labels on icon-only elements, `alt` text on all images |
| Touch targets       | Minimum 44x44px on all interactive elements (search input 80px, buttons py-6, list items p-4)              |
| Reduced motion      | Respect `prefers-reduced-motion` for tagline/poster animations                                             |
| Form labels         | Search input has accessible label (visually hidden if needed)                                              |

### 2.7 Technical Constraints vs. Figma

| Figma Design                         | Constraint                                         | Resolution                                                                                               |
| ------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Background poster rotation angles    | User refinement: remove rotation                   | Posters stay upright, crossfade only                                                                     |
| 40% black overlay                    | User refinement: increase to 60%                   | `bg-black/60` + `backdrop-blur-lg` for text readability                                                  |
| Autocomplete after Enter             | User refinement: trigger on typing                 | Debounced fetch at 3+ chars, no Enter required                                                           |
| Reveal button shows count            | User refinement: hide count before reveal          | Button says "See who dies in this movie"; count shown as header after reveal                             |
| No empty state for search            | User refinement: add message                       | "No movies found" in dropdown when 0 results                                                             |
| Tagline typewriter animation         | `steps(40)` may cause jank on variable-length text | Use `ch` units for width if possible, or fall back to fadeScale for long taglines                        |
| Heavy backdrop blur on home page     | User refinement: poster details invisible          | Reduced from `backdrop-blur-lg` to `backdrop-blur-sm` (4px) — poster imagery visible through 60% overlay |
| White page background on detail page | User refinement: inconsistent with dark home page  | Movie detail page uses `bg-primary` (`#2c2b32`) dark background                                          |
| Dark text on dark death cards        | User refinement: unreadable contrast               | All detail page text uses light-on-dark colors: `text-white`, `text-gray-100`, `text-gray-400`           |

---

## 3. Implementation Plan

### PHASE 1 — Foundation

**Goal**: Working API with seeded database. Demo-able via curl/Postman.

- Initialize Next.js project with TypeScript + Tailwind CSS (App Router)
- Install dependencies: `prisma`, `@prisma/client`, `lucide-react`, `@sentry/nextjs`
- Configure Tailwind with design tokens from Section 2 (colors, fonts, radius)
- Configure `next.config.ts` with TMDB image remote pattern
- Define Prisma schema (`Movie`, `Death` models — see Section 5)
- Run initial Prisma migration to create tables
- Write database seed script (`prisma/seed.ts`):
  - Reads `data/seed-movies.json` and `data/seed-deaths.json`
  - Upserts movies by `tmdbId` (idempotent — safe to re-run when JSON files are updated)
  - Creates/replaces death records for each movie
  - Configure `prisma.seed` in `package.json`
- Implement `GET /api/movies/search?q={query}`:
  - Validates query param exists and is 3+ chars
  - Case-insensitive partial match: `title: { contains: query, mode: 'insensitive' }`
  - If >100 results: return `{ tooMany: true, count: N }`
  - Otherwise: return max 8 results `{ tmdbId, title, year, posterPath }`
- Implement `GET /api/movies/[tmdbId]`:
  - Fetch movie with `include: { deaths: true }`
  - 404 if not found
  - Return full movie object with deaths array
- Set up Sentry (basic `Sentry.init` in instrumentation hook)
- Add Google Fonts (Space Grotesk + Inter) in `app/layout.tsx`

### PHASE 2 — Core UI

**Goal**: Fully functional search-to-detail flow. Demo-able in browser.

- **Welcome page** (`app/page.tsx`):
  - Full-viewport poster background with crossfade animation (Section 2.4: PosterBackground)
  - "Who Dies in This Movie?" hero heading (Space Grotesk, 56px desktop / 48px mobile)
  - Rotating taglines below heading (10 taglines from PRD, Section 2.5 animations)
  - Search bar centered below taglines (Section 2.4: SearchInput)

- **Search autocomplete**:
  - Client component with debounced API calls (300ms)
  - Dropdown rendering per Section 2.4: AutocompleteDropdown
  - Poster thumbnail + title + year in each result row
  - Keyboard navigation (ArrowUp/Down/Enter)
  - "Too many matches" and "No movies found" states
  - `!!` prefix detection → suppress dropdown, enable easter egg mode

- **Movie detail page** (`app/movie/[tmdbId]/page.tsx`):
  - Server component for initial data fetch
  - Header with logo/back button (Section 2.4: Header)
  - Movie metadata layout (Section 2.4: MovieMetadata)
  - Poster (300px on desktop, full-width on mobile) + metadata side-by-side on desktop

- **Death reveal system** (client component):
  - "See who dies in this movie" button (Section 2.4: RevealButton)
  - Click → 800ms skeleton loading → reveal death cards
  - Count header: "X characters died" shown above cards after reveal
  - Death card grid (Section 2.4: DeathCard)
  - Ambiguous deaths section below confirmed deaths (Section 2.4: AmbiguousDeathCard)
  - "No deaths! Everyone survives!" message for zero-death movies

### PHASE 3 — RAG Integration

**Goal**: Easter egg `!!` search works end-to-end. Demo-able with prepared queries.

**Prerequisite**: Python RAG service running on `localhost:8000` (separate project, not built here)

- Detect `!!` prefix in search input component
- When `!!` is detected: suppress autocomplete, show no dropdown
- On Enter key with `!!` prefix:
  - Strip `!!` from query
  - Show loading spinner below search input
  - Call `POST /api/smart-search` with `{ query: "stripped query text" }`
- Implement `POST /api/smart-search`:
  - Extract query from request body
  - Forward to `http://localhost:8000/query` via `fetch` with 5-second `AbortController` timeout
  - On success: return RAG response `{ answer: string, movieTmdbId?: number }`
  - On timeout: return `{ error: "The oracle is thinking too hard... try again?" }`
  - On connection refused: return `{ error: "Smart search is offline right now" }`
- Render easter egg response card (Section 2.4: EasterEggCard)
  - Purple gradient card with answer text
  - "Show full details →" link if `movieTmdbId` is present → navigates to `/movie/[tmdbId]`
- Error state: show friendly message in same card style but muted colors

### PHASE 4 — Polish

**Goal**: Production-quality MVP. Demo-ready for friendly audience.

- **Input validation & sanitization**:
  - Search query: max 200 chars, strip HTML tags, trim whitespace
  - API routes: validate query params, return proper 400/404/500 responses
  - Prevent XSS via React's default escaping + explicit sanitization on API input

- **Error handling**:
  - API error boundaries: try/catch in all route handlers, structured error responses
  - Client error boundaries: React Error Boundary component wrapping main content
  - Network failure: show "Something went wrong" with retry option
  - Image load failure: fallback poster placeholder

- **Loading states**:
  - Search: subtle loading indicator during debounce
  - Movie detail: full-page skeleton while server component loads
  - Death reveal: skeleton grid (already in Phase 2)
  - Easter egg: spinner with "Consulting the oracle..." text

- **Responsive QA**:
  - Test at 375px (mobile), 768px (tablet), 1280px+ (desktop)
  - Verify poster background readability at all widths
  - Verify death card grid collapses to single column on mobile
  - Verify movie detail poster stacks above metadata on mobile

- **Visual QA against Figma**:
  - Compare each component against Figma screenshots
  - Verify all design token values match Section 2
  - Check all refinements are applied (overlay, poster rotation, reveal button text)
  - Verify animation timing and behavior

- **Accessibility testing**:
  - Keyboard-only navigation through entire flow (Tab, Enter, Arrow keys)
  - VoiceOver walkthrough on macOS
  - Color contrast spot check with browser DevTools

---

## 4. Specific Tasks

### Phase 1 — Foundation

- [ ] **P1.1**: Initialize Next.js project with `create-next-app` (TypeScript, Tailwind, App Router, ESLint). Configure `next.config.ts` with TMDB image domain. Add Google Fonts in layout.
- [ ] **P1.2**: Configure Tailwind theme — add design tokens: custom colors (`primary`, `muted`, `border`), font families (Space Grotesk, Inter), border radius scale. Set up CSS variables in `globals.css`.
- [ ] **P1.3**: Define Prisma schema with `Movie` and `Death` models (see Section 5). Run `npx prisma migrate dev --name init` to create tables.
- [ ] **P1.4**: Write seed script (`prisma/seed.ts`) that reads both JSON files from `data/`, upserts movies by `tmdbId`, deletes + recreates deaths per movie. Add `prisma.seed` to `package.json`. Test with `npx prisma db seed`.
- [ ] **P1.5**: Implement `GET /api/movies/search` — query validation, Prisma `findMany` with `contains`/`insensitive`, >100 check, max 8 limit. Test with curl.
- [ ] **P1.6**: Implement `GET /api/movies/[tmdbId]` — Prisma `findUnique` with deaths included, 404 handling. Test with curl.
- [ ] **P1.7**: Set up Sentry (`@sentry/nextjs`) — basic init in `instrumentation.ts`, test error capture.

### Phase 2 — Core UI

- [ ] **P2.1**: Build welcome page layout — full-viewport container, hero heading, tagline container (fixed 80px height). Build PosterBackground component with 8 upright poster slots, crossfade animation (4-5s), 60% black overlay + heavy blur.
- [ ] **P2.2**: Build rotating taglines component — 10 taglines from PRD, 4s interval, 5 animation variants (slideLeft, slideRight, fadeScale, blur, typewriter), random variant selection per rotation.
- [ ] **P2.3**: Build SearchInput component — styled per spec, autoFocus, 16px font to prevent iOS zoom. Wire up debounced API call (300ms) on input change at 3+ chars. Handle "the" exclusion.
- [ ] **P2.4**: Build AutocompleteDropdown component — render up to 8 results with poster thumbnail + title + year. Implement keyboard navigation (ArrowUp/Down/Enter). Handle states: results, "too many matches", "no movies found". Wire click/Enter to navigate to `/movie/[tmdbId]`.
- [ ] **P2.5**: Build movie detail page — server component data fetch, Header component with back navigation, MovieMetadata layout (poster left + metadata right on desktop, stacked on mobile). Display title, year, director, runtime, rating, tagline.
- [ ] **P2.6**: Build death reveal system — "See who dies in this movie" button, 800ms skeleton loading, count header ("X characters died"), DeathCard grid (2-col desktop, 1-col mobile). Handle zero deaths with "No deaths! Everyone survives!" message.
- [ ] **P2.7**: Build AmbiguousDeathCard component + section — grayed-out cards with `?` badge, separate "Ambiguous Deaths" section below confirmed deaths with HelpCircle icon header.

### Phase 3 — RAG Integration

- [ ] **P3.1**: Add `!!` prefix detection in search input — suppress autocomplete dropdown, toggle easter egg mode state. Strip `!!` prefix on Enter press and prepare query.
- [ ] **P3.2**: Implement `POST /api/smart-search` — request body validation, forward to `http://localhost:8000/query` with 5s AbortController timeout, handle timeout/connection errors with friendly messages.
- [ ] **P3.3**: Build EasterEggCard component — purple gradient card, loading spinner state ("Consulting the oracle..."), answer display, "Show full details →" link. Wire to `/movie/[tmdbId]` navigation.

### Phase 4 — Polish

- [ ] **P4.1**: Add input validation — search max 200 chars, HTML tag stripping, API route param validation with proper 400/404/500 responses. Add React Error Boundary wrapper.
- [ ] **P4.2**: Add loading states — search indicator during debounce, movie detail page skeleton, image load fallback. Add error recovery UI ("Something went wrong, try again").
- [ ] **P4.3**: Responsive QA — test at 375px/768px/1280px+. Fix any layout issues with poster background, death card grid, movie detail layout. Ensure touch targets ≥ 44px.
- [ ] **P4.4**: Accessibility pass — keyboard-only navigation test (full flow), VoiceOver walkthrough, ARIA labels on icon buttons, color contrast check, `prefers-reduced-motion` support for animations.
- [ ] **P4.5**: Visual QA — compare each page/component against Figma prototype. Verify all design refinements are applied. Fix any visual discrepancies.

---

## 5. Database Schema

### Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Movie {
  id         Int      @id @default(autoincrement())
  tmdbId     Int      @unique
  title      String
  year       Int
  director   String
  tagline    String?
  posterPath String
  runtime    Int
  mpaaRating String
  deaths     Death[]
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@index([title])
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
```

### Seed Data Format

**`data/seed-movies.json`**
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

**`data/seed-deaths.json`**
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

### Environment Variables

| Variable                      | Example                                                    | Required      |
| ----------------------------- | ---------------------------------------------------------- | ------------- |
| `DATABASE_URL`                | `postgresql://user:pass@localhost:5432/whodiesinthismovie` | Yes           |
| `NEXT_PUBLIC_TMDB_IMAGE_BASE` | `https://image.tmdb.org/t/p`                               | Yes           |
| `RAG_SERVICE_URL`             | `http://localhost:8000`                                    | No (Phase 3)  |
| `SENTRY_DSN`                  | `https://xxx@sentry.io/xxx`                                | No (optional) |
| `NEXT_PUBLIC_SENTRY_DSN`      | Same as above for client-side                              | No (optional) |
