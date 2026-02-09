import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import MovieHeader from "@/components/movie-header";
import BrowseGrid from "@/components/browse-grid";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Browse All Movies | Who Dies in This Movie?",
  description:
    "Browse our full catalog of movies and find out who dies in each one.",
};

const PAGE_SIZE = 100;
const VALID_SORTS = ["alphabetical", "recent"] as const;
type SortOption = (typeof VALID_SORTS)[number];

type Props = {
  searchParams: Promise<{ page?: string; sort?: string }>;
};

/**
 * Browse page — server component.
 * Fetches paginated movies via Prisma and passes initial data to
 * the BrowseGrid client component for interactive pagination/sorting.
 */
export default async function BrowsePage({ searchParams }: Props) {
  const params = await searchParams;

  // Parse page param (default 1, min 1)
  const pageParam = params.page ? parseInt(params.page, 10) : 1;
  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;

  // Parse sort param (default alphabetical)
  const sortParam = params.sort;
  const sort: SortOption =
    sortParam && VALID_SORTS.includes(sortParam as SortOption)
      ? (sortParam as SortOption)
      : "alphabetical";

  const orderBy =
    sort === "recent"
      ? { createdAt: "desc" as const }
      : { title: "asc" as const };

  // Count first to determine valid page range, then fetch
  const totalCount = await prisma.movie.count();
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

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

  // Serialize Date to ISO string for the client component
  const serializedMovies = movies.map((m) => ({
    ...m,
    createdAt: m.createdAt.toISOString(),
  }));

  return (
    <div className="bg-primary min-h-screen">
      <MovieHeader />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <h1
          className="text-3xl md:text-4xl font-bold text-white mb-8"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          All Movies
        </h1>

        <Suspense fallback={null}>
          <BrowseGrid
            initialMovies={serializedMovies}
            initialTotalPages={totalPages}
            initialPage={currentPage}
            initialSort={sort}
          />
        </Suspense>
      </main>
    </div>
  );
}
