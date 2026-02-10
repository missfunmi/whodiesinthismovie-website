"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Application error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-primary flex flex-col items-center justify-center px-4">
      <h1
        className="text-3xl font-bold text-white mb-4"
        style={{ fontFamily: "var(--font-heading)" }}
      >
        Something went wrong
      </h1>
      <p className="text-gray-400 mb-8 text-center max-w-md">
        We hit an unexpected error. Please try again.
      </p>
      <button
        onClick={reset}
        className="px-6 py-3 bg-white text-primary rounded-md font-medium hover:bg-gray-100 transition-colors"
      >
        Try Again
      </button>
    </div>
  );
}
