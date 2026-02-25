/**
 * Inngest function: Process Movie Ingestion
 *
 * Triggered by the "movie/ingestion.requested" event when a user submits
 * a movie request via POST /api/movies/request. Immediately processes the
 * job rather than waiting for a cron schedule.
 *
 * Steps:
 *   1. fetch-job        — Verify the queue entry exists and is pending
 *   2. mark-processing  — Update status to "processing"
 *   3. process-job      — Run the full ingestion pipeline (TMDB + scraping + LLM + DB insert)
 *
 * Each step is independently retried by Inngest on failure (up to 3 times).
 * The full pipeline is in lib/ingestion.ts.
 *
 * Note: Step return values are JSON-serialized by Inngest between steps. To avoid
 * Date/string type mismatches, the process-job step re-fetches the job directly
 * from the database rather than reusing the serialized value from fetch-job.
 */

import { inngest } from "@/lib/inngest";
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

    // Step 1: Verify the queue entry exists and is still pending
    const jobExists = await step.run("fetch-job", async () => {
      const job = await prisma.ingestionQueue.findUnique({
        where: { id: jobId },
        select: { id: true, status: true, query: true },
      });
      return job;
    });

    if (!jobExists) {
      return { success: false, reason: "Job not found" };
    }

    if (jobExists.status !== "pending") {
      return {
        success: false,
        reason: `Job already in status: ${jobExists.status}`,
      };
    }

    // Step 2: Mark as processing to prevent duplicate work
    await step.run("mark-processing", async () => {
      await prisma.ingestionQueue.update({
        where: { id: jobId },
        data: { status: "processing" },
      });
    });

    // Step 3: Run the full ingestion pipeline.
    // Re-fetch the job from DB here — step.run() JSON-serializes return values,
    // which would convert Date fields to strings and break processJob's type contract.
    const movieTitle = await step.run("process-job", async () => {
      const tmdbApiKey = process.env.TMDB_API_KEY;
      if (!tmdbApiKey) {
        throw new Error("TMDB_API_KEY environment variable is not set");
      }

      const llmConfig: LlmConfig = {
        geminiApiKey: process.env.GEMINI_API_KEY || undefined,
        geminiModel: process.env.GEMINI_MODEL || undefined,
      };

      const job = await prisma.ingestionQueue.findUniqueOrThrow({
        where: { id: jobId },
      });

      return await processJob(job, prisma, { tmdbApiKey, llmConfig });
    });

    return { success: true, title: movieTitle };
  },
);
