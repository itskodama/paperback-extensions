/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Pure transforms of a series' chapters and their content. Policy such as "hide paid chapters"
 * arrives as a parameter — nothing here reads persisted state.
 */

import { type Chapter, type SourceManga } from "@paperback/types";

import { toXhtml } from "./html.ts";
import { type ApiChapter } from "./models.ts";
import { asRecord, readNumber, readRecords, readString, type Rec } from "./records.ts";

export function parseChapterList(payload: unknown): ApiChapter[] {
  const root = asRecord(payload);
  const post = root ? asRecord(root.post) : undefined;
  if (!post) throw new Error("HiveToons returned an unreadable chapter list");

  return readRecords(post, "chapters").flatMap((entry) => {
    const id = readNumber(entry, "id");
    const number = readNumber(entry, "number");
    if (id === undefined || number === undefined) return [];

    return [
      {
        id: String(id),
        number,
        title: readString(entry, "title"),
        // Absent means free: only a positive price gates a chapter.
        price: readNumber(entry, "price") ?? 0,
        unlockAt: readString(entry, "unlockAt"),
        createdAt: readString(entry, "createdAt"),
      },
    ];
  });
}

/**
 * Dropped rather than surfaced when unparseable: an Invalid Date renders as a broken date, where
 * no date at all renders as nothing.
 */
function parseTimestamp(raw: string | undefined): Date | undefined {
  if (raw === undefined) return undefined;

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function isPaid(chapter: ApiChapter): boolean {
  return chapter.price > 0;
}

const LEADING_NUMBER = /^\s*(?:chapter|episode|ep\.?)?\s*\d+(?:\.\d+)?\s*[-–—:.]?\s*/i;

/**
 * The app renders a row as "Chapter {chapNum} - {title}", so a title carrying its own leading
 * number reads as a second, possibly contradicting one. One chapter on this site is titled with
 * nothing but its own number. See docs/paperback/chapters.md.
 */
export function cleanChapterTitle(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;

  const stripped = title.replace(LEADING_NUMBER, "").trim();
  return stripped.length > 0 ? stripped : undefined;
}

export function toChapters(
  entries: ApiChapter[],
  sourceManga: SourceManga,
  hidePaid: boolean,
): Chapter[] {
  const chapters: Chapter[] = [];

  for (const entry of entries) {
    if (hidePaid && isPaid(entry)) continue;

    const chapter: Chapter = {
      chapterId: entry.id,
      sourceManga,
      langCode: "en",
      chapNum: entry.number,
      // The site has no volume concept; leaving this unset labels every row "Vol. TBA".
      volume: 0,
    };

    const title = cleanChapterTitle(entry.title);
    if (title !== undefined) chapter.title = title;

    // getChapterDetails is handed the Chapter back and nothing else, and a paywalled page is a
    // normal 200 with no images in it — indistinguishable from a broken one without this.
    if (isPaid(entry)) {
      chapter.additionalInfo = { price: String(entry.price) };
      if (entry.unlockAt !== undefined) chapter.additionalInfo.unlockAt = entry.unlockAt;
    }

    const published = parseTimestamp(entry.createdAt);
    if (published !== undefined) chapter.publishDate = published;

    chapters.push(chapter);
  }

  return chapters;
}

// --- Chapter content ---

/**
 * `/api/chapter` returns a comic's pages as image records and a novel's text as one HTML string,
 * for roughly 12 KB against the ~300 KB reader page that renders the same thing.
 *
 * `order` is authoritative: the array has arrived sorted so far, but a page list silently out of
 * order is the kind of thing nobody notices until a chapter reads wrong.
 */
export function parsePages(payload: unknown): string[] {
  const chapter = chapterOf(payload);
  if (!chapter) return [];

  return readRecords(chapter, "images")
    .flatMap((image) => {
      const url = readString(image, "url");
      return url === undefined ? [] : [{ url, order: readNumber(image, "order") ?? 0 }];
    })
    .sort((a, b) => a.order - b.order)
    .map((image) => image.url);
}

/** The reader needs a whole XHTML document, not the fragment the API stores. */
export function parseNovelBody(payload: unknown): string | undefined {
  const chapter = chapterOf(payload);
  const content = chapter ? readString(chapter, "content") : undefined;
  return content === undefined ? undefined : toXhtml(content);
}

function chapterOf(payload: unknown): Rec | undefined {
  const root = asRecord(payload);
  return root ? asRecord(root.chapter) : undefined;
}

/**
 * A paid chapter answers with an ordinary 200 whose body simply has no reader images, so without
 * an explanation the reader would see an empty chapter and no reason for it.
 */
export function paidChapterError(chapter: Chapter): Error {
  const unlocksAt = parseTimestamp(chapter.additionalInfo?.unlockAt);
  const readable = unlocksAt?.toLocaleDateString();

  return new Error(
    readable
      ? `Chapter ${chapter.chapNum} costs coins on HiveToons until it unlocks on ${readable}. This extension reads the site anonymously and cannot buy it.`
      : `Chapter ${chapter.chapNum} costs coins on HiveToons. This extension reads the site anonymously and cannot buy it.`,
  );
}

export function chapterIsPaid(chapter: Chapter): boolean {
  return Number(chapter.additionalInfo?.price ?? "0") > 0;
}
