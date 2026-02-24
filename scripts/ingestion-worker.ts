/**
 * Ingestion Worker
 *
 * Processes ONE pending job from the IngestionQueue, then exits.
 *
 * In production, invoked every 15 minutes by GitHub Actions
 * (.github/workflows/process-ingestion-queue.yml). For local development,
 * run manually or set up a cron job / watch loop:
 *
 *   npm run worker          # process one job and exit
 *   watch -n 30 npm run worker  # re-run every 30 seconds locally
 *
 * Processing logic lives in lib/ingestion.ts.
 */

import { config as dotenvConfig } from "dotenv";
// Load env vars — tries .env first, then .env.development.local (Next.js convention)
dotenvConfig();
dotenvConfig({ path: ".env.development.local", override: false });
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { processQueue } from "../lib/ingestion.js";
import type { LlmConfig } from "../lib/llm.js";

// ---------------------------------------------------------------------------
// Environment validation
// ---------------------------------------------------------------------------

function validateEnv(): {
  databaseUrl: string;
  tmdbApiKey: string;
  llmConfig: LlmConfig;
} {
  const databaseUrl = process.env.DATABASE_URL;
  const tmdbApiKey = process.env.TMDB_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const geminiModel = process.env.GEMINI_MODEL || undefined;

  if (!databaseUrl) {
    console.error("[worker] Missing DATABASE_URL environment variable");
    process.exit(1);
  }
  if (!tmdbApiKey) {
    console.error("[worker] Missing TMDB_API_KEY environment variable");
    process.exit(1);
  }

  return {
    databaseUrl,
    tmdbApiKey,
    llmConfig: { geminiApiKey, geminiModel },
  };
}

// ---------------------------------------------------------------------------
// Prisma client (standalone — same pattern as prisma/seed.ts)
// ---------------------------------------------------------------------------

function createPrisma(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = validateEnv();
  const prisma = createPrisma(config.databaseUrl);

  console.log("[worker] Ingestion worker starting...");
  console.log("[worker] Config:");
  console.log(
    `  Database: ${config.databaseUrl.replace(/:[^@]+@/, ":***@")}`,
  );
  console.log(
    `  TMDB API: configured (${config.tmdbApiKey.startsWith("Bearer ") ? "Bearer token" : "raw key, will add Bearer prefix"})`,
  );
  console.log(
    `  LLM: Gemini ${config.llmConfig.geminiApiKey ? `configured (model: ${config.llmConfig.geminiModel ?? "gemini-2.5-flash"})` : "not configured (no GEMINI_API_KEY — LLM enrichment skipped)"}`,
  );

  try {
    await processQueue(prisma, config);
  } catch (error) {
    console.error(
      "[worker] Unexpected error in queue processor:",
      error instanceof Error ? error.message : error,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

  await prisma.$disconnect();
  console.log("[worker] Done.");
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
