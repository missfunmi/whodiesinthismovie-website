import Link from "next/link";

/**
 * Sticky header for the movie detail page.
 * Shows the site logo as a link back to the home/search page.
 */
export default function MovieHeader() {
  return (
    <header className="border-b border-white/10 bg-primary/80 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-4">
        <Link
          href="/"
          className="text-xl font-bold text-white hover:text-white/80 transition-colors"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          Who Dies in This Movie?
        </Link>
      </div>
    </header>
  );
}
