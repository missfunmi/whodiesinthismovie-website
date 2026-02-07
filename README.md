# Who Dies in This Movie?

Look up a movie and find out which characters die — when, how, and by whose hand. Because sometimes knowing is better than wondering.

**Live site**: [whodiesinthismovie.com](https://whodiesinthismovie.com) (coming soon)

## Tech Stack

- **Next.js 14+** (App Router) with TypeScript
- **Tailwind CSS** for styling
- **PostgreSQL** with Prisma ORM
- **Sentry** for error tracking

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 15+
- **npm** or **yarn**

## Getting Started

### 1. Clone the repository

```bash
git clone <repo-url>
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

Edit `.env` with your values:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/whodiesinthismovie"
NEXT_PUBLIC_TMDB_IMAGE_BASE="https://image.tmdb.org/t/p"
SENTRY_DSN=""                              # Optional: for error tracking
```

### 4. Set up the database

```bash
npx prisma migrate dev
npx prisma db seed
```

### 5. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

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

## Project Structure

```
whodiesinthismovie-website/
├── app/                        # Next.js App Router pages and API routes
│   ├── page.tsx                # Home page (search + poster background)
│   ├── movie/[tmdbId]/         # Movie detail page
│   └── api/                    # API route handlers
├── components/                 # Shared React components
├── lib/                        # Utility modules (Prisma client, helpers)
├── prisma/                     # Database schema and seed script
├── data/                       # Seed data JSON files
│   ├── seed-movies.json        # Movie metadata
│   └── seed-deaths.json        # Character death data per movie
├── docs/                       # Documentation
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

## Environment Variables

| Variable                      | Required | Description                  |
| ----------------------------- | -------- | ---------------------------- |
| `DATABASE_URL`                | Yes      | PostgreSQL connection string |
| `NEXT_PUBLIC_TMDB_IMAGE_BASE` | Yes      | TMDB image CDN base URL      |
