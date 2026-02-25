/**
 * Inngest function: Process Movie Ingestion
 *
 * Triggered by the "movie/ingestion.requested" event when a user submits
 * a movie request via POST /api/movies/request. Immediately processes the
 * job rather than waiting for a cron schedule.
 *
 * Steps:
 *   1. claim-job   — Atomically verify the job is pending and mark it as "processing"
 *                    in a single UPDATE. Prevents duplicate processing if the event
 *                    fires more than once (Inngest at-least-once delivery).
 *   2. process-job — Run the full ingestion pipeline (TMDB + scraping + LLM + DB insert)
 *
 * Each step is independently retried by Inngest on failure (up to 3 times).
 * The full pipeline is in lib/ingestion.ts.
 */

import { inngest } from "@/lib/inngest";
import { NonRetriableError } from "inngest";
import { prisma } from "@/lib/prisma";
import { processJob } from "@/lib/ingestion";
import type { LlmConfig } from "@/lib/llm";

export const processMovieIngestion = inngest.createFunction(
  {
    id: "process-movie-ingestion",
    name: "Process Movie Ingestion",
    retries: 3,
  },
  { event: "movie/ingestion.requested" },
  async ({ event, step }) => {
    const { jobId } = event.data as { jobId: number };

    // Step 1: Atomically claim the job — only succeeds if status is still "pending".
    // Prisma throws P2025 (RecordNotFound) if the row doesn't exist or is already
    // being processed, which causes this step to return null via the catch.
    // This eliminates the TOCTOU window between a separate read and write.
    const claimed = await step.run("claim-job", async () => {
      try {
        await prisma.ingestionQueue.update({
          where: { id: jobId, status: "pending" },
          data: { status: "processing" },
        });
        return true;
      } catch {
        // P2025: no row matched (not found, or already processing/complete/failed)
        return false;
      }
    });

    if (!claimed) {
      // Verify whether the job exists at all for a clearer log message
      const job = await prisma.ingestionQueue.findUnique({
        where: { id: jobId },
        select: { status: true },
      });
      return {
        success: false,
        reason: job
          ? `Job already in status: ${job.status}`
          : "Job not found",
      };
    }

    // Step 2: Run the full ingestion pipeline.
    // processJob throws on failure — it does not catch internally (the caller is
    // responsible for marking the job as failed). We wrap it here so that if
    // processJob throws, the queue record is moved to "failed" before re-throwing.
    // Re-throwing lets Inngest retry on transient errors; if all retries exhaust,
    // the job is already in a terminal "failed" state rather than stuck in "processing".
    const movieTitle = await step.run("process-job", async () => {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      if (!tmdbApiKey) {
        // Permanent misconfiguration — mark failed immediately and skip all retries.
        await prisma.ingestionQueue.update({
          where: { id: jobId },
          data: { status: "failed", failureReason: "TMDB_API_KEY not configured" },
        });
        throw new NonRetriableError("TMDB_API_KEY environment variable is not set");
      }

      const llmConfig: LlmConfig = {
        geminiApiKey: process.env.GEMINI_API_KEY || undefined,
        geminiModel: process.env.GEMINI_MODEL || undefined,
      };

      // Fetch job fresh from DB — step.run() JSON-serializes return values,
      // which would convert Date fields to strings and break processJob's type contract.
      const job = await prisma.ingestionQueue.findUniqueOrThrow({
        where: { id: jobId },
      });

      try {
        return await processJob(job, prisma, { tmdbApiKey, llmConfig });
      } catch (err) {
        // Mark the job as failed so it doesn't stay stuck in "processing" after
        // all Inngest retries are exhausted. Re-throw to allow Inngest to retry
        // on transient errors (processJob will re-run on the next attempt).
        await prisma.ingestionQueue.update({
          where: { id: jobId },
          data: {
            status: "failed",
            failureReason:
              err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
          },
        });
        throw err;
      }
    });

    return { success: true, title: movieTitle };
  },
);
