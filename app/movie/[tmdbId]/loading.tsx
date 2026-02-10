import MovieHeader from "@/components/movie-header";

/**
 * Movie detail loading skeleton.
 * Mirrors the layout of MovieMetadata + DeathReveal button area.
 * MovieHeader renders immediately (no data fetching) for instant navigation context.
 */
export default function MovieDetailLoading() {
  return (
    <div className="bg-primary min-h-screen">
      <MovieHeader />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Poster + metadata skeleton */}
        <div className="flex flex-col md:flex-row gap-8 mb-12">
          <div className="shrink-0">
            <div className="w-full md:w-75 aspect-2/3 rounded-lg bg-white/10 animate-pulse" />
          </div>
          <div className="flex-1 space-y-4">
            {/* Title */}
            <div className="h-12 w-3/4 bg-white/10 rounded animate-pulse" />
            {/* Year */}
            <div className="h-6 w-20 bg-white/10 rounded animate-pulse" />
            {/* Metadata rows */}
            <div className="space-y-3 mt-6">
              <div className="h-5 w-48 bg-white/10 rounded animate-pulse" />
              <div className="h-5 w-32 bg-white/10 rounded animate-pulse" />
              <div className="h-5 w-28 bg-white/10 rounded animate-pulse" />
            </div>
            {/* Tagline */}
            <div className="h-5 w-64 bg-white/10 rounded animate-pulse mt-4" />
          </div>
        </div>
        {/* Reveal button skeleton */}
        <div className="flex justify-center mb-8">
          <div className="h-16 w-72 bg-white/10 rounded-md animate-pulse" />
        </div>
      </main>
    </div>
  );
}
