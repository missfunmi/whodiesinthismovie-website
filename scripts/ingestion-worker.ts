/**
 * Ingestion Worker — Local Development
 *
 * Background process for local development that polls the IngestionQueue
 * for pending movie requests and processes them every 30 seconds.
 *
 * In production, the Vercel Cron function at /api/cron/process-queue handles
 * job processing automatically (every 15 minutes). Use this worker for local
 * testing or to manually trigger ingestion during development.
 *
 * Run: npm run worker
 *
 * Processing logic lives in lib/ingestion.ts (shared with the cron route).
 */

import "dotenv/config";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { processQueue, sleep } from "../lib/ingestion.js";
import type { LlmConfig } from "../lib/llm.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 30_000; // 30 seconds

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
  console.log(`  Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
  console.log(
    "[worker] Note: In production, use the Vercel Cron route (/api/cron/process-queue) instead.",
  );
  console.log("[worker] Polling for jobs...\n");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[worker] Received ${signal}, shutting down...`);
    await prisma.$disconnect();
    console.log("[worker] Disconnected from database. Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Main polling loop
  while (true) {
    try {
      await processQueue(prisma, config);
    } catch (error) {
      // Unexpected error in the queue processor itself — log and continue
      console.error(
        "[worker] Unexpected error in queue processor:",
        error instanceof Error ? error.message : error,
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

main().catch((error) => {
  console.error("[worker] Fatal error:", error);
  process.exit(1);
});
