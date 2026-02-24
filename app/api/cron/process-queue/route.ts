/**
 * Vercel Cron Route — Process Ingestion Queue
 *
 * Triggered every 15 minutes by Vercel Cron (configured in vercel.json).
 * Processes ONE pending job from the IngestionQueue per invocation.
 *
 * Security: Requires `Authorization: Bearer ${CRON_SECRET}` header.
 * Vercel automatically adds this header when invoking the cron function.
 * To test manually:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://whodiesinthismovie.com/api/cron/process-queue
 *
 * Note: maxDuration = 60 requires Vercel Pro plan. The ingestion pipeline
 * (TMDB fetch + scraping + LLM extraction) typically takes 30-60 seconds.
 * Hobby plan has a 10-second limit which is insufficient for ingestion.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { processQueue } from "@/lib/ingestion";
import type { LlmConfig } from "@/lib/llm";

// Vercel function timeout — 60 seconds (requires Pro plan)
export const maxDuration = 60;

export async function GET(request: Request) {
  // Verify CRON_SECRET to prevent unauthorized invocations
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate required environment variables
  const tmdbApiKey = process.env.TMDB_API_KEY;
  if (!tmdbApiKey) {
    console.error("[cron] Missing TMDB_API_KEY environment variable");
    return NextResponse.json(
      { error: "Server configuration error: missing TMDB_API_KEY" },
      { status: 500 },
    );
  }

  const llmConfig: LlmConfig = {
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL || undefined,
  };

  if (!llmConfig.geminiApiKey) {
    console.warn(
      "[cron] GEMINI_API_KEY not set — LLM enrichment will be skipped, using parsed deaths only",
    );
  }

  // Process one pending job from the queue
  try {
    const result = await processQueue(prisma, { tmdbApiKey, llmConfig });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error(
      "[cron] Unexpected error in processQueue:",
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
