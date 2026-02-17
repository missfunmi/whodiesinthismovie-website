import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseQueryWithYear, sanitizeInput } from "@/lib/utils";

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
        { status: 400 },
      );
    }
    const trimmedQuery = query.trim();
    if (trimmedQuery.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: `Query must be ${MAX_QUERY_LENGTH} characters or fewer` },
        { status: 400 },
      );
    }

    // Suppress bare "the" queries
    if (SUPPRESSED_QUERIES.includes(trimmedQuery.toLowerCase())) {
      return NextResponse.json([]);
    }

    // Strip all HTML via DOMPurify
    const sanitizedQuery = sanitizeInput(trimmedQuery);

    // Parse optional trailing year from query (e.g., "matrix 1999" → title="matrix", year=1999)
    const { title: searchTitle, year: searchYear } = parseQueryWithYear(sanitizedQuery);
    const whereClause = {
      title: { contains: searchTitle, mode: "insensitive" as const },
      ...(searchYear ? { year: searchYear } : {}),
    };

    // Count total matches first to check for "too many"
    const totalCount = await prisma.movie.count({ where: whereClause });

    if (totalCount > TOO_MANY_THRESHOLD) {
      return NextResponse.json({ tooMany: true, count: totalCount });
    }

    // Fetch up to MAX_RESULTS
    const movies = await prisma.movie.findMany({
      where: whereClause,
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
      { status: 500 },
    );
  }
}
