import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { type Surah, surahGradient } from "@/lib/surahs";

const GROOVES: CSSProperties = {
  backgroundImage:
    "repeating-radial-gradient(circle at center, #0b0b0b 0px, #0b0b0b 1px, #1d1d1d 1.6px, #0b0b0b 2.4px)",
};

// Static light reflection – sits above the spinning disc so the grooves appear to turn under it.
const SHEEN: CSSProperties = {
  backgroundImage:
    "conic-gradient(from 20deg, transparent 0deg, rgba(255,255,255,0.16) 30deg, transparent 62deg, transparent 180deg, rgba(255,255,255,0.12) 210deg, transparent 242deg)",
};

function MosqueSilhouette({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 30"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
      className={className}
    >
      <path
        fill="currentColor"
        d="M0 30V24H16V11L18 6L20 11V24H33Q33 11 50 8Q67 11 67 24H80V11L82 6L84 11V24H100V30Z M49.3 8V3.5H50.7V8Z"
      />
    </svg>
  );
}

export function VinylDisc({
  surah,
  className,
}: {
  surah: Surah;
  className?: string;
}) {
  return (
    <div
      className={cn("@container relative size-full rounded-full", className)}
    >
      <div
        className="vinyl-disc absolute inset-0 rounded-full shadow-[0_12px_26px_-8px_rgba(0,0,0,0.6),inset_0_0_0_1.5px_#2c2c2c]"
        style={GROOVES}
      >
        <div
          className="absolute inset-[17%] overflow-hidden rounded-full shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
          style={{ backgroundImage: surahGradient(surah) }}
        >
          <MosqueSilhouette className="absolute inset-x-0 bottom-[6%] w-full text-black/30" />
          <div className="relative flex h-full flex-col items-center justify-center pb-[10%] text-center">
            <span
              lang="ar"
              dir="rtl"
              className="font-arabic text-[12cqw] leading-[1.15] font-bold text-zinc-900/85"
            >
              {surah.arabic}
            </span>
            <span className="mt-[1.5cqw] text-[3.6cqw] font-semibold tracking-[0.18em] text-zinc-900/75 uppercase">
              {surah.name}
            </span>
          </div>
        </div>
        <div className="absolute top-1/2 left-1/2 size-[5%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-800 shadow-[inset_0_1px_2px_rgba(0,0,0,0.8)]" />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full mix-blend-screen"
        style={SHEEN}
      />
    </div>
  );
}
