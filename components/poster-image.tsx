"use client";

import { useState } from "react";
import Image from "next/image";
import { Film } from "lucide-react";

type PosterImageProps = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
  /** Classes applied to the fallback container when the image fails to load */
  fallbackClassName?: string;
  /** Classes for the Film icon inside the fallback */
  fallbackIconClassName?: string;
  priority?: boolean;
  sizes?: string;
  fill?: boolean;
};

/**
 * Poster image with automatic fallback on load errors.
 * Wraps next/image with an onError handler that swaps in a Film icon placeholder.
 * Prevents broken image icons when TMDB CDN is down or a poster 404s.
 */
export default function PosterImage({
  src,
  alt,
  width,
  height,
  className,
  fallbackClassName,
  fallbackIconClassName = "w-12 h-12 text-gray-500",
  priority,
  sizes,
  fill,
}: PosterImageProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className={fallbackClassName}>
        <Film className={fallbackIconClassName} />
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      className={className}
      priority={priority}
      sizes={sizes}
      fill={fill}
      onError={() => setHasError(true)}
    />
  );
}
