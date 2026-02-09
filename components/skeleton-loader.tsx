/**
 * Skeleton loading state for the death reveal animation.
 * Shows 4 pulsing cards in a 2x2 grid (1-col on mobile).
 */
export default function SkeletonLoader() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="bg-white/10 rounded-lg h-40 animate-pulse" />
      ))}
    </div>
  );
}
