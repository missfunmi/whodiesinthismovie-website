import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_QUERY_LENGTH = 200;
const OLLAMA_TIMEOUT_MS = 5000;

export async function POST(request: NextRequest) {
  try {
    // 1. CSRF protection: verify Origin matches Host in production
    const origin = request.headers.get("origin");
    if (process.env.NODE_ENV === "production" && origin) {
      const host = request.headers.get("host");
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          console.warn(
            `[request] CSRF blocked: origin=${origin}, host=${host}`
          );
          return NextResponse.json(
            { success: false, message: "Unauthorized" },
            { status: 403 }
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, message: "Unauthorized" },
          { status: 403 }
        );
      }
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const rawQuery = body?.query;

    if (!rawQuery || typeof rawQuery !== "string") {
      return NextResponse.json(
        { success: false, message: "Query is required" },
        { status: 400 }
      );
    }

    // 3. Sanitize: strip HTML, trim, enforce max length
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

    // 4. Check if movie already exists in main database (exact title match)
    const existingMovie = await prisma.movie.findFirst({
      where: { title: { equals: query, mode: "insensitive" } },
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

    // 5. Prevent duplicate queue entries for the same query
    const existingRequest = await prisma.ingestionQueue.findFirst({
      where: {
        query: { equals: query, mode: "insensitive" },
        status: { in: ["pending", "processing"] },
      },
    });

    if (existingRequest) {
      console.log(
        `[request] Duplicate request skipped: "${query}" (existing id=${existingRequest.id}, status=${existingRequest.status})`
      );
      return NextResponse.json({
        success: true,
        message: "Someone already requested this! We're on it.",
      });
    }

    // 6. LLM validation (best-effort — if Ollama is unavailable, skip and proceed)
    const ollamaEndpoint =
      process.env.OLLAMA_ENDPOINT || "http://localhost:11434";
    const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:3b";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

    try {
      const ollamaRes = await fetch(`${ollamaEndpoint}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: ollamaModel,
          prompt: `Is '${query}' a real movie title? Answer with only YES or NO.`,
          stream: false,
        }),
        signal: controller.signal,
      });

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
    } finally {
      clearTimeout(timeout);
    }

    // 7. Insert into ingestion queue
    const queueEntry = await prisma.ingestionQueue.create({
      data: {
        query,
        status: "pending",
      },
    });

    console.log(
      `[request] Added to ingestion queue: id=${queueEntry.id}, query="${query}"`
    );

    // 8. Return success
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
