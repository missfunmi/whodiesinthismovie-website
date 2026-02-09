"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import SearchInput from "@/components/search-input";
import AutocompleteDropdown from "@/components/autocomplete-dropdown";
import type { MovieSearchResult } from "@/lib/types";

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

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MovieSearchResult[] | null>(null);
  const [tooMany, setTooMany] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);

  // Derive easter egg state from query (no setState needed)
  const isEasterEgg = useMemo(() => query.startsWith("!!"), [query]);

  // Handle query changes: update state and clear results immediately
  // when the new query doesn't warrant a search (avoids setState in effect)
  const handleQueryChange = useCallback((newQuery: string) => {
    const sanitized = sanitizeQuery(newQuery);
    setQuery(sanitized);
    if (!shouldSearch(sanitized)) {
      setResults(null);
      setTooMany(false);
      setShowDropdown(false);
    }
  }, []);

  // Debounced search: only the async fetch lives in the effect
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }

    if (!shouldSearch(query)) return;

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
  }, [results, tooMany, isEasterEgg]);

  return (
    <div ref={containerRef} className="relative">
      <SearchInput
        value={query}
        onChange={handleQueryChange}
        onKeyDown={handleKeyDown}
        onFocus={handleFocus}
        onBlur={() => {
          // Delay hiding to allow click events on dropdown items to fire
          setTimeout(() => {
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
      />
    </div>
  );
}
