"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Image from "next/image";
import { getPosterUrl } from "@/lib/utils";

/** Number of poster slots visible simultaneously */
const SLOT_COUNT = 8;
/** Interval between poster swaps in milliseconds */
const SWAP_INTERVAL_MS = 4500;

/**
 * Distributed grid positions for the 8 poster slots.
 * Arranged in a 4x2 pattern to cover the viewport.
 */
const SLOT_POSITIONS = [
  { top: "0%", left: "0%" },
  { top: "0%", left: "25%" },
  { top: "0%", left: "50%" },
  { top: "0%", left: "75%" },
  { top: "50%", left: "0%" },
  { top: "50%", left: "25%" },
  { top: "50%", left: "50%" },
  { top: "50%", left: "75%" },
];

type PosterBackgroundProps = {
  posterPaths: string[];
};

/**
 * Animated poster background for the welcome page.
 * Displays 8 poster slots in a grid with crossfade transitions.
 * One poster is swapped out every ~4.5s in a round-robin pattern.
 */
export default function PosterBackground({ posterPaths }: PosterBackgroundProps) {
  // Use first 8 deterministically to avoid hydration mismatch
  const [currentPosters, setCurrentPosters] = useState<string[]>(() =>
    posterPaths.slice(0, SLOT_COUNT)
  );
  // Track which slot to replace next and which poster from the pool to use
  const nextSlotRef = useRef(0);
  const nextPoolIndexRef = useRef(SLOT_COUNT);
  // Track which slot is currently fading (opacity 0)
  const [fadingSlot, setFadingSlot] = useState<number | null>(null);
  const prefersReducedMotion = useRef(false);
  // Track pending swap timeout so it can be cleared on unmount
  const swapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check for reduced motion preference
  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  const swapPoster = useCallback(() => {
    if (prefersReducedMotion.current || posterPaths.length <= SLOT_COUNT) return;

    const slotIndex = nextSlotRef.current;
    const poolIndex = nextPoolIndexRef.current;

    // Fade out the current poster in this slot
    setFadingSlot(slotIndex);

    // Clear any existing timeout before setting a new one
    if (swapTimeoutRef.current) clearTimeout(swapTimeoutRef.current);

    // After the fade-out transition completes, swap the poster and fade back in
    swapTimeoutRef.current = setTimeout(() => {
      setCurrentPosters((prev) => {
        const updated = [...prev];
        updated[slotIndex] = posterPaths[poolIndex % posterPaths.length];
        return updated;
      });
      setFadingSlot(null);

      // Advance to next slot and next pool poster
      nextSlotRef.current = (slotIndex + 1) % SLOT_COUNT;
      nextPoolIndexRef.current = poolIndex + 1;
    }, 2000); // Half the transition duration for the swap point
  }, [posterPaths]);

  useEffect(() => {
    const interval = setInterval(swapPoster, SWAP_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (swapTimeoutRef.current) clearTimeout(swapTimeoutRef.current);
    };
  }, [swapPoster]);

  if (posterPaths.length === 0) return null;

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Poster grid */}
      {currentPosters.map((path, index) => {
        const posterUrl = getPosterUrl(path);
        if (!posterUrl) return null;

        const position = SLOT_POSITIONS[index];
        const isFading = fadingSlot === index;

        return (
          <div
            key={`slot-${index}`}
            className="absolute w-[25%] h-[50%] transition-opacity duration-[4000ms] ease-in-out"
            style={{
              top: position.top,
              left: position.left,
              opacity: isFading ? 0 : 0.6,
            }}
          >
            <Image
              src={posterUrl}
              alt=""
              fill
              className="object-cover"
              sizes="25vw"
              priority={index < 4}
            />
          </div>
        );
      })}

      {/* Dark overlay with blur */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
    </div>
  );
}
