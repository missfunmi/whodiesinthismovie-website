"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Film, ChevronLeft, ChevronRight, LayoutGrid, List } from "lucide-react";
import PosterImage from "@/components/poster-image";
import { getPosterUrl } from "@/lib/utils";
import type { BrowseMovie, BrowseResponse } from "@/lib/types";

type SortOption = "alphabetical" | "recent";
type LayoutOption = "grid" | "list";

type BrowseGridProps = {
  initialMovies: BrowseMovie[];
  initialTotalPages: number;
  initialPage: number;
  initialSort: SortOption;
};

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

function isNew(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < TWENTY_FOUR_HOURS_MS;
}

/**
 * Client component for the all-movies browse grid.
 * Handles pagination, sorting, and client-side navigation on page/sort changes.
 */
export default function BrowseGrid({
  initialMovies,
  initialTotalPages,
  initialPage,
  initialSort,
}: BrowseGridProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [movies, setMovies] = useState(initialMovies);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [sort, setSort] = useState<SortOption>(initialSort);
  const [isLoading, setIsLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [layout, setLayout] = useState<LayoutOption>("grid");

  // Gate time-dependent UI (NEW! badges) behind mount to prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch movies from the browse API and update state + URL
  const fetchMovies = useCallback(
    async (page: number, sortBy: SortOption) => {
      setIsLoading(true);
      setFetchError(false);
      try {
        const params = new URLSearchParams();
        if (page > 1) params.set("page", String(page));
        if (sortBy !== "alphabetical") params.set("sort", sortBy);

        const queryString = params.toString();
        const url = `/api/movies/browse${queryString ? `?${queryString}` : ""}`;
        const res = await fetch(url);

        if (!res.ok) {
          console.error("Browse fetch failed:", res.status);
          setFetchError(true);
          return;
        }

        const data: BrowseResponse = await res.json();
        setMovies(data.movies);
        setTotalPages(data.totalPages);
        setCurrentPage(data.currentPage);
        setSort(sortBy);

        // Update URL without full page reload
        const newUrl = `${pathname}${queryString ? `?${queryString}` : ""}`;
        router.push(newUrl, { scroll: false });
      } catch (error) {
        console.error("Browse fetch error:", error);
        setFetchError(true);
      } finally {
        setIsLoading(false);
      }
    },
    [pathname, router],
  );

  const handleSortChange = (newSort: SortOption) => {
    if (newSort === sort) return;
    fetchMovies(1, newSort); // Reset to page 1 on sort change
  };

  const handlePrevPage = () => {
    if (currentPage > 1) fetchMovies(currentPage - 1, sort);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) fetchMovies(currentPage + 1, sort);
  };

  return (
    <div>
      {/* Controls: sort dropdown + movie count */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-gray-400 text-sm">
          {movies.length === 0
            ? "No movies yet"
            : `Page ${currentPage} of ${totalPages}`}
        </p>

        <div className="flex items-center gap-4">
          {/* Layout toggle */}
          <div className="flex items-center gap-1 bg-white/10 rounded-md p-0.5">
            <button
              onClick={() => setLayout("grid")}
              aria-label="Grid layout"
              className={`p-1.5 rounded transition-colors ${
                layout === "grid"
                  ? "bg-white/20 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setLayout("list")}
              aria-label="List layout"
              className={`p-1.5 rounded transition-colors ${
                layout === "list"
                  ? "bg-white/20 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort-select" className="text-sm text-gray-400">
              Sort by
            </label>
            <select
              id="sort-select"
              value={sort}
              onChange={(e) => handleSortChange(e.target.value as SortOption)}
              className="bg-white/10 text-white text-sm rounded-md px-3 py-1.5 border border-white/20 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="alphabetical">Alphabetical</option>
              <option value="recent">Recently Added</option>
            </select>
          </div>
        </div>
      </div>

      {/* Fetch error state */}
      {fetchError && (
        <div className="text-center py-8 mb-4">
          <p className="text-red-400 mb-3">Something went wrong loading movies.</p>
          <button
            onClick={() => fetchMovies(currentPage, sort)}
            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Screen reader loading announcement */}
      {isLoading && <span className="sr-only">Loading movies...</span>}

      {/* Movie grid or list */}
      {layout === "grid" ? (
        <div
          className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 transition-opacity duration-200 ${
            isLoading ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {movies.map((movie) => (
            <MovieCard key={movie.tmdbId} movie={movie} mounted={mounted} />
          ))}
        </div>
      ) : (
        <div
          className={`flex flex-col gap-2 transition-opacity duration-200 ${
            isLoading ? "opacity-50 pointer-events-none" : ""
          }`}
        >
          {movies.map((movie) => (
            <MovieListItem key={movie.tmdbId} movie={movie} mounted={mounted} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {movies.length === 0 && !isLoading && (
        <div className="text-center py-20">
          <Film className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">
            We don&apos;t have that one yet!
          </p>
        </div>
      )}

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex justify-center items-center gap-4 mt-8">
          <button
            onClick={handlePrevPage}
            disabled={currentPage <= 1 || isLoading}
            aria-label="Previous page"
            className="px-4 py-2 bg-white/10 text-white rounded-md shadow hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous
          </button>

          <span className="text-gray-400 text-sm">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={handleNextPage}
            disabled={currentPage >= totalPages || isLoading}
            aria-label="Next page"
            className="px-4 py-2 bg-white/10 text-white rounded-md shadow hover:bg-white/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
          >
            Next
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Individual movie card in the browse grid */
function MovieCard({
  movie,
  mounted,
}: {
  movie: BrowseMovie;
  mounted: boolean;
}) {
  const posterUrl = getPosterUrl(movie.posterPath);

  return (
    <Link
      href={`/movie/${movie.tmdbId}`}
      className="relative group cursor-pointer transition-transform hover:scale-105"
    >
      {/* Poster or fallback */}
      {posterUrl ? (
        <PosterImage
          src={posterUrl}
          alt={`${movie.title} (${movie.year})`}
          width={300}
          height={450}
          className="w-full aspect-2/3 object-cover rounded-lg shadow-lg"
          fallbackClassName="w-full aspect-2/3 rounded-lg shadow-lg bg-white/10 flex items-center justify-center"
          fallbackIconClassName="w-12 h-12 text-gray-500"
        />
      ) : (
        <div className="w-full aspect-2/3 rounded-lg shadow-lg bg-white/10 flex items-center justify-center">
          <Film className="w-12 h-12 text-gray-500" />
        </div>
      )}

      {/* "NEW!" badge — only rendered after mount to prevent hydration mismatch */}
      {mounted && isNew(movie.createdAt) && (
        <span className="absolute top-2 right-2 bg-green-500 text-white px-2 py-1 text-xs rounded font-bold">
          NEW!
        </span>
      )}

      {/* Title overlay on hover */}
      <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-3 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <p className="text-white text-sm font-medium truncate">{movie.title}</p>
        <p className="text-gray-400 text-xs">{movie.year}</p>
      </div>
    </Link>
  );
}

/** Individual movie row in the list layout — titles visible for Cmd+F search */
function MovieListItem({
  movie,
  mounted,
}: {
  movie: BrowseMovie;
  mounted: boolean;
}) {
  const posterUrl = getPosterUrl(movie.posterPath, "w92");

  return (
    <Link
      href={`/movie/${movie.tmdbId}`}
      className="flex items-center gap-4 p-3 rounded-lg hover:bg-white/10 transition-colors"
    >
      {/* Poster thumbnail */}
      {posterUrl ? (
        <PosterImage
          src={posterUrl}
          alt=""
          width={40}
          height={60}
          className="w-10 h-15 object-cover rounded shadow-md shrink-0"
          fallbackClassName="w-10 h-15 rounded shadow-md shrink-0 bg-white/10 flex items-center justify-center"
          fallbackIconClassName="w-4 h-4 text-gray-500"
        />
      ) : (
        <div className="w-10 h-15 rounded shadow-md shrink-0 bg-white/10 flex items-center justify-center">
          <Film className="w-4 h-4 text-gray-500" />
        </div>
      )}

      {/* Title and year — always visible for Cmd+F */}
      <span className="text-white font-medium truncate">{movie.title}</span>
      <span className="text-gray-400 text-sm shrink-0">({movie.year})</span>

      {/* "NEW!" badge */}
      {mounted && isNew(movie.createdAt) && (
        <span className="bg-green-500 text-white px-2 py-0.5 text-xs rounded font-bold shrink-0">
          NEW!
        </span>
      )}
    </Link>
  );
}
