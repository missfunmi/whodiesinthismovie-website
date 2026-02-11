import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseQueryWithYear } from "@/lib/utils";

const MAX_QUERY_LENGTH = 200;

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
            `[request] CSRF blocked: origin=${origin}, host=${host}`,
          );
          return NextResponse.json(
            { success: false, message: "Unauthorized" },
            { status: 403 },
          );
        }
      } catch {
        return NextResponse.json(
          { success: false, message: "Unauthorized" },
          { status: 403 },
        );
      }
    }

    // 2. Parse and validate request body
    const body = await request.json();
    const rawQuery = body?.query;

    if (!rawQuery || typeof rawQuery !== "string") {
      return NextResponse.json(
        { success: false, message: "Query is required" },
        { status: 400 },
      );
    }

    // 3. Sanitize: strip HTML, trim, enforce max length
    // TODO: Switch to using 'sanitize-html' or 'dompurify'
    const query = rawQuery
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "")
      .replace(/on\w+="[^"]*"/gim, "")
      .replace(/<[^>]*>/g, "")
      .trim()
      .slice(0, MAX_QUERY_LENGTH);

    if (query.length === 0) {
      return NextResponse.json(
        { success: false, message: "Query cannot be empty" },
        { status: 400 },
      );
    }

    console.log(`[request] Received movie request: "${query}"`);

    // 4. Parse optional year from query (e.g., "matrix 1999" → title="matrix", year=1999)
    const { title: searchTitle, year: searchYear } = parseQueryWithYear(query);

    // 5. Check if movie already exists in main database (exact title match, optionally filtered by year)
    const existingMovie = await prisma.movie.findFirst({
      where: {
        title: { equals: searchTitle, mode: "insensitive" },
        ...(searchYear ? { year: searchYear } : {}),
      },
      select: { tmdbId: true, title: true, year: true, posterPath: true },
    });

    if (existingMovie) {
      console.log(
        `[request] Movie already exists: "${existingMovie.title}" (tmdbId: ${existingMovie.tmdbId})`,
      );
      return NextResponse.json({
        success: true,
        message: "This movie is already in our database!",
        existingMovie,
      });
    }

    // 6. Prevent duplicate queue entries for the same query
    const existingRequest = await prisma.ingestionQueue.findFirst({
      where: {
        query: { equals: query, mode: "insensitive" },
        status: { in: ["pending", "processing"] },
      },
    });

    if (existingRequest) {
      console.log(
        `[request] Duplicate request skipped: "${query}" (existing id=${existingRequest.id}, status=${existingRequest.status})`,
      );
      return NextResponse.json({
        success: true,
        message: "Someone already requested this! We're on it.",
      });
    }

    // 7. Insert into ingestion queue immediately (non-blocking — LLM validation
    // happens in the worker, not here, to avoid blocking the user for seconds)
    const queueEntry = await prisma.ingestionQueue.create({
      data: {
        query,
        year: searchYear,
        status: "pending",
      },
    });
    console.log(
      `[request] Added to ingestion queue: id=${queueEntry.id}, query="${query}"${searchYear ? `, year=${searchYear}` : ""}`,
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
      { status: 500 },
    );
  }
}
