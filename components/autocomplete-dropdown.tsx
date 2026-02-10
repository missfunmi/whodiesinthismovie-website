"use client";

import { useRef, useEffect } from "react";
import Image from "next/image";
import { AlertCircle, Film } from "lucide-react";
import type { MovieSearchResult, RequestStatus } from "@/lib/types";
import { getPosterUrl } from "@/lib/utils";

type AutocompleteDropdownProps = {
  results: MovieSearchResult[] | null;
  tooMany: boolean;
  highlightedIndex: number;
  onSelect: (tmdbId: number) => void;
  onHover: (index: number) => void;
  visible: boolean;
  onRequestMovie: () => void;
  requestStatus: RequestStatus;
};

/**
 * Autocomplete dropdown showing search results below the search input.
 * Handles results, "too many matches", and "no movies found" states.
 */
export default function AutocompleteDropdown({
  results,
  tooMany,
  highlightedIndex,
  onSelect,
  onHover,
  visible,
  onRequestMovie,
  requestStatus,
}: AutocompleteDropdownProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll the highlighted item into view when navigating with keyboard
  useEffect(() => {
    if (highlightedIndex < 0 || !listRef.current) return;
    const items = listRef.current.querySelectorAll("[data-result-item]");
    items[highlightedIndex]?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  // Don't render if not visible or no data to show
  if (!visible) return null;
  if (!tooMany && results === null) return null;

  return (
    <ul
      ref={listRef}
      className="absolute top-full left-0 right-0 mt-2 bg-white/95 backdrop-blur-md rounded-xl shadow-2xl max-h-125 overflow-y-auto z-50 list-none p-0 m-0"
      role="listbox"
      aria-label="Search results"
    >
      {/* Too many matches */}
      {tooMany && (
        <div className="flex flex-col items-center gap-2 p-8">
          <AlertCircle className="w-8 h-8 text-orange-500" />
          <p className="text-gray-700 font-medium">
            Too many matches — keep typing!
          </p>
        </div>
      )}

      {/* No results — show request flow states */}
      {!tooMany && results !== null && results.length === 0 && (
        <div className="flex flex-col items-center gap-3 p-8">
          {requestStatus === "idle" && (
            <>
              <p className="text-gray-500">We don&apos;t have that one yet!</p>
              <button
                onClick={onRequestMovie}
                className="text-blue-500 hover:text-blue-600 text-sm font-medium transition-colors cursor-pointer"
              >
                Want us to look it up?
              </button>
            </>
          )}
          {requestStatus === "loading" && (
            <p className="text-gray-500 animate-pulse">One moment...</p>
          )}
          {requestStatus === "success" && (
            <div className="text-center">
              <p className="text-green-600 font-medium">
                Okay, we&apos;ll check on that!
              </p>
              <p className="text-gray-400 text-sm mt-1">
                We&apos;ll let you know when we find out who dies in this movie.
              </p>
            </div>
          )}
          {requestStatus === "error" && (
            <>
              <p className="text-red-500 text-sm">
                Something went wrong. Please try again.
              </p>
              <button
                onClick={onRequestMovie}
                className="text-blue-500 hover:text-blue-600 text-sm font-medium transition-colors cursor-pointer"
              >
                Try again?
              </button>
            </>
          )}
        </div>
      )}

      {/* Result items */}
      {!tooMany &&
        results !== null &&
        results.length > 0 &&
        results.map((movie, index) => {
          const isHighlighted = index === highlightedIndex;
          const posterUrl = getPosterUrl(movie.posterPath, "w92");

          return (
            <li
              key={movie.tmdbId}
              role="option"
              aria-selected={isHighlighted}
              className="contents"
            >
              <button
                data-result-item
                onClick={() => onSelect(movie.tmdbId)}
                onMouseEnter={() => onHover(index)}
                className={`w-full flex items-center gap-4 p-4 transition-colors cursor-pointer ${
                  isHighlighted
                    ? "bg-blue-500 text-white"
                    : "hover:bg-gray-100 text-gray-900"
                }`}
              >
                {/* Poster thumbnail */}
                {posterUrl ? (
                  <Image
                    src={posterUrl}
                    alt=""
                    width={48}
                    height={64}
                    className="w-12 h-16 object-cover rounded shadow-md shrink-0"
                  />
                ) : (
                  <div className="w-12 h-16 rounded shadow-md shrink-0 bg-gray-200 flex items-center justify-center">
                    <Film className="w-5 h-5 text-gray-400" />
                  </div>
                )}

                {/* Title and year */}
                <div className="flex-1 text-left min-w-0">
                  <span className="font-medium truncate block">
                    {movie.title}
                  </span>
                  <span
                    className={`text-sm ${
                      isHighlighted ? "text-blue-100" : "text-gray-500"
                    }`}
                  >
                    ({movie.year})
                  </span>
                </div>
              </button>
            </li>
          );
        })}
    </ul>
  );
}
