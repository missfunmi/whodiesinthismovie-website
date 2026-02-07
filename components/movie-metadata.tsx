import Image from "next/image";
import { Film } from "lucide-react";
import { formatRuntime, getPosterUrl } from "@/lib/utils";

type MovieMetadataProps = {
  title: string;
  year: number;
  director: string;
  tagline: string | null;
  posterPath: string | null;
  runtime: number;
  mpaaRating: string;
};

/**
 * Movie metadata section: poster alongside title, year, director, runtime, rating, tagline.
 * Responsive: side-by-side on desktop, stacked on mobile.
 */
export default function MovieMetadata({ title, year, director, tagline, posterPath, runtime, mpaaRating }: MovieMetadataProps) {
  const posterUrl = getPosterUrl(posterPath);

  return (
    <div className="flex flex-col md:flex-row gap-8 mb-12">
      {/* Poster */}
      <div className="flex-shrink-0">
        {posterUrl ? (
          <Image
            src={posterUrl}
            alt={`${title} poster`}
            width={300}
            height={450}
            className="w-full md:w-[300px] rounded-lg shadow-2xl"
            priority
          />
        ) : (
          <div className="w-full md:w-[300px] h-[450px] rounded-lg shadow-2xl bg-muted flex items-center justify-center">
            <Film className="w-16 h-16 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="flex-1">
        <h1 className="text-4xl md:text-5xl font-bold mb-2 text-foreground">
          {title}
        </h1>
        <p className="text-xl text-muted-foreground mb-4">{year}</p>

        <div className="space-y-3 mb-6">
          <p>
            <span className="text-muted-foreground">Director </span>
            <span className="text-foreground">{director}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Runtime </span>
            <span className="text-foreground">{formatRuntime(runtime)}</span>
          </p>
          <p>
            <span className="text-muted-foreground">Rated </span>
            <span className="text-foreground">{mpaaRating}</span>
          </p>
        </div>

        {tagline && (
          <p className="italic text-lg text-muted-foreground">
            &ldquo;{tagline}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
