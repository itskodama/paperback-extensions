/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Asura's separate /novels catalog: detail, chapters and the XHTML the reader needs. */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

import {
  findIsland,
  htmlToPlainText,
  readArray,
  readBoolean,
  readNumber,
  readNumberArray,
  readString,
  readStringArray,
  type Island,
} from "./astro.ts";
import { alternativeTitles, ratingFraction } from "./fields.ts";
import { statusLabel } from "./models.ts";
import { NOVEL_ID_PREFIX, novelUrl } from "./urls.ts";

// A separate pipeline from comics.ts: the comics route (/comics/<slug>-<hash>) resolves a novel's
// slug too, but its chapters island is a disconnected, comic-shaped table with different ids that
// doesn't correspond to what /novels/<slug>/chapter/<n> actually serves
const NOVEL_CATALOG_KEYS = ["initialItems"];

const NOVEL_CHAPTERS_KEYS = ["chapters", "novelSlug", "totalChapters"];

const NOVEL_CHAPTER_KEYS = ["paragraphs", "isLocked"];

export function parseNovelCatalog(html: string): Island[] {
  const island = findIsland(html, NOVEL_CATALOG_KEYS);
  return readArray(island, "initialItems");
}

// mangaId here is the bare site slug, not the prefixed app-facing id — callers strip first
export function novelCatalogEntry(catalog: Island[], slug: string): Island | undefined {
  return catalog.find((entry) => readString(entry, "slug") === slug);
}

export function novelToSourceManga(entry: Island): SourceManga {
  const mangaId = NOVEL_ID_PREFIX + (readString(entry, "slug") ?? "");
  const genreTitles = readStringArray(entry, "genres");
  const genreIds = readNumberArray(entry, "genre_ids");
  const tagGroups: TagSection[] =
    genreTitles.length > 0
      ? [
          {
            id: "genres",
            title: "Genres",
            tags: genreTitles.map((title, i) => ({ id: String(genreIds[i] ?? title), title })),
          },
        ]
      : [];
  const thumbnailUrl = readString(entry, "cover_url") ?? "";
  const description = readString(entry, "description");

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: description ? htmlToPlainText(description) : "No synopsis.",
      primaryTitle: readString(entry, "title") ?? "Unknown Title",
      secondaryTitles: alternativeTitles(entry, "alternative_titles"),
      contentType: "novel",
      contentRating: ContentRating.MATURE,
      status: statusLabel(readString(entry, "status")),
      author: readString(entry, "author"),
      rating: ratingFraction(entry, "rating"),
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: novelUrl(mangaId),
    },
  };
}

// Only "Nh ago"/"Nd ago" confirmed live across a full 101-chapter list — no weeks/months/years
// observed, so this deliberately doesn't guess at units never seen
const NOVEL_RELATIVE_TIME = /^(\d+)(h|d) ago$/i;

function parseNovelRelativeTime(text: string): Date | undefined {
  const match = NOVEL_RELATIVE_TIME.exec(text.trim());
  if (!match) return undefined;

  const amount = Number(match[1]);
  const unitMs = match[2]!.toLowerCase() === "h" ? 3_600_000 : 86_400_000;
  return new Date(Date.now() - amount * unitMs);
}

export function parseNovelChapterList(html: string, sourceManga: SourceManga): Chapter[] {
  const island = findIsland(html, NOVEL_CHAPTERS_KEYS);
  const chapters: Chapter[] = [];

  for (const entry of readArray(island, "chapters")) {
    const chapNum = readNumber(entry, "number");
    if (chapNum === undefined) continue;

    const date = readString(entry, "date");

    chapters.push({
      chapterId: String(chapNum),
      sourceManga,
      langCode: "en",
      chapNum,
      volume: 0,
      title: readString(entry, "title"),
      publishDate: date ? parseNovelRelativeTime(date) : undefined,
    });
  }

  return chapters;
}

// html chapters parse as XML: unclosed void elements and named entities beyond XML's five are
// fatal (docs/paperback/html-chapters.md). AsuraScans' own copy, not imported from LightNovelWorld
// (each extension bundles standalone)
const VOID_TAG =
  /<(img|br|hr|source|wbr|area|col|embed|input|link|meta|track|param|base)(\b[^>]*?)\s*\/?>/gi;

const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;

const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

const ENTITY_CODEPOINTS: Record<string, number> = {
  copy: 0xa9,
  deg: 0xb0,
  eacute: 0xe9,
  hellip: 0x2026,
  laquo: 0xab,
  ldquo: 0x201c,
  lsquo: 0x2018,
  mdash: 0x2014,
  middot: 0xb7,
  nbsp: 0xa0,
  ndash: 0x2013,
  raquo: 0xbb,
  rdquo: 0x201d,
  rsquo: 0x2019,
  shy: 0xad,
  times: 0xd7,
  trade: 0x2122,
};

function toXhtml(content: string): string {
  const body = content
    .replace(VOID_TAG, (_match, tag: string, attrs: string) => `<${tag}${attrs}/>`)
    .replace(NAMED_REF, (match: string, name: string) => {
      if (XML_ENTITIES.has(name)) return match;
      const codePoint = ENTITY_CODEPOINTS[name];
      return codePoint === undefined ? `&amp;${name};` : `&#${codePoint};`;
    });

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

function novelLockedError(chapter: Chapter, shardCost: number): Error {
  return new Error(
    `Chapter ${chapter.chapNum} costs ${shardCost} shards to unlock. Unlock it on asurascans.com to read it here.`,
  );
}

export function novelChapterIsLocked(html: string): boolean {
  const island = findIsland(html, NOVEL_CHAPTER_KEYS);
  return readBoolean(island, "isLocked");
}

export function parseNovelChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const island = findIsland(html, NOVEL_CHAPTER_KEYS);

  if (readBoolean(island, "isLocked")) {
    throw novelLockedError(chapter, readNumber(island, "shardCost") ?? 0);
  }

  const paragraphs = readStringArray(island, "paragraphs");
  if (paragraphs.length === 0) {
    throw new Error(`Asura Scans served no content for chapter ${chapter.chapNum}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(paragraphs.join("")),
  };
}

export function parseNovelChapterApiPayload(payload: unknown, chapter: Chapter): ChapterDetails {
  const data = payload as Island;
  const contentHtml = readString(data, "content_html");

  if (readBoolean(data, "is_locked") || !contentHtml) {
    throw novelLockedError(chapter, readNumber(data, "shard_cost") ?? 0);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(contentHtml),
  };
}
