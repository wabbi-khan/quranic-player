"use client";

import { useRef } from "react";
import { gsap, useGSAP } from "@/lib/gsap";
import { cn } from "@/lib/utils";
import { RECITER, SURAHS, surahGradient } from "@/lib/surahs";
import { VinylDisc } from "./vinyl-disc";

const UP_NEXT = 3;

/**
 * "Now playing" card: the surah's name drawn in calligraphy, its details, the reciter,
 * and the surahs that Next will play.
 */
export function SurahInfo({
  current,
  onPick,
  className,
}: {
  current: number | null;
  onPick: (index: number) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const surah = current === null ? null : SURAHS[current];
  const start = current === null ? 0 : current + 1;
  const upNext = Array.from({ length: UP_NEXT }, (_, k) => (start + k) % SURAHS.length);

  useGSAP(
    () => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
      // Arabic is written right → left, so the name is revealed from the right edge.
      tl.fromTo(
        "[data-calligraphy]",
        { clipPath: "inset(0 0 0 100%)", filter: "blur(6px)", opacity: 0.4 },
        { clipPath: "inset(0 0 0 0%)", filter: "blur(0px)", opacity: 1, duration: 1.1, ease: "power2.inOut" },
      )
        .from("[data-info-line]", { y: 12, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.6")
        .from("[data-chip]", { scale: 0.6, opacity: 0, duration: 0.4, stagger: 0.06, ease: "back.out(2)" }, "-=0.3")
        .from("[data-next]", { x: -18, opacity: 0, duration: 0.45, stagger: 0.07 }, "-=0.3");
    },
    { scope: root, dependencies: [current], revertOnUpdate: true },
  );

  return (
    <aside
      ref={root}
      aria-label="Now playing"
      className={cn(
        "relative flex flex-col overflow-hidden rounded-md border border-white/60 bg-white/55 p-6 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.45)] backdrop-blur-md",
        className,
      )}
    >
      {/* soft wash of the surah's colours */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -left-24 size-64 rounded-full opacity-30 blur-3xl transition-[background-image] duration-700"
        style={{ backgroundImage: surah ? surahGradient(surah) : "radial-gradient(#fdba74, transparent)" }}
      />

      <p className="relative text-[9px] font-medium tracking-[0.28em] text-zinc-500 uppercase">
        {surah ? "Now playing" : "Quran Ayat Play"}
      </p>

      {surah ? (
        <div className="relative mt-3">
          <p
            data-calligraphy
            lang="ar"
            dir="rtl"
            className="text-right font-arabic text-6xl leading-[1.5] font-bold text-zinc-900"
          >
            {surah.arabic}
          </p>
          <h2 data-info-line className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            {surah.name}
          </h2>
          <p data-info-line className="text-sm text-zinc-600">
            {surah.meaning}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {[`Surah ${surah.number}`, surah.revelation, `${surah.ayahs} ayahs`, `Juz ${surah.juz}`].map((chip) => (
              <span
                key={chip}
                data-chip
                className="rounded-full border border-zinc-900/10 bg-white/70 px-2.5 py-0.5 text-[11px] font-medium text-zinc-700"
              >
                {chip}
              </span>
            ))}
          </div>
          <p data-info-line className="mt-4 text-xs text-zinc-500">
            Recited by <span className="font-medium text-zinc-700">{RECITER}</span>
          </p>
        </div>
      ) : (
        <div className="relative mt-3">
          <p data-calligraphy lang="ar" dir="rtl" className="text-right font-arabic text-5xl leading-[1.6] font-bold text-zinc-900/80">
            القرآن الكريم
          </p>
          <h2 data-info-line className="mt-1 text-xl font-semibold tracking-tight text-zinc-900">
            Choose a surah
          </h2>
          <p data-info-line className="mt-1 text-sm leading-relaxed text-zinc-600">
            Drag a vinyl from the reel into the player, or tap one below. The ayahs appear as they&apos;re recited.
          </p>
        </div>
      )}

      <div className="relative mt-auto pt-6">
        <p className="mb-2 text-[9px] font-medium tracking-[0.28em] text-zinc-500 uppercase">
          {surah ? "Up next" : "Start with"}
        </p>
        <ul className="flex flex-col gap-1">
          {upNext.map((i) => (
            <li key={SURAHS[i].number} data-next>
              <button
                type="button"
                onClick={() => onPick(i)}
                className="group flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/70 focus-visible:bg-white/70 focus-visible:outline-none"
              >
                <span className="size-9 shrink-0 transition-transform duration-500 group-hover:rotate-180">
                  <VinylDisc surah={SURAHS[i]} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-zinc-800">{SURAHS[i].name}</span>
                  <span className="block truncate text-[11px] text-zinc-500">
                    {SURAHS[i].meaning} · {SURAHS[i].ayahs} ayahs
                  </span>
                </span>
                <span lang="ar" dir="rtl" className="font-arabic text-lg text-zinc-700">
                  {SURAHS[i].arabic}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
