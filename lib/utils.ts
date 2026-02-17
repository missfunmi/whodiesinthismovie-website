import DOMPurify from "isomorphic-dompurify";

/**
 * Sanitize user input by stripping all HTML tags and attributes.
 * Uses DOMPurify with ALLOWED_TAGS=[] to ensure no HTML passes through,
 * covering encoded entities, event handlers, and non-script XSS vectors.
 */
export function sanitizeInput(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] }).trim();
}

/**
 * Format runtime in minutes to "Xh Ym" display string.
 * Example: 152 → "2h 32m"
 */
export function formatRuntime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/**
 * Build full TMDB poster URL from a posterPath.
 * Returns null if posterPath is null/undefined.
 */
export function getPosterUrl(
  posterPath: string | null | undefined,
  size: "w92" | "w300" = "w300"
): string | null {
  if (!posterPath) return null;
  const raw =
    process.env.NEXT_PUBLIC_TMDB_IMAGE_BASE || "https://image.tmdb.org/t/p";
  const baseUrl = raw.endsWith("/") ? raw : `${raw}/`;
  return `${baseUrl}${size}${posterPath}`;
}

/**
 * Extract an optional trailing 4-digit year (1900–2099) from a search query.
 * Handles both bare years and parenthesized years: "Matrix 1999", "Matrix (1999)".
 * The year must be at the END of the string, preceded by whitespace and at
 * least one non-year character. A year at the START is treated as part of
 * the title (e.g., "2001 a space odyssey" → year=null).
 *
 * Examples:
 *   "matrix 1999"          → { title: "matrix", year: 1999 }
 *   "matrix (1999)"        → { title: "matrix", year: 1999 }
 *   "the matrix"           → { title: "the matrix", year: null }
 *   "2001 a space odyssey" → { title: "2001 a space odyssey", year: null }
 *   "1917 2019"            → { title: "1917", year: 2019 }
 *   "alien 3 1992"         → { title: "alien 3", year: 1992 }
 *   "1999"                 → { title: "1999", year: null }
 */
export function parseQueryWithYear(query: string): {
  title: string;
  year: number | null;
} {
  const trimmed = query.trim();
  // Matches "Title 1999" or "Title (1999)" with flexible whitespace
  const match = trimmed.match(/^(.+?)\s*\(?((?:19|20)\d{2})\)?$/);
  if (match && match[1].trim().length > 0) {
    return { title: match[1].trim(), year: parseInt(match[2], 10) };
  }
  return { title: trimmed, year: null };
}
