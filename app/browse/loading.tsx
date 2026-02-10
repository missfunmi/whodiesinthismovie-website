import MovieHeader from "@/components/movie-header";

/**
 * Browse page loading skeleton.
 * Renders a grid of poster placeholders matching the browse grid breakpoints.
 */
export default function BrowseLoading() {
  return (
    <div className="bg-primary min-h-screen">
      <MovieHeader />
      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Title skeleton */}
        <div className="h-10 w-48 bg-white/10 rounded animate-pulse mb-8" />
        {/* Controls skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="h-5 w-24 bg-white/10 rounded animate-pulse" />
          <div className="h-8 w-40 bg-white/10 rounded animate-pulse" />
        </div>
        {/* Grid skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="aspect-2/3 rounded-lg bg-white/10 animate-pulse"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
