"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import SearchInput from "@/components/search-input";
import AutocompleteDropdown from "@/components/autocomplete-dropdown";
import type { MovieSearchResult, RequestStatus } from "@/lib/types";

/** Minimum characters before triggering search */
const MIN_QUERY_LENGTH = 3;
/** Debounce delay in milliseconds */
const DEBOUNCE_MS = 300;
/** Maximum query length */
const MAX_QUERY_LENGTH = 200;
/** Queries to suppress (noise reduction) */
const SUPPRESSED_QUERIES = ["the", "the "];

/**
 * Strip HTML tags and enforce character limit on user input.
 * Defense-in-depth: the API route also sanitizes, but we catch it early.
 */
function sanitizeQuery(input: string): string {
  return input.replace(/<[^>]*>?/gm, "").slice(0, MAX_QUERY_LENGTH);
}

/**
 * Determine if a query should trigger a search.
 * Returns false for easter egg mode, short queries, or suppressed queries.
 */
function shouldSearch(query: string): boolean {
  if (query.startsWith("!!")) return false;
  const trimmed = query.trim();
  if (trimmed.length < MIN_QUERY_LENGTH) return false;
  if (SUPPRESSED_QUERIES.includes(trimmed.toLowerCase())) return false;
  return true;
}

/**
 * Search orchestrator component.
 * Manages debounced API calls, keyboard navigation, easter egg detection,
 * and dropdown visibility.
 */
export default function Search() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track whether a movie request is in progress so onBlur doesn't close the dropdown.
  // When the user clicks "Want us to look it up?", React re-renders the dropdown
  // (removing the focused button), causing document.activeElement to revert to body.
  // Without this guard, the onBlur timer would close the dropdown before the
  // API response arrives, hiding the success/error message.
  const isRequestingRef = useRef(false);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieSearchResult[] | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>("idle");
  const [isSearching, setIsSearching] = useState(false);

  // Derive easter egg state from query (no setState needed)
  const isEasterEgg = useMemo(() => query.startsWith("!!"), [query]);

  // Handle query changes: update state and clear results immediately
  // when the new query doesn't warrant a search (avoids setState in effect).
  // Only reset requestStatus when the query substantively changes (trimmed value differs),
  // so accidental whitespace or minor edits don't wipe success/error messages.
  const handleQueryChange = useCallback(
    (newQuery: string) => {
      const sanitized = sanitizeQuery(newQuery);
      setQuery(sanitized);
      if (sanitized.trim() !== query.trim()) {
        setRequestStatus("idle");
      }
      if (!shouldSearch(sanitized)) {
        setResults(null);
        setTooMany(false);
        setShowDropdown(false);
      }
    },
    [query]
  );

  // Debounced search: only the async fetch lives in the effect
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!shouldSearch(query)) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const trimmed = query.trim();

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/movies/search?q=${encodeURIComponent(trimmed)}`
        );
        if (!res.ok) {
          console.error("Search API error:", res.status);
          setResults([]);
          setTooMany(false);
          setShowDropdown(true);
          return;
        }

        const data = await res.json();

        if (data.tooMany) {
          setTooMany(true);
          setResults(null);
          setHighlightedIndex(-1);
        } else {
          setTooMany(false);
          setResults(data as MovieSearchResult[]);
          setHighlightedIndex(data.length > 0 ? 0 : -1);
        }
        setShowDropdown(true);
      } catch (err) {
        console.error("Search fetch error:", err);
        setResults([]);
        setTooMany(false);
        setShowDropdown(true);
      } finally {
        setIsSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  // Click-outside to close dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = useCallback(
    (tmdbId: number) => {
      setShowDropdown(false);
      router.push(`/movie/${tmdbId}`);
    },
    [router]
  );

  // Handle movie request when user clicks "Want us to look it up?"
  const handleRequestMovie = useCallback(async () => {
    isRequestingRef.current = true;
    setRequestStatus("loading");
    try {
      const res = await fetch("/api/movies/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRequestStatus("error");
        setShowDropdown(true);
        return;
      }

      if (data.existingMovie) {
        // Movie was already in the database — navigate to it
        setShowDropdown(false);
        setRequestStatus("idle");
        router.push(`/movie/${data.existingMovie.tmdbId}`);
        return;
      }

      setRequestStatus("success");
      setShowDropdown(true);
    } catch {
      setRequestStatus("error");
      setShowDropdown(true);
    } finally {
      // Keep the guard active briefly so the 150ms onBlur timer
      // (which may already be queued) doesn't close the dropdown
      // before React re-renders with the success/error message.
      setTimeout(() => {
        isRequestingRef.current = false;
      }, 200);
    }
  }, [query, router]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (isEasterEgg || !showDropdown || !results || results.length === 0) {
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightedIndex((prev) =>
            Math.min(prev + 1, results.length - 1)
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < results.length) {
            handleSelect(results[highlightedIndex].tmdbId);
          }
          break;
        case "Escape":
          setShowDropdown(false);
          break;
      }
    },
    [isEasterEgg, showDropdown, results, highlightedIndex, handleSelect]
  );

  const handleFocus = useCallback(() => {
    if (results && results.length > 0 && !isEasterEgg) {
      setShowDropdown(true);
    }
    if (tooMany) {
      setShowDropdown(true);
    }
    // Show dropdown for zero results too (for request flow)
    if (results !== null && results.length === 0 && shouldSearch(query)) {
      setShowDropdown(true);
    }
  }, [results, tooMany, isEasterEgg, query]);

  return (
    <div ref={containerRef} className="relative">
      <SearchInput
        value={query}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        isLoading={isSearching}
        onBlur={() => {
          // Delay hiding to allow click events on dropdown items to fire
          setTimeout(() => {
            // Don't close during a movie request — the button that had focus
            // gets removed from the DOM by React's re-render, so activeElement
            // reverts to body. Without this check, the dropdown would close
            // before the success message can appear.
            if (isRequestingRef.current) return;
            if (!containerRef.current?.contains(document.activeElement)) {
              setShowDropdown(false);
            }
          }, 150);
        }}
      />
      <AutocompleteDropdown
        results={results}
        tooMany={tooMany}
        highlightedIndex={highlightedIndex}
        onSelect={handleSelect}
        onHover={setHighlightedIndex}
        visible={showDropdown && !isEasterEgg}
        onRequestMovie={handleRequestMovie}
        requestStatus={requestStatus}
      />
      {/* Screen reader announcements for search results */}
      <div aria-live="polite" className="sr-only">
        {showDropdown && results !== null && results.length > 0 && (
          <span>{results.length} search result{results.length !== 1 ? "s" : ""} available</span>
        )}
        {showDropdown && results !== null && results.length === 0 && !tooMany && (
          <span>No results found</span>
        )}
        {showDropdown && tooMany && (
          <span>Too many results. Keep typing to narrow your search.</span>
        )}
      </div>
    </div>
  );
}
