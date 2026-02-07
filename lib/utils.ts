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
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}
