#!/usr/bin/env node
/**
 * Downloads word-timed recitation data for the surahs used by the player and writes
 * one compact JSON file per surah to public/surahs/{number}.json.
 *
 *   node scripts/build-surah-data.mjs
 *
 * Sources (quran.com API v4):
 *   - Word timings for Mishary Rashid Alafasy (recitation 7), matched to its audio file
 *   - Uthmani Arabic text, split into words
 *   - Saheeh International English translation (resource 20)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SURAHS = [1, 18, 23, 36, 43, 55, 56, 67];
const RECITATION = 7; // Mishary Rashid Alafasy
const TRANSLATION = 20; // Saheeh International
const API = "https://api.quran.com/api/v4";
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "surahs");

async function getJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function fetchVerses(chapter) {
  const verses = [];
  for (let page = 1; ; page++) {
    const data = await getJson(
      `${API}/verses/by_chapter/${chapter}?words=true&word_fields=text_uthmani&translations=${TRANSLATION}&per_page=50&page=${page}`,
    );
    verses.push(...data.verses);
    if (!data.pagination?.next_page) return verses;
  }
}

/** Drop footnote markers and any other markup from translation text. */
const cleanTranslation = (html) =>
  html
    .replace(/<sup[^>]*>.*?<\/sup>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

async function buildSurah(chapter) {
  const [{ audio_file: audio }, verses] = await Promise.all([
    getJson(`${API}/chapter_recitations/${RECITATION}/${chapter}?segments=true`),
    fetchVerses(chapter),
  ]);
  const timing = new Map(audio.timestamps.map((t) => [t.verse_key, t]));

  const out = verses.map((v) => {
    const t = timing.get(v.verse_key);
    if (!t) throw new Error(`No timing for ${v.verse_key}`);
    // Segments are [wordPosition, startMs, endMs]; the API sometimes includes stray
    // one-element entries, which are ignored.
    const seg = new Map(t.segments.filter((s) => s.length === 3).map(([pos, a, b]) => [pos, [a, b]]));
    const words = v.words.filter((w) => w.char_type_name === "word");

    // Fill words with no timing by splitting the gap between their timed neighbours.
    const times = words.map((w) => seg.get(w.position) ?? null);
    for (let i = 0; i < times.length; i++) {
      if (times[i]) continue;
      let j = i;
      while (j < times.length && !times[j]) j++;
      const from = i > 0 ? times[i - 1][1] : t.timestamp_from;
      const to = j < times.length ? times[j][0] : t.timestamp_to;
      const step = (to - from) / (j - i);
      for (let k = i; k < j; k++) times[k] = [Math.round(from + step * (k - i)), Math.round(from + step * (k - i + 1))];
    }

    return {
      n: v.verse_number,
      from: t.timestamp_from,
      to: t.timestamp_to,
      words: words.map((w, i) => [w.text_uthmani, times[i][0], times[i][1]]),
      translation: cleanTranslation(v.translations[0]?.text ?? ""),
    };
  });

  return { number: chapter, audio: audio.audio_url, verses: out };
}

await mkdir(OUT_DIR, { recursive: true });
for (const chapter of SURAHS) {
  const data = await buildSurah(chapter);
  const file = path.join(OUT_DIR, `${chapter}.json`);
  await writeFile(file, JSON.stringify(data));
  const words = data.verses.reduce((n, v) => n + v.words.length, 0);
  console.log(`surah ${chapter}: ${data.verses.length} verses, ${words} words, audio ${data.audio}`);
}
