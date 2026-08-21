/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { balancedDiv, decodeEntities, removeDivs, removeScripts, toXhtmlDocument } from "./html.ts";
import { type ChapterEntry, type ChapterListPage } from "./models.ts";

/**
 * Everything chapter-shaped: reading the list endpoint, deciding what each chapter
 * is called, and turning one chapter's markup into the document the reader wants.
 *
 * Split from `parsers.ts`, which reads the catalog. The central decision here needs
 * the whole novel rather than one entry, which is a different shape of problem from
 * anything on the catalog side.
 */

const CHAPTER_LINK = /href="\/novel\/[^"]*\/chapter-(\d+)"[^>]*title="([^"]*)"/g;

/**
 * The `?ajax=chapters` payload.
 *
 * The response reports `totalPage`, so page 1 both returns data and states how
 * many further requests the walk needs — no request is ever speculative.
 */
export function parseChapterList(payload: unknown): ChapterListPage {
  const body = payload as {
    code?: number;
    html?: string;
    page?: number;
    totalPage?: number;
    totalChapters?: number;
  } | null;

  if (!body || body.code !== 200 || typeof body.html !== "string") {
    throw new Error("FreeWebNovel returned an unreadable chapter list");
  }

  const entries: ChapterEntry[] = [];
  for (const match of body.html.matchAll(CHAPTER_LINK)) {
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index)) continue;

    const entry: ChapterEntry = { index };
    // Only the site's own "Chapter N" prefix comes off here. Whether what remains
    // still opens with a numbering artifact cannot be decided one entry at a time —
    // see resolveChapterTitles.
    const title = stripChapterPrefix(match[2]!);
    if (title) entry.title = title;
    entries.push(entry);
  }

  return {
    entries,
    page: body.page ?? 1,
    totalPage: body.totalPage ?? 1,
    totalChapters: body.totalChapters ?? entries.length,
  };
}

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

const ARTICLE = /<div\b[^>]*\bid="article"[^>]*>/i;
const AD_BLOCK = /<div\b[^>]*\bclass="[^"]*\breader-ad-skip\b[^"]*"[^>]*>/i;
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/**
 * A chapter's prose as a complete XHTML document.
 *
 * The ad blocks the site injects mid-article carry no `<p>` today, so collecting
 * paragraphs would skip them anyway — they are removed explicitly regardless,
 * because if that ever changes the failure is ad copy appearing mid-chapter.
 */
export function parseChapterBody(html: string, label: string): string {
  const article = balancedDiv(html, ARTICLE);
  if (!article) throw new Error(`FreeWebNovel served no readable content for ${label}`);

  const prose = removeScripts(removeDivs(article, AD_BLOCK));

  const paragraphs: string[] = [];
  for (const match of prose.matchAll(PARAGRAPH)) {
    const paragraph = match[1]!.trim();
    if (paragraph.length > 0) paragraphs.push(`<p>${paragraph}</p>`);
  }

  // A chapter with no content renders as a silently blank reader, so it has to raise.
  if (paragraphs.length === 0) {
    throw new Error(`FreeWebNovel served an empty chapter for ${label}`);
  }
  return toXhtmlDocument(paragraphs.join(""));
}
