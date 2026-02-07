import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const MAX_RESULTS = 8;
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_LENGTH = 200;
const TOO_MANY_THRESHOLD = 100;

// Bare "the" queries return noise — suppress them
const SUPPRESSED_QUERIES = ["the", "the "];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q")?.trim() ?? "";

    // Validate query length
    if (query.length < MIN_QUERY_LENGTH) {
      return NextResponse.json(
        { error: "Query must be at least 3 characters" },
        { status: 400 }
      );
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: "Query must be 200 characters or fewer" },
        { status: 400 }
      );
    }

    // Suppress bare "the" queries
    if (SUPPRESSED_QUERIES.includes(query.toLowerCase())) {
      return NextResponse.json([]);
    }

    // Strip HTML tags for safety
    const sanitizedQuery = query.replace(/<[^>]*>/g, "");

    // Count total matches first to check for "too many"
    const totalCount = await prisma.movie.count({
      where: {
        title: { contains: sanitizedQuery, mode: "insensitive" },
      },
    });

    if (totalCount > TOO_MANY_THRESHOLD) {
      return NextResponse.json({ tooMany: true, count: totalCount });
    }

    // Fetch up to MAX_RESULTS
    const movies = await prisma.movie.findMany({
      where: {
        title: { contains: sanitizedQuery, mode: "insensitive" },
      },
      select: {
        tmdbId: true,
        title: true,
        year: true,
        posterPath: true,
      },
      take: MAX_RESULTS,
      orderBy: { year: "desc" },
    });

    return NextResponse.json(movies);
  } catch (error) {
    console.error("Search API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
