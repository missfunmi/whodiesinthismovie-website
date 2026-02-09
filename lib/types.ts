/**
 * Shared TypeScript types for the application.
 * These mirror Prisma model shapes but are decoupled for use in client components.
 */

/** Shape returned by the search API for autocomplete results */
export type MovieSearchResult = {
  tmdbId: number;
  title: string;
  year: number;
  posterPath: string | null;
};

/** Full movie detail with deaths, used on the movie detail page */
export type MovieDetail = {
  id: number;
  tmdbId: number;
  title: string;
  year: number;
  director: string;
  tagline: string | null;
  posterPath: string | null;
  runtime: number;
  mpaaRating: string;
  deaths: DeathInfo[];
};

/** Individual death record */
export type DeathInfo = {
  id: number;
  character: string;
  timeOfDeath: string;
  cause: string;
  killedBy: string;
  context: string;
  isAmbiguous: boolean;
};

/** Movie entry for the browse grid (includes createdAt for "NEW!" badge) */
export type BrowseMovie = MovieSearchResult & {
  createdAt: string;
};

/** Paginated browse API response */
export type BrowseResponse = {
  movies: BrowseMovie[];
  totalPages: number;
  currentPage: number;
};

/** Union type for the search API response */
export type SearchResponse =
  | MovieSearchResult[]
  | { tooMany: true; count: number };

/** Response from POST /api/movies/request */
export type MovieRequestResponse = {
  success: boolean;
  message: string;
  existingMovie?: MovieSearchResult;
};

/** Request state machine for the search component's movie request flow */
export type RequestStatus = "idle" | "loading" | "success" | "error";
