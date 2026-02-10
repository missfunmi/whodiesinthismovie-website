"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const TAGLINES = [
  "Find out who bites the dust so you don't have to bite your nails! 💅",
  "Ruin movie night and spoil the ending for everyone! 😃",
  "Because sometimes knowing is better than wondering! 😇",
  "Spoil the ending, save your sanity! 🎬",
  "Death comes for everyone... but now you'll know when! ⏰",
  "Know the ending before the anxiety ending! 🫠",
  "Spoilers: now 100% guilt-free! ✨",
  "Your therapist will thank us! 🧠",
  "Plot armor? Not in our database! 🛡️",
  "We do the hard watching so you don't have to! 👀",
];

type AnimationVariant = "slideLeft" | "slideRight" | "fadeScale" | "blur" | "typewriter";

const VARIANTS: AnimationVariant[] = [
  "slideLeft",
  "slideRight",
  "fadeScale",
  "blur",
  "typewriter",
];

/** Rotation interval in milliseconds */
const ROTATION_INTERVAL_MS = 4000;
/** Animation duration in milliseconds */
const ANIMATION_DURATION_MS = 600;

/**
 * Get CSS animation string for enter/exit based on variant.
 */
function getAnimation(variant: AnimationVariant, isExiting: boolean): string {
  const duration = `${ANIMATION_DURATION_MS}ms`;
  const easing = "ease-in-out";
  const fill = "forwards";

  const animations: Record<AnimationVariant, { enter: string; exit: string }> = {
    slideLeft: {
      enter: `slideInLeft ${duration} ${easing} ${fill}`,
      exit: `slideOutRight ${duration} ${easing} ${fill}`,
    },
    slideRight: {
      enter: `slideInRight ${duration} ${easing} ${fill}`,
      exit: `slideOutLeft ${duration} ${easing} ${fill}`,
    },
    fadeScale: {
      enter: `fadeScaleIn ${duration} ${easing} ${fill}`,
      exit: `fadeScaleOut ${duration} ${easing} ${fill}`,
    },
    blur: {
      enter: `blurIn ${duration} ${easing} ${fill}`,
      exit: `blurOut ${duration} ${easing} ${fill}`,
    },
    typewriter: {
      enter: `typewriter ${duration} steps(40) ${fill}`,
      exit: `fadeScaleOut ${duration} ${easing} ${fill}`,
    },
  };

  return isExiting ? animations[variant].exit : animations[variant].enter;
}

function pickRandomVariant(): AnimationVariant {
  return VARIANTS[Math.floor(Math.random() * VARIANTS.length)];
}

/**
 * Rotating taglines component.
 * Displays one tagline at a time, cycling every 4s with random animation variants.
 * Fixed 80px height prevents layout shift.
 */
export default function RotatingTaglines() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [variant, setVariant] = useState<AnimationVariant>("fadeScale");
  const [isExiting, setIsExiting] = useState(false);
  // Skip animation on the very first render so the tagline is immediately visible.
  // Without this, the fadeScaleIn animation starts at opacity: 0, and reduced-motion
  // overrides (0.01ms duration) can prevent the animation from completing, leaving
  // the tagline invisible. Uses state (not ref) because it affects render output.
  const [hasRotated, setHasRotated] = useState(false);
  const prefersReducedMotion = useRef(false);
  // Track pending rotation timeout so it can be cleared on unmount
  const rotateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against state updates after unmount
  const isMountedRef = useRef(true);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    return () => { isMountedRef.current = false; };
  }, []);

  const rotate = useCallback(() => {
    if (!isMountedRef.current) return;
    setHasRotated(true);

    // Start exit animation
    setIsExiting(true);

    // Clear any existing timeout before setting a new one
    if (rotateTimeoutRef.current) clearTimeout(rotateTimeoutRef.current);

    // After exit animation, swap tagline and enter
    rotateTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      setCurrentIndex((prev) => (prev + 1) % TAGLINES.length);
      setVariant(pickRandomVariant());
      setIsExiting(false);
    }, prefersReducedMotion.current ? 10 : ANIMATION_DURATION_MS);
  }, []);

  useEffect(() => {
    const interval = setInterval(rotate, ROTATION_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      if (rotateTimeoutRef.current) clearTimeout(rotateTimeoutRef.current);
    };
  }, [rotate]);

  const isTypewriter = variant === "typewriter" && !isExiting;

  return (
    <div className="h-20 w-full flex items-center justify-center overflow-hidden relative">
      <p
        key={currentIndex}
        className="text-lg md:text-xl text-gray-300 text-center absolute left-0 right-0"
        style={{
          // Skip animation on the very first render — tagline just appears.
          // Subsequent rotations animate normally.
          ...(hasRotated
            ? {
                animation: getAnimation(variant, isExiting),
                // Typewriter needs hidden overflow and no-wrap to animate width
                ...(isTypewriter
                  ? { overflow: "hidden", whiteSpace: "nowrap" as const }
                  : {}),
              }
            : {}),
        }}
      >
        {TAGLINES[currentIndex]}
      </p>
    </div>
  );
}
