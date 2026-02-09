"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, HelpCircle } from "lucide-react";
import type { DeathInfo } from "@/lib/types";
import DeathCard from "@/components/death-card";
import AmbiguousDeathCard from "@/components/ambiguous-death-card";
import SkeletonLoader from "@/components/skeleton-loader";

type DeathRevealProps = {
  confirmedDeaths: DeathInfo[];
  ambiguousDeaths: DeathInfo[];
};

/**
 * Death reveal system: toggle button → skeleton loading → death cards.
 * Handles zero deaths, confirmed deaths, and ambiguous deaths sections.
 */
export default function DeathReveal({
  confirmedDeaths,
  ambiguousDeaths,
}: DeathRevealProps) {
  const [isRevealed, setIsRevealed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const totalDeaths = confirmedDeaths.length + ambiguousDeaths.length;

  // Zero deaths — show message directly, no button needed
  if (totalDeaths === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-2xl text-white">
          No deaths! Everyone survives! 🥳
        </p>
      </div>
    );
  }

  const handleReveal = () => {
    setIsLoading(true);
    // 800ms skeleton loading before revealing cards
    setTimeout(() => {
      setIsLoading(false);
      setIsRevealed(true);
    }, 800);
  };

  const handleHide = () => {
    setIsRevealed(false);
  };

  return (
    <div>
      {/* Reveal / Hide button */}
      {!isLoading && (
        <div className="flex justify-center mb-8">
          <button
            onClick={isRevealed ? handleHide : handleReveal}
            className="flex items-center gap-2 text-lg px-8 py-6 bg-white text-primary rounded-md shadow-lg hover:shadow-xl hover:bg-gray-100 transition-all cursor-pointer"
          >
            {isRevealed ? (
              <>
                <ChevronUp className="w-5 h-5" />
                Hide Deaths
              </>
            ) : (
              <>
                <ChevronDown className="w-5 h-5" />
                See who dies in this movie
              </>
            )}
          </button>
        </div>
      )}

      {/* Skeleton loading state */}
      {isLoading && <SkeletonLoader />}

      {/* Revealed death cards */}
      {isRevealed && (
        <>
          {/* Count header */}
          <p className="text-xl font-bold mb-6 text-white">
            {totalDeaths} character{totalDeaths !== 1 ? "s" : ""} died
          </p>

          {/* Confirmed deaths grid */}
          {confirmedDeaths.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
              {confirmedDeaths.map((death) => (
                <DeathCard key={death.id} death={death} />
              ))}
            </div>
          )}

          {/* Ambiguous deaths section */}
          {ambiguousDeaths.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-6">
              <div className="flex items-center gap-2 mb-4">
                <HelpCircle className="w-6 h-6 text-gray-400" />
                <h2 className="text-xl font-bold text-white">
                  Ambiguous Deaths
                </h2>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ambiguousDeaths.map((death) => (
                  <AmbiguousDeathCard key={death.id} death={death} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
