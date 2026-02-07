import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Types matching the JSON seed data format
interface SeedMovie {
  tmdbId: number;
  title: string;
  year: number;
  director: string;
  tagline: string | null;
  posterPath: string | null;
  runtime: number;
  mpaaRating: string;
}

interface SeedDeath {
  character: string;
  timeOfDeath: string;
  cause: string;
  killedBy: string;
  context: string;
  isAmbiguous: boolean;
}

interface SeedDeathEntry {
  movieTitle: string;
  tmdbId: number;
  deaths: SeedDeath[];
}

function loadJson<T>(filename: string): T {
  const filePath = path.join(__dirname, "..", "data", filename);
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

async function seedMovies(movies: SeedMovie[]): Promise<number> {
  let upserted = 0;

  for (const movie of movies) {
    await prisma.movie.upsert({
      where: { tmdbId: movie.tmdbId },
      update: {
        title: movie.title,
        year: movie.year,
        director: movie.director,
        tagline: movie.tagline,
        posterPath: movie.posterPath,
        runtime: movie.runtime,
        mpaaRating: movie.mpaaRating,
      },
      create: {
        tmdbId: movie.tmdbId,
        title: movie.title,
        year: movie.year,
        director: movie.director,
        tagline: movie.tagline,
        posterPath: movie.posterPath,
        runtime: movie.runtime,
        mpaaRating: movie.mpaaRating,
      },
    });
    upserted++;
  }

  return upserted;
}

async function seedDeaths(deathEntries: SeedDeathEntry[]): Promise<number> {
  let totalDeaths = 0;

  for (const entry of deathEntries) {
    // Find the movie by tmdbId
    const movie = await prisma.movie.findUnique({
      where: { tmdbId: entry.tmdbId },
    });

    if (!movie) {
      console.warn(
        `  ⚠ Movie not found for tmdbId ${entry.tmdbId} ("${entry.movieTitle}") — skipping deaths`
      );
      continue;
    }

    // Delete existing deaths for this movie (replace strategy)
    const deleted = await prisma.death.deleteMany({
      where: { movieId: movie.id },
    });
    if (deleted.count > 0) {
      console.log(
        `  ↻ Replaced ${deleted.count} existing deaths for "${entry.movieTitle}"`
      );
    }

    // Create new deaths
    if (entry.deaths.length > 0) {
      await prisma.death.createMany({
        data: entry.deaths.map((death) => ({
          movieId: movie.id,
          character: death.character,
          timeOfDeath: death.timeOfDeath,
          cause: death.cause,
          killedBy: death.killedBy,
          context: death.context,
          isAmbiguous: death.isAmbiguous,
        })),
      });
      totalDeaths += entry.deaths.length;
      console.log(
        `  ✓ Added ${entry.deaths.length} deaths for "${entry.movieTitle}"`
      );
    } else {
      console.log(`  ✓ "${entry.movieTitle}" — no deaths (zero-death movie)`);
    }
  }

  return totalDeaths;
}

async function main() {
  console.log("🎬 Seeding database...\n");

  // Load seed data
  console.log("Loading seed data...");
  const movies = loadJson<SeedMovie[]>("seed-movies.json");
  const deathEntries = loadJson<SeedDeathEntry[]>("seed-deaths.json");
  console.log(
    `  Found ${movies.length} movies, ${deathEntries.length} death entries\n`
  );

  // Seed movies
  console.log("Seeding movies...");
  const movieCount = await seedMovies(movies);
  console.log(`  ✓ Upserted ${movieCount} movies\n`);

  // Seed deaths
  console.log("Seeding deaths...");
  const deathCount = await seedDeaths(deathEntries);
  console.log(`\n  ✓ Total deaths seeded: ${deathCount}\n`);

  // Summary
  const totalMovies = await prisma.movie.count();
  const totalDeaths = await prisma.death.count();
  console.log("📊 Database summary:");
  console.log(`  Movies: ${totalMovies}`);
  console.log(`  Deaths: ${totalDeaths}`);
  console.log("\n✅ Seeding complete!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ Seeding failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
