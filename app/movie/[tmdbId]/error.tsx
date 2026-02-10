"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function MovieError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Movie page error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-primary flex flex-col items-center justify-center px-4">
      <h1
        className="text-3xl font-bold text-white mb-4"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Couldn&apos;t load this movie
      </h1>
      <p className="text-gray-400 mb-8 text-center max-w-md">
        Something went wrong loading the movie details. Please try again.
      </p>
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="px-6 py-3 bg-white text-primary rounded-md font-medium hover:bg-gray-100 transition-colors"
        >
          Try Again
        </button>
        <Link
          href="/"
          className="px-6 py-3 border border-white/20 text-white rounded-md font-medium hover:bg-white/10 transition-colors"
        >
          Back to Search
        </Link>
      </div>
    </div>
  );
}
