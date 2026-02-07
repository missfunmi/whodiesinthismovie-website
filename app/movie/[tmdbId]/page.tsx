import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import MovieHeader from "@/components/movie-header";
import MovieMetadata from "@/components/movie-metadata";
import DeathReveal from "@/components/death-reveal";
import type { Metadata } from "next";
import type { DeathInfo } from "@/lib/types";

type Props = {
  params: Promise<{ tmdbId: string }>;
};

/** Dynamic page title: "Movie Title (Year) | Who Dies in This Movie?" */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tmdbId: tmdbIdParam } = await params;
  const tmdbId = parseInt(tmdbIdParam, 10);

  if (isNaN(tmdbId) || tmdbId <= 0) {
    return { title: "Movie Not Found | Who Dies in This Movie?" };
  }

  const movie = await prisma.movie.findUnique({
    where: { tmdbId },
    select: { title: true, year: true },
  });

  if (!movie) {
    return { title: "Movie Not Found | Who Dies in This Movie?" };
  }

  return {
    title: `${movie.title} (${movie.year}) | Who Dies in This Movie?`,
    description: `Find out which characters die in ${movie.title} (${movie.year}).`,
  };
}

/**
 * Movie detail page — server component.
 * Fetches movie + deaths via Prisma, splits into confirmed/ambiguous,
 * and composes the header, metadata, and death reveal sections.
 */
export default async function MovieDetailPage({ params }: Props) {
  const { tmdbId: tmdbIdParam } = await params;
  const tmdbId = parseInt(tmdbIdParam, 10);

  if (isNaN(tmdbId) || tmdbId <= 0) {
    notFound();
  }

  const movie = await prisma.movie.findUnique({
    where: { tmdbId },
    include: { deaths: true },
  });

  if (!movie) {
    notFound();
  }

  // Split deaths into confirmed and ambiguous for the reveal component
  const confirmedDeaths: DeathInfo[] = movie.deaths.filter(
    (d) => !d.isAmbiguous
  );
  const ambiguousDeaths: DeathInfo[] = movie.deaths.filter(
    (d) => d.isAmbiguous
  );

  return (
    <>
      <MovieHeader />
      <main className="max-w-7xl mx-auto px-4 py-8">
        <MovieMetadata
          title={movie.title}
          year={movie.year}
          director={movie.director}
          tagline={movie.tagline}
          posterPath={movie.posterPath}
          runtime={movie.runtime}
          mpaaRating={movie.mpaaRating}
        />
        <DeathReveal
          confirmedDeaths={confirmedDeaths}
          ambiguousDeaths={ambiguousDeaths}
        />
      </main>
    </>
  );
}
