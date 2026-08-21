/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { decodeEntities } from "./html.ts";
import { type ChapterEntry } from "./models.ts";

/**
 * Deciding what a chapter is called.
 *
 * Separate from `parsers.ts` because this reads no markup: it works on entries
 * that have already been parsed, and its central decision needs the whole novel
 * rather than one entry or one page.
 */

const CHAPTER_PREFIX = /^\s*(?:chapter|chap|ch|c)[\s.\-–—]*\d+(?:\.\d+)?\s*[:.\-–—]?\s*/i;
const LEADING_NUMBER = /^(\d+(?:\.\d+)?)\s*[:.\-–—]?\s*/;

/**
 * The title with the site's own `Chapter N` / `c-N` prefix removed.
 *
 * The app renders a row as `"Chapter {chapNum} - {title}"`, so leaving the prefix
 * on reads "Chapter 145 - Chapter 145: Accusation".
 */
export function stripChapterPrefix(title: string): string | undefined {
  const stripped = decodeEntities(title).trim().replace(CHAPTER_PREFIX, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

function leadingNumber(title: string): number | undefined {
  const match = LEADING_NUMBER.exec(title);
  return match ? Number.parseFloat(match[1]!) : undefined;
}

/**
 * How much of a novel must open with a second number before that number is read as
 * numbering rather than prose, and how consistently it must ascend.
 *
 * The two populations are nowhere near these lines. Novels whose titles carry a
 * drifted chapter number run 66% and 98% prevalence and ascend monotonically;
 * novels whose titles merely happen to start with a digit run 0-1% and ascend at
 * chance. The thresholds sit in the empty space between, so they are not tuned
 * values and should not be nudged to rescue a single novel.
 */
const NUMBERING_PREVALENCE = 0.5;
const NUMBERING_CONSISTENCY = 0.95;

/** Below this the statistics are noise and the conservative answer is "prose". */
const NUMBERING_MIN_SAMPLE = 8;

/**
 * Some novels label chapters `Chapter 69 - 68: New Expansion` — a second, drifted
 * chapter number ahead of the real title. Others put a genuine number there:
 * `Chapter 142 - 2 star evolution`, `Chapter 1993 - 10 million`.
 *
 * The two are indistinguishable one entry at a time, which is why this takes the
 * whole list. A numbering artifact is *systematic* — it appears on most chapters
 * and ascends with them. Prose numbers are rare and unordered.
 *
 * Stripping unconditionally (as the LightNovelWorld extension does, for a site
 * where the artifact is universal) turns "2 star evolution" into "star evolution".
 * Keeping unconditionally leaves the duplicated number `chapters.md` warns about.
 * Neither rule is right for this site; the population is.
 */
export function resolveChapterTitles(entries: ChapterEntry[]): ChapterEntry[] {
  if (!titlesCarryNumbering(entries)) return entries;

  return entries.map((entry) => {
    if (entry.title === undefined) return entry;
    const stripped = entry.title.replace(LEADING_NUMBER, "").trim();
    // A title that was *only* its number leaves nothing; keep the original rather
    // than publishing a chapter with no label at all.
    if (stripped.length === 0) return entry;
    return { index: entry.index, title: stripped };
  });
}

function titlesCarryNumbering(entries: ChapterEntry[]): boolean {
  if (entries.length < NUMBERING_MIN_SAMPLE) return false;

  const numbers: number[] = [];
  for (const entry of entries) {
    const value = entry.title === undefined ? undefined : leadingNumber(entry.title);
    if (value !== undefined) numbers.push(value);
  }

  if (numbers.length / entries.length < NUMBERING_PREVALENCE) return false;

  const pairs = numbers.length - 1;
  if (pairs < 1) return false;

  let ascending = 0;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i]! >= numbers[i - 1]!) ascending++;
  }
  return ascending / pairs >= NUMBERING_CONSISTENCY;
}
