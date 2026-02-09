import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_QUERY_LENGTH = 200;
const OLLAMA_TIMEOUT_MS = 5000;

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request body
    const body = await request.json();
    const rawQuery = body?.query;

    if (!rawQuery || typeof rawQuery !== "string") {
      return NextResponse.json(
        { success: false, message: "Query is required" },
        { status: 400 }
      );
    }

    // 2. Sanitize: strip HTML, trim, enforce max length
    const query = rawQuery
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    if (query.length === 0) {
      return NextResponse.json(
        { success: false, message: "Query cannot be empty" },
        { status: 400 }
      );
    }

    console.log(`[request] Received movie request: "${query}"`);

    // 3. Check if movie already exists in main database
    const existingMovie = await prisma.movie.findFirst({
      where: { title: { contains: query, mode: "insensitive" } },
      select: { tmdbId: true, title: true, year: true, posterPath: true },
    });

    if (existingMovie) {
      console.log(
        `[request] Movie already exists: "${existingMovie.title}" (tmdbId: ${existingMovie.tmdbId})`
      );
      return NextResponse.json({
        success: true,
        message: "This movie is already in our database!",
        existingMovie,
      });
    }

    // 4. LLM validation (best-effort — if Ollama is unavailable, skip and proceed)
    const ollamaEndpoint =
      process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

      const ollamaRes = await fetch(`${ollamaEndpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "llama3.2:3b",
          prompt: `Is '${query}' a real movie title? Answer with only YES or NO.`,
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (ollamaRes.ok) {
        const ollamaData = await ollamaRes.json();
        const answer = (ollamaData.response || "").trim().toUpperCase();
        const isRealMovie = answer.startsWith("YES");
        console.log(
          `[request] LLM validation for "${query}": ${answer} (isRealMovie: ${isRealMovie})`
        );
        // Per SPEC: "If NO: still return success (don't expose validation to user)"
      }
    } catch {
      // Ollama unavailable, timeout, or parse error — skip validation
      console.log("[request] LLM validation skipped (Ollama unavailable)");
    }

    // 5. Insert into ingestion queue
    const queueEntry = await prisma.ingestionQueue.create({
      data: {
        query,
        status: "pending",
      },
    });

    console.log(
      `[request] Added to ingestion queue: id=${queueEntry.id}, query="${query}"`
    );

    // 6. Return success
    return NextResponse.json({
      success: true,
      message: "Okay, we'll check on that!",
    });
  } catch (error) {
    console.error("[request] Movie request API error:", error);
    return NextResponse.json(
      { success: false, message: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
