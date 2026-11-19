"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import {
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { gsap, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { SURAHS, surahAudioUrl, surahGradient } from "@/lib/surahs";
import { VinylDisc } from "./vinyl-disc";

const N = SURAHS.length;
/** Copies of the surah list in the reel, so it can loop endlessly on wide screens. */
const COPIES = 3;
const REEL = Array.from({ length: N * COPIES }, (_, k) => k);
/** Untransformed size of the floating "flyer" vinyls (matches size-[200px]). */
const FLYER = 200;
const SPIN_SECONDS = 3.2;
/** localStorage key for the listener's preferred volume. */
const VOLUME_KEY = "quran-ayat-play:volume";
/** Reel wave: max vertical amplitude (px) and wavelength relative to reel width. */
const WAVE_AMP = 48;
const WAVE_LENGTH = 1.1;

const DEFAULT_ART =
  "linear-gradient(175deg, #ffc86b 0%, #ff7a3d 50%, #5a2a78 100%)";
const STEEL_BG = {
  backgroundImage: [
    "repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0px, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 3px)",
    "linear-gradient(100deg, #8b9095 0%, #c9ccd0 18%, #999da2 36%, #d6d9dc 52%, #a2a6ab 70%, #c5c8cc 86%, #8e9297 100%)",
  ].join(","),
};

type Actions = {
  activate: (s: number, item?: HTMLElement) => void;
  togglePlay: () => void;
  step: (dir: 1 | -1) => void;
  focusItem: (item: HTMLElement) => void;
  onAudioPlay: () => void;
  onAudioPause: () => void;
};

type Gesture = {
  id: number;
  source: "reel" | "dock";
  x0: number;
  y0: number;
  lastX: number;
  lastT: number;
  vx: number;
  mode: "pending" | "scroll" | "carry";
  surah: number | null;
  item: HTMLElement | null;
};

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60)
    .toString()
    .padStart(2, "0");
  return h ? `${h}:${m.toString().padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function QuranPlayer() {
  const root = useRef<HTMLDivElement>(null);
  const wellRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLDivElement>(null);
  const panelLightRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const flyerRefs = useRef<(HTMLDivElement | null)[]>([]);
  const actions = useRef<Actions | null>(null);
  const ringTextId = useId();

  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);

  const changeVolume = (v: number) => {
    const audio = audioRef.current;
    setVolume(v);
    if (audio) audio.volume = v;
    // Dragging the volume up un-mutes; dragging it to zero counts as muted.
    const mute = v === 0;
    setMuted(mute);
    if (audio) audio.muted = mute;
    try {
      localStorage.setItem(VOLUME_KEY, String(v));
    } catch {}
  };
  const toggleMute = () => {
    const audio = audioRef.current;
    // Un-muting from zero restores a sensible level instead of staying silent.
    if (muted && volume === 0) return changeVolume(0.5);
    setMuted(!muted);
    if (audio) audio.muted = !muted;
  };

  useGSAP(
    (_ctx, contextSafe) => {
      const safe = contextSafe!;
      const well = wellRef.current!;
      const dock = dockRef.current!;
      // Ring light + panel light flicker, dim and switch off together.
      const light = [lightRef.current!, panelLightRef.current!];
      const audio = audioRef.current!;

      // Restore the listener's saved volume (falls back to the default if storage is unavailable).
      let savedVolume = 0.8;
      try {
        const v = Number.parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
        if (v >= 0 && v <= 1) savedVolume = v;
      } catch {}
      audio.volume = savedVolume;
      audio.muted = savedVolume === 0;
      setVolume(savedVolume);
      setMuted(savedVolume === 0);
      const reel = reelRef.current!;
      const items = itemRefs.current as HTMLDivElement[];
      const flyers = flyerRefs.current as HTMLDivElement[];
      const face = (item: HTMLElement) =>
        item.querySelector<HTMLElement>(".vinyl-face")!;
      const itemDiscs = items.map(
        (el) => el.querySelector<HTMLElement>(".vinyl-disc")!,
      );
      const flyerDisc = (s: number) =>
        flyers[s].querySelector<HTMLElement>(".vinyl-disc")!;
      const dockDisc = () => dock.querySelector<HTMLElement>(".vinyl-disc")!;
      const surahOf = (item: HTMLElement) => Number(item.dataset.surah);

      let docked: number | null = null; // surah index in the player
      let landed = false; // docked vinyl has finished flying into the well
      let spin: gsap.core.Tween | null = null;
      let gesture: Gesture | null = null;
      const flights: (gsap.core.Tween | null)[] = Array(N).fill(null);

      gsap.set(flyers, { autoAlpha: 0, transformOrigin: "50% 50%" });

      // ================= reel: endless, inertial, bends into a wave with speed =================
      const reelState = {
        target: 0,
        pos: 0,
        bend: 0,
        itemW: 160,
        vw: 1,
        roll: 0,
      };
      const measure = () => {
        reelState.itemW = items[0].offsetWidth;
        reelState.vw = reel.clientWidth;
      };
      measure();
      const span = () => reelState.itemW * items.length;
      const itemX = (i: number) =>
        gsap.utils.wrap(
          -reelState.itemW,
          span() - reelState.itemW,
          i * reelState.itemW - reelState.pos,
        );
      // Start with the second copy of the first surah centred.
      reelState.target = reelState.pos =
        N * reelState.itemW - (reelState.vw - reelState.itemW) / 2;

      const tick = () => {
        const s = reelState;
        const prev = s.pos;
        s.pos += (s.target - s.pos) * 0.085;
        if (Math.abs(s.target - s.pos) < 0.01) s.pos = s.target;
        const velocity = s.pos - prev;
        s.bend += (gsap.utils.clamp(-1, 1, velocity / 26) - s.bend) * 0.12;

        const k = (Math.PI * 2) / (s.vw * WAVE_LENGTH);
        const amp = WAVE_AMP * s.bend;
        const discR = face(items[0]).offsetWidth / 2 || 60;
        s.roll = ((-s.pos / discR) * 180) / Math.PI;
        items.forEach((el, i) => {
          const x = itemX(i);
          const c = x + s.itemW / 2 - s.vw / 2;
          const y = amp * Math.sin(c * k);
          const tilt = (Math.atan(amp * k * Math.cos(c * k)) * 180) / Math.PI;
          el.style.transform = `translate3d(${x}px, ${y}px, 0) rotate(${tilt}deg)`;
          itemDiscs[i].style.transform = `rotate(${s.roll}deg)`;
        });
      };
      tick();
      gsap.ticker.add(tick);

      const nearestItem = (s: number) => {
        let best = items[s];
        let bestD = Infinity;
        items.forEach((el, i) => {
          if (i % N !== s) return;
          const d = Math.abs(itemX(i) + reelState.itemW / 2 - reelState.vw / 2);
          if (d < bestD) [best, bestD] = [el, d];
        });
        return best;
      };
      const centerItem = (item: HTMLElement) => {
        const i = items.indexOf(item as HTMLDivElement);
        reelState.target =
          reelState.pos + itemX(i) + reelState.itemW / 2 - reelState.vw / 2;
      };
      const setAway = (s: number, away: boolean) =>
        items.forEach((el, i) => {
          if (i % N === s) el.dataset.away = String(away);
        });

      // ================= flyers: the vinyl that travels between reel and player =================
      const rectVars = (r: DOMRect) => ({
        x: r.left + r.width / 2 - FLYER / 2,
        y: r.top + r.height / 2 - FLYER / 2,
        scale: r.width / FLYER,
      });
      const killFlight = (s: number) => {
        flights[s]?.kill();
        flights[s] = null;
        gsap.killTweensOf(flyers[s]);
      };
      const showFlyerAt = (s: number, r: DOMRect, rotation: number) => {
        killFlight(s);
        gsap.set(flyers[s], { ...rectVars(r), autoAlpha: 1, zIndex: 60 });
        gsap.set(flyerDisc(s), { rotation });
      };
      /** Fly to a (possibly moving) element, re-reading its position every frame. */
      const flyTo = (
        s: number,
        getRect: () => DOMRect,
        getRot: () => number,
        onComplete: () => void,
        duration = 0.7,
      ) => {
        const f = flyers[s];
        const from = {
          x: Number(gsap.getProperty(f, "x")),
          y: Number(gsap.getProperty(f, "y")),
          scale: Number(gsap.getProperty(f, "scale")),
          rot: Number(gsap.getProperty(flyerDisc(s), "rotation")),
        };
        flights[s]?.kill(); // a new flight replaces any flight this vinyl is still on
        const p = { t: 0 };
        flights[s] = gsap.to(p, {
          t: 1,
          duration,
          ease: "power3.inOut",
          onUpdate: () => {
            const to = rectVars(getRect());
            const lerp = (a: number, b: number) => a + (b - a) * p.t;
            gsap.set(f, {
              x: lerp(from.x, to.x),
              y: lerp(from.y, to.y),
              scale: lerp(from.scale, to.scale),
            });
            gsap.set(flyerDisc(s), { rotation: lerp(from.rot, getRot()) });
          },
          onComplete: () => {
            flights[s] = null;
            onComplete();
          },
        });
      };
      const returnToReel = (s: number) => {
        gsap.set(flyers[s], { zIndex: 55 });
        const item = nearestItem(s);
        flyTo(
          s,
          () => face(item).getBoundingClientRect(),
          () => reelState.roll,
          () => {
            setAway(s, false);
            gsap.set(flyers[s], { autoAlpha: 0 });
          },
          0.75,
        );
      };

      // ================= spin + light =================
      const resetSpin = () => {
        spin?.kill();
        spin = null;
      };
      const startSpin = () => {
        spin ??= gsap.to(dockDisc(), {
          rotation: "+=360",
          duration: SPIN_SECONDS,
          ease: "none",
          repeat: -1,
          paused: true,
        });
        if (spin.paused()) spin.timeScale(0.001).play();
        gsap.to(spin, {
          timeScale: 1,
          duration: 1,
          ease: "power1.in",
          overwrite: true,
        });
      };
      const stopSpin = () => {
        const t = spin;
        if (!t || t.paused()) return;
        gsap.to(t, {
          timeScale: 0,
          duration: 0.9,
          ease: "power2.out",
          overwrite: true,
          onComplete: () => void t.pause(),
        });
      };
      const lightOn = () =>
        gsap
          .timeline()
          .to(light, { opacity: 0.9, duration: 0.05 })
          .to(light, { opacity: 0.15, duration: 0.08 })
          .to(light, { opacity: 0.75, duration: 0.05 })
          .to(light, { opacity: 0.3, duration: 0.1 })
          .to(light, {
            opacity: audio.paused ? 0.5 : 1,
            duration: 0.6,
            ease: "power2.out",
          });
      const lightTo = (opacity: number) =>
        gsap.to(light, { opacity, duration: 0.6, overwrite: true });

      // ================= audio =================
      const playSurah = (s: number) => {
        const n = String(SURAHS[s].number);
        if (audio.dataset.surah !== n) {
          audio.dataset.surah = n;
          audio.src = surahAudioUrl(SURAHS[s].number);
          setTime(0);
          setDuration(0);
        }
        // Called synchronously from the user's gesture so browsers allow playback.
        audio.play().catch(() => setPlaying(false));
      };

      // ================= docking =================
      /** Put surah `s` in the player. Its flyer must already be visible (dragged), or pass `source`. */
      const dockSurah = (s: number, source?: HTMLElement) => {
        if (source) {
          showFlyerAt(s, face(source).getBoundingClientRect(), reelState.roll);
          setAway(s, true);
        }
        const prev = docked;
        if (prev !== null && prev !== s) {
          // Swap: the previous vinyl flies back to the reel – lifted out of the player if it
          // had landed, or turned around mid-air if it was still on its way in.
          if (landed) {
            showFlyerAt(
              prev,
              dock.getBoundingClientRect(),
              Number(gsap.getProperty(dockDisc(), "rotation")),
            );
          }
          returnToReel(prev);
        }
        const restart = prev !== s;
        docked = s;
        landed = false;
        setCurrent(s);
        gsap.set(dock, { autoAlpha: 0 });
        gsap.set(flyers[s], { zIndex: 60 });
        playSurah(s);
        flyTo(
          s,
          () => dock.getBoundingClientRect(),
          () => Number(gsap.getProperty(flyerDisc(s), "rotation")),
          () => {
            // Safety net: never leave a vinyl hanging if it was replaced while flying in.
            if (docked !== s) return returnToReel(s);
            landed = true;
            resetSpin();
            gsap.set(dockDisc(), {
              rotation: gsap.getProperty(flyerDisc(s), "rotation"),
            });
            gsap.set(dock, { autoAlpha: 1 });
            gsap.set(flyers[s], { autoAlpha: 0 });
            if (restart) lightOn();
            else lightTo(audio.paused ? 0.5 : 1);
            if (!audio.paused) startSpin();
          },
        );
      };

      const eject = () => {
        const s = docked;
        if (s === null) return;
        docked = null;
        landed = false;
        setCurrent(null);
        resetSpin();
        audio.pause();
        lightTo(0);
        returnToReel(s);
      };

      const togglePlay = () => {
        if (docked === null) {
          const centre = items.reduce((a, b) =>
            Math.abs(
              itemX(items.indexOf(a)) + reelState.itemW / 2 - reelState.vw / 2,
            ) <
            Math.abs(
              itemX(items.indexOf(b)) + reelState.itemW / 2 - reelState.vw / 2,
            )
              ? a
              : b,
          );
          return dockSurah(surahOf(centre), centre);
        }
        if (audio.paused) playSurah(docked);
        else audio.pause();
      };

      const activate = (s: number, item?: HTMLElement) => {
        if (s === docked) return togglePlay();
        const source = item ?? nearestItem(s);
        dockSurah(s, source);
        centerItem(source);
      };

      // ================= pointer gestures (reel scroll / carry vinyl) =================
      const overWell = (x: number, y: number) => {
        const r = well.getBoundingClientRect();
        return (
          Math.hypot(x - (r.left + r.width / 2), y - (r.top + r.height / 2)) <
          r.width * 0.62
        );
      };

      const startCarry = (g: Gesture) => {
        const s = g.surah!;
        if (g.source === "dock") {
          showFlyerAt(
            s,
            dock.getBoundingClientRect(),
            Number(gsap.getProperty(dockDisc(), "rotation")),
          );
          gsap.set(dock, { autoAlpha: 0 });
          stopSpin();
          lightTo(0.3);
          landed = false;
        } else {
          showFlyerAt(s, face(g.item!).getBoundingClientRect(), reelState.roll);
          setAway(s, true);
        }
        const carryScale = (face(items[0]).offsetWidth * 1.12) / FLYER;
        gsap.to(flyers[s], {
          scale: carryScale,
          duration: 0.3,
          ease: "power2.out",
        });
        g.mode = "carry";
      };

      const onDown = (source: Gesture["source"]) => (e: PointerEvent) => {
        if (gesture || e.button > 0) return;
        const item =
          source === "reel"
            ? (e.target as Element).closest<HTMLElement>("[data-reel-item]")
            : null;
        const surah = source === "dock" ? docked : item ? surahOf(item) : null;
        if (source === "dock" && (surah === null || !landed)) return;
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        gesture = {
          id: e.pointerId,
          source,
          x0: e.clientX,
          y0: e.clientY,
          lastX: e.clientX,
          lastT: e.timeStamp,
          vx: 0,
          mode: "pending",
          surah,
          item,
        };
      };

      const onMove = (e: PointerEvent) => {
        const g = gesture;
        if (!g || e.pointerId !== g.id) return;
        const dx = e.clientX - g.x0;
        const dy = e.clientY - g.y0;
        if (g.mode === "pending") {
          if (Math.hypot(dx, dy) < 6) return;
          const upward = -dy > Math.abs(dx) * 0.8;
          if (g.source === "dock") startCarry(g);
          else if (g.surah !== null && g.surah !== docked && upward)
            startCarry(g);
          else g.mode = "scroll";
        }
        if (g.mode === "scroll") {
          const step = e.clientX - g.lastX;
          reelState.target -= step * 1.15;
          g.vx = step / Math.max(1, e.timeStamp - g.lastT);
          g.lastX = e.clientX;
          g.lastT = e.timeStamp;
        } else if (g.mode === "carry") {
          gsap.to(flyers[g.surah!], {
            x: e.clientX - FLYER / 2,
            y: e.clientY - FLYER / 2,
            duration: 0.12,
            ease: "power2.out",
            overwrite: "auto",
          });
          well.dataset.ready = String(overWell(e.clientX, e.clientY));
        }
      };

      const onUp = (e: PointerEvent) => {
        const g = gesture;
        if (!g || e.pointerId !== g.id) return;
        gesture = null;
        well.dataset.ready = "false";
        const cancelled = e.type === "pointercancel";
        if (g.mode === "pending" && !cancelled) {
          if (g.source === "dock") togglePlay();
          else if (g.item) activate(g.surah!, g.item);
        } else if (g.mode === "scroll") {
          if (e.timeStamp - g.lastT < 80) reelState.target -= g.vx * 260; // fling
        } else if (g.mode === "carry") {
          const s = g.surah!;
          const drop = !cancelled && overWell(e.clientX, e.clientY);
          if (drop) dockSurah(s);
          else if (g.source === "dock") eject();
          else returnToReel(s);
        }
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        reelState.target +=
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      };

      const reelDown = onDown("reel");
      const dockDown = onDown("dock");
      reel.addEventListener("pointerdown", reelDown);
      dock.addEventListener("pointerdown", dockDown);
      for (const el of [reel, dock]) {
        el.addEventListener("pointermove", onMove);
        el.addEventListener("pointerup", onUp);
        el.addEventListener("pointercancel", onUp);
      }
      reel.addEventListener("wheel", onWheel, { passive: false });
      const onResize = () => {
        measure();
        tick();
      };
      window.addEventListener("resize", onResize);

      actions.current = {
        activate: safe(activate),
        togglePlay: safe(togglePlay),
        step: safe((dir: 1 | -1) => {
          const s =
            docked === null ? (dir === 1 ? 0 : N - 1) : (docked + dir + N) % N;
          activate(s);
        }),
        focusItem: safe(centerItem),
        onAudioPlay: safe(() => {
          setPlaying(true);
          if (docked !== null && landed) {
            startSpin();
            lightTo(1);
          }
        }),
        onAudioPause: safe(() => {
          setPlaying(false);
          if (docked !== null && landed) {
            stopSpin();
            lightTo(0.5);
          }
        }),
      };

      return () => {
        gsap.ticker.remove(tick);
        reel.removeEventListener("pointerdown", reelDown);
        dock.removeEventListener("pointerdown", dockDown);
        for (const el of [reel, dock]) {
          el.removeEventListener("pointermove", onMove);
          el.removeEventListener("pointerup", onUp);
          el.removeEventListener("pointercancel", onUp);
        }
        reel.removeEventListener("wheel", onWheel);
        window.removeEventListener("resize", onResize);
      };
    },
    { scope: root },
  );

  const onItemKey = (s: number) => (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      actions.current?.activate(s, e.currentTarget);
    }
  };

  const surah = current === null ? null : SURAHS[current];
  const tiles = Array.from(
    { length: 4 },
    (_, k) => SURAHS[((current ?? 0) + k) % N],
  );

  return (
    <div
      ref={root}
      className="flex min-h-dvh w-full flex-1 flex-col items-center justify-center gap-6 overflow-clip py-8"
      style={STEEL_BG}
    >
      {/* ---------- player panel ---------- */}
      <div className="relative mx-4 w-[calc(100%-2rem)] max-w-[420px] rounded-md bg-gradient-to-b from-white/95 to-zinc-100/90 px-6 pt-5 pb-4 sm:px-8 sm:pt-6 shadow-[0_40px_70px_-25px_rgba(0,0,0,0.55),inset_0_0_0_1px_rgba(255,255,255,0.7)]">
        {/* panel light: edge-lit acrylic glow + glowing screws, driven together with the ring light */}
        <div
          ref={panelLightRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-md opacity-0 shadow-[0_0_0_1px_#fff,0_0_18px_4px_rgba(255,246,228,0.9),0_0_60px_18px_rgba(255,214,160,0.55),0_0_140px_40px_rgba(255,190,130,0.3),inset_0_0_22px_4px_rgba(255,244,222,0.95),inset_0_0_60px_10px_rgba(255,226,180,0.35)]"
        >
          {[
            "top-3 left-3",
            "top-3 right-3",
            "bottom-3 left-3",
            "bottom-3 right-3",
          ].map((pos) => (
            <span
              key={pos}
              className={cn(
                "absolute size-2.5 rounded-full shadow-[0_0_6px_3px_#fff,0_0_16px_6px_rgba(255,214,160,0.8)]",
                pos,
              )}
            />
          ))}
        </div>
        {[
          "top-3 left-3",
          "top-3 right-3",
          "bottom-3 left-3",
          "bottom-3 right-3",
        ].map((pos) => (
          <span
            key={pos}
            aria-hidden
            className={cn(
              "absolute size-2.5 rounded-full bg-[radial-gradient(circle_at_35%_35%,#f4f4f5,#a1a1aa)] shadow-[0_1px_1px_rgba(0,0,0,0.3)]",
              pos,
            )}
          />
        ))}

        <p className="truncate text-center text-[9px] font-medium tracking-[0.28em] text-zinc-500 uppercase">
          {surah
            ? `${surah.name} · ${surah.meaning}`
            : "Quran Ayat Play · Place a vinyl to listen"}
        </p>
        <div className="mx-auto mt-1.5 mb-5 h-px w-2/5 bg-zinc-300" />

        {/* artwork */}
        <div className="relative aspect-square overflow-hidden rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)]">
          <div
            className="absolute inset-0"
            style={{ backgroundImage: DEFAULT_ART }}
          />
          {SURAHS.map((s, i) => (
            <div
              key={s.number}
              className={cn(
                "absolute inset-0 transition-opacity duration-1000",
                current === i ? "opacity-100" : "opacity-0",
              )}
              style={{ backgroundImage: surahGradient(s) }}
            />
          ))}
          <div
            className="absolute inset-0 grid grid-cols-2 grid-rows-2"
            aria-hidden
          >
            {tiles.map((s, k) => (
              <div
                key={k}
                className="flex items-start justify-center p-[6%] odd:justify-start even:justify-end"
              >
                <span
                  lang="ar"
                  dir="rtl"
                  className="font-arabic text-[clamp(20px,6vw,32px)] font-bold text-white/25"
                >
                  {s.arabic}
                </span>
              </div>
            ))}
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_55%,transparent_30%,rgba(0,0,0,0.25)_100%)]" />

          {/* slot */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative size-[58%]">
              <div className="absolute inset-0 rounded-full bg-[conic-gradient(from_200deg,#18181b,#3f3f46,#18181b,#27272a,#18181b)] shadow-[0_8px_20px_rgba(0,0,0,0.45)]">
                <svg
                  viewBox="0 0 200 200"
                  className="absolute inset-0 size-full"
                  aria-hidden
                >
                  <defs>
                    <path
                      id={ringTextId}
                      d="M100,100 m-89,0 a89,89 0 1,1 178,0 a89,89 0 1,1 -178,0"
                    />
                  </defs>
                  <text className="fill-white/60 text-[7.5px] font-semibold tracking-[0.2em] uppercase">
                    <textPath
                      href={`#${ringTextId}`}
                      textLength={2 * Math.PI * 89 - 6}
                      lengthAdjust="spacing"
                    >
                      Quran Ayat Play • Place a vinyl to listen • Quran Ayat
                      Play • Place a vinyl to listen •
                    </textPath>
                  </text>
                </svg>
              </div>
              {/* light: a bright tube on the bezel's rim + warm glow spilling onto the artwork */}
              <div
                ref={lightRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-0"
              >
                <div className="absolute -inset-[1%] rounded-full shadow-[0_0_40px_14px_rgba(255,214,160,0.75),0_0_90px_30px_rgba(255,180,120,0.45)]" />
                <div className="absolute -inset-[1%] rounded-full border-4 border-white shadow-[0_0_4px_1px_#fff,0_0_14px_4px_rgba(255,248,232,0.95),inset_0_0_6px_2px_#fff,inset_0_0_18px_6px_rgba(255,236,205,0.55)]" />
              </div>
              <div
                ref={wellRef}
                data-ready="false"
                className="absolute inset-[11%] flex items-center justify-center rounded-full bg-zinc-950 shadow-[inset_0_6px_18px_rgba(0,0,0,0.95)] ring-white/60 transition-[box-shadow] duration-200 data-[ready=true]:ring-4"
              >
                <span
                  className={cn(
                    "px-4 text-center text-[10px] tracking-[0.2em] text-white/40 uppercase transition-opacity",
                    current !== null && "opacity-0",
                  )}
                >
                  Drop vinyl here
                </span>
                <div
                  ref={dockRef}
                  role="button"
                  tabIndex={current === null ? -1 : 0}
                  aria-label={
                    surah
                      ? `${surah.name} is in the player. Drag it out to eject, press Enter to play or pause.`
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      actions.current?.togglePlay();
                    }
                  }}
                  className="invisible absolute inset-[2%] cursor-grab touch-none rounded-full select-none focus-visible:ring-4 focus-visible:ring-white/70 focus-visible:outline-none active:cursor-grabbing"
                >
                  <VinylDisc surah={surah ?? SURAHS[0]} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* progress */}
        <div className="mt-5 flex items-center gap-3 text-[10px] text-zinc-500 tabular-nums">
          <span className="w-10 text-right">{formatTime(time)}</span>
          <Slider
            aria-label="Seek"
            disabled={current === null || !duration}
            min={0}
            max={duration || 1}
            step={1}
            value={[Math.min(time, duration || 0)]}
            onValueChange={(v) => {
              const t = Array.isArray(v) ? v[0] : v;
              if (audioRef.current) audioRef.current.currentTime = t;
              setTime(t);
            }}
            className="flex-1"
          />
          <span className="w-10">{formatTime(duration)}</span>
        </div>

        {/* controls: transport centred, volume on the right */}
        <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center">
          <span aria-hidden />
          <div className="flex items-center justify-center gap-3 sm:gap-6">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Previous surah"
            onClick={() => actions.current?.step(-1)}
          >
            <SkipBack className="fill-current" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => actions.current?.togglePlay()}
          >
            {playing ? (
              <Pause className="fill-current" />
            ) : (
              <Play className="fill-current" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Next surah"
            onClick={() => actions.current?.step(1)}
          >
            <SkipForward className="fill-current" />
          </Button>
          </div>

          <div className="flex items-center justify-end gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={muted ? "Unmute" : "Mute"}
              aria-pressed={muted}
              onClick={toggleMute}
            >
              {muted || volume === 0 ? (
                <VolumeX />
              ) : volume < 0.5 ? (
                <Volume1 />
              ) : (
                <Volume2 />
              )}
            </Button>
            <Slider
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={[muted ? 0 : volume]}
              onValueChange={(v) => changeVolume(Array.isArray(v) ? v[0] : v)}
              className="w-14 sm:w-20"
            />
          </div>
        </div>

        <audio
          ref={audioRef}
          preload="none"
          onPlay={() => actions.current?.onAudioPlay()}
          onPause={() => actions.current?.onAudioPause()}
          onEnded={() => actions.current?.step(1)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        />
      </div>

      {/* ---------- vinyl reel ---------- */}
      <div
        ref={reelRef}
        aria-label="Vinyl reel. Scroll or swipe sideways to browse, drag a vinyl up into the player to play it."
        className="relative -my-6 h-[290px] w-full shrink-0 cursor-grab touch-none select-none [mask-image:linear-gradient(90deg,transparent,black_10%,black_90%,transparent)] active:cursor-grabbing sm:h-[380px]"
      >
        {REEL.map((k) => {
          const s = k % N;
          const first = k < N;
          return (
            <div
              key={k}
              ref={(el) => {
                itemRefs.current[k] = el;
              }}
              data-reel-item
              data-surah={s}
              data-away="false"
              role={first ? "button" : undefined}
              tabIndex={first ? 0 : -1}
              aria-hidden={first ? undefined : true}
              aria-label={
                first
                  ? `Surah ${SURAHS[s].name}, ${SURAHS[s].meaning}`
                  : undefined
              }
              onKeyDown={onItemKey(s)}
              onFocus={(e) => actions.current?.focusItem(e.currentTarget)}
              className="group absolute inset-y-0 left-0 flex w-[180px] flex-col items-center justify-center gap-3 transition-opacity duration-300 will-change-transform outline-none data-[away=true]:opacity-20 sm:w-[260px]"
            >
              <div className="vinyl-face size-[150px] rounded-full group-focus-visible:ring-4 group-focus-visible:ring-white/70 sm:size-[220px]">
                <VinylDisc surah={SURAHS[s]} />
              </div>
              <span className="text-xs font-medium tracking-wide text-zinc-800/80 sm:text-sm">
                {SURAHS[s].name}
              </span>
            </div>
          );
        })}
      </div>

      <p className="px-4 text-center text-xs font-medium text-zinc-800/70">
        Scroll the reel · drag a vinyl up into the player · drag it out to eject
      </p>

      {/* ---------- flyers: vinyls in transit between reel and player ---------- */}
      {SURAHS.map((s, i) => (
        <div
          key={s.number}
          ref={(el) => {
            flyerRefs.current[i] = el;
          }}
          aria-hidden
          className="pointer-events-none invisible fixed top-0 left-0 z-50 size-[200px]"
        >
          <VinylDisc surah={s} />
        </div>
      ))}
    </div>
  );
}
