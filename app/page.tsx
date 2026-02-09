import Link from "next/link";
import { prisma } from "@/lib/prisma";
import PosterBackground from "@/components/poster-background";
import RotatingTaglines from "@/components/rotating-taglines";
import Search from "@/components/search";

/**
 * Welcome page — the main entry point for the app.
 * Full-viewport layout with poster background, hero heading,
 * rotating taglines, and centered search bar.
 */
export default async function Home() {
  // Fetch poster paths server-side for the background animation
  const movies = await prisma.movie.findMany({
    where: { posterPath: { not: null } },
    select: { posterPath: true },
    take: 30,
    orderBy: { year: "desc" },
  });
  const posterPaths = movies
    .map((m) => m.posterPath)
    .filter((p): p is string => p !== null);

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center px-4">
      <PosterBackground posterPaths={posterPaths} />

      {/* Content layer above the background */}
      <div className="relative z-10 flex flex-col items-center max-w-3xl w-full">
        <h1 className="text-5xl md:text-[56px] font-bold text-white leading-[1.1] text-center mb-6">
          Who Dies in This Movie?
        </h1>

        <RotatingTaglines />

        <div className="w-full mt-8">
          <Search />
        </div>

        <Link
          href="/browse"
          className="mt-6 text-white/60 hover:text-white transition-colors text-sm font-medium"
        >
          Browse All Movies
        </Link>
      </div>
    </main>
  );
}
