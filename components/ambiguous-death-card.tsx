import type { DeathInfo } from "@/lib/types";

/**
 * Card for an ambiguous/uncertain death.
 * Semi-transparent with a "?" badge. Shows only character name and context.
 */
export default function AmbiguousDeathCard({ death }: { death: DeathInfo }) {
  return (
    <div className="bg-[#1F1F1F]/50 rounded-lg p-6 border border-border relative">
      {/* Question mark badge */}
      <div className="absolute top-4 right-4 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
        <span className="text-xl">?</span>
      </div>

      <h3 className="text-lg font-bold text-gray-400 mb-2 pr-10">
        {death.character}
      </h3>
      <p className="text-sm text-gray-500">{death.context}</p>
    </div>
  );
}
