"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Film, ChevronLeft, ChevronRight } from "lucide-react";
import { getPosterUrl } from "@/lib/utils";
import type { BrowseMovie, BrowseResponse } from "@/lib/types";

type SortOption = "alphabetical" | "recent";

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

  // Fetch movies from the browse API and update state + URL
  const fetchMovies = useCallback(
    async (page: number, sortBy: SortOption) => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (page > 1) params.set("page", String(page));
        if (sortBy !== "alphabetical") params.set("sort", sortBy);

        const queryString = params.toString();
        const url = `/api/movies/browse${queryString ? `?${queryString}` : ""}`;
        const res = await fetch(url);

        if (!res.ok) {
          console.error("Browse fetch failed:", res.status);
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
      } finally {
        setIsLoading(false);
      }
    },
    [pathname, router]
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

      {/* Movie grid */}
      <div
        className={`grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6 transition-opacity duration-200 ${
          isLoading ? "opacity-50 pointer-events-none" : ""
        }`}
      >
        {movies.map((movie) => (
          <MovieCard key={movie.tmdbId} movie={movie} />
        ))}
      </div>

      {/* Empty state */}
      {movies.length === 0 && !isLoading && (
        <div className="text-center py-20">
          <Film className="w-16 h-16 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 text-lg">No movies found</p>
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
function MovieCard({ movie }: { movie: BrowseMovie }) {
  const posterUrl = getPosterUrl(movie.posterPath);

  return (
    <Link
      href={`/movie/${movie.tmdbId}`}
      className="relative group cursor-pointer transition-transform hover:scale-105"
    >
      {/* Poster or fallback */}
      {posterUrl ? (
        <Image
          src={posterUrl}
          alt={`${movie.title} (${movie.year})`}
          width={300}
          height={450}
          className="w-full aspect-[2/3] object-cover rounded-lg shadow-lg"
        />
      ) : (
        <div className="w-full aspect-[2/3] rounded-lg shadow-lg bg-white/10 flex items-center justify-center">
          <Film className="w-12 h-12 text-gray-500" />
        </div>
      )}

      {/* "NEW!" badge */}
      {isNew(movie.createdAt) && (
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
