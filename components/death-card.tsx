import { Clock, Skull, Target } from "lucide-react";
import type { DeathInfo } from "@/lib/types";

/**
 * Card displaying a confirmed character death.
 * Shows character name, time/cause/killer with icons, and context.
 */
export default function DeathCard({ death }: { death: DeathInfo }) {
  return (
    <div className="bg-[#1F1F1F] rounded-lg p-6 border border-white/10 hover:-translate-y-1 hover:shadow-xl transition-all duration-200">
      <h3 className="text-lg font-bold text-white mb-4">{death.character}</h3>

      <div className="space-y-3">
        {/* Time of Death */}
        <div className="flex items-start gap-3">
          <Clock className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-gray-400">Time</p>
            <p className="text-base text-gray-100">{death.timeOfDeath}</p>
          </div>
        </div>

        {/* Cause of Death */}
        <div className="flex items-start gap-3">
          <Skull className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-gray-400">Cause</p>
            <p className="text-base text-gray-100">{death.cause}</p>
          </div>
        </div>

        {/* Killed By */}
        <div className="flex items-start gap-3">
          <Target className="w-5 h-5 text-gray-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-gray-400">By</p>
            <p className="text-base text-gray-100">{death.killedBy}</p>
          </div>
        </div>
      </div>

      {/* Context */}
      <div className="mt-4 pt-4 border-t border-white/10">
        <p className="text-sm text-gray-400">{death.context}</p>
      </div>
    </div>
  );
}
