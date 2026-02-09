import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 100;
const VALID_SORTS = ["alphabetical", "recent"] as const;
type SortOption = (typeof VALID_SORTS)[number];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse and validate page
    const pageParam = searchParams.get("page");
    const page = pageParam ? parseInt(pageParam, 10) : 1;

    if (isNaN(page) || page < 1) {
      return NextResponse.json(
        { error: "Page must be a positive integer" },
        { status: 400 }
      );
    }

    // Parse and validate sort
    const sortParam = searchParams.get("sort");
    if (sortParam && !VALID_SORTS.includes(sortParam as SortOption)) {
      return NextResponse.json(
        { error: `Invalid sort parameter. Must be one of: ${VALID_SORTS.join(", ")}` },
        { status: 400 }
      );
    }
    const sort: SortOption = (sortParam as SortOption) || "alphabetical";

    // Build orderBy based on sort
    const orderBy =
      sort === "recent"
        ? { createdAt: "desc" as const }
        : { title: "asc" as const };

    // Count total movies for pagination
    const totalCount = await prisma.movie.count();
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    // Clamp page to valid range
    const currentPage = Math.min(page, totalPages);

    // Fetch paginated movies
    const movies = await prisma.movie.findMany({
      select: {
        tmdbId: true,
        title: true,
        year: true,
        posterPath: true,
        createdAt: true,
      },
      orderBy,
      take: PAGE_SIZE,
      skip: (currentPage - 1) * PAGE_SIZE,
    });

    return NextResponse.json({
      movies,
      totalPages,
      currentPage,
    });
  } catch (error) {
    console.error("Browse API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
