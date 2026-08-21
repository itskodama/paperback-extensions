/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";

import { safeId } from "./html.ts";
import {
  ADULT_GENRES,
  GENRES,
  type ChapterEntry,
  type ListingRow,
  type NovelDetail,
  type ReleaseEntry,
  type SearchFilters,
} from "./models.ts";
import { parseChapterBody } from "./parsers.ts";
import { novelUrl } from "./urls.ts";

/**
 * Domain data onto Paperback types. Kept apart from `parsers.ts` so the reading
 * and the shaping can be tested — and can break — independently.
 */

export function contentRatingFor(genres: string[]): ContentRating {
  return genres.some((genre) => ADULT_GENRES.has(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

function subtitleFor(row: ListingRow): string | undefined {
  const parts: string[] = [];
  if (row.chapterCount !== undefined) {
    parts.push(`${row.chapterCount.toLocaleString("en-US")} Chapters`);
  }
  if (row.language) parts.push(row.language);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function toSearchResultItem(row: ListingRow): SearchResultItem {
  return {
    mangaId: row.slug,
    title: row.title,
    subtitle: subtitleFor(row),
    imageUrl: row.thumbnailUrl,
    contentRating: contentRatingFor(row.genres),
  };
}

export function toSimpleCarouselItem(row: ListingRow): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: row.slug,
    title: row.title,
    subtitle: subtitleFor(row),
    imageUrl: row.thumbnailUrl,
    contentRating: contentRatingFor(row.genres),
  };
}

type InfoItem = { symbol: string; text: string };

/** `infoItems` is capped at two by the type, so rating and length are the picks. */
export function toFeaturedItem(row: ListingRow): DiscoverSectionItem {
  const rating: InfoItem | undefined =
    row.rating === undefined ? undefined : { symbol: "star.fill", text: row.rating.toFixed(1) };
  const length: InfoItem | undefined =
    row.chapterCount === undefined
      ? undefined
      : { symbol: "book.fill", text: row.chapterCount.toLocaleString("en-US") };

  return {
    type: "featuredCarouselItem",
    mangaId: row.slug,
    title: row.title,
    supertitle: row.genres[0],
    imageUrl: row.thumbnailUrl,
    infoItems:
      rating && length ? [rating, length] : rating ? [rating] : length ? [length] : undefined,
    contentRating: contentRatingFor(row.genres),
  };
}

export function toChapterUpdateItem(entry: ReleaseEntry): DiscoverSectionItem {
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: entry.slug,
    chapterId: String(entry.chapterIndex),
    title: entry.title,
    subtitle: entry.chapterTitle ?? `Chapter ${entry.chapterIndex}`,
    imageUrl: entry.thumbnailUrl,
    publishDate: entry.publishDate,
    contentRating: ContentRating.MATURE,
  };
}

/**
 * Genre chips carry a ready-made filtered search, which is the same capability an
 * advanced search form provides without the device-only risk surface.
 */
export function genreChipItems(): DiscoverSectionItem[] {
  return GENRES.map((genre) => ({
    type: "genresCarouselItem",
    name: genre,
    // Only assigned keys: an `undefined` inside a Metadata crashes on device.
    searchQuery: { title: "", metadata: { genresInclude: [genre] } },
    contentRating: ContentRating.MATURE,
  }));
}

export function toSourceManga(detail: NovelDetail): SourceManga {
  const tags = detail.genres.map((genre) => ({ id: safeId(genre), title: genre }));

  return {
    mangaId: detail.slug,
    mangaInfo: {
      thumbnailUrl: detail.thumbnailUrl,
      synopsis: detail.synopsis,
      primaryTitle: detail.title,
      secondaryTitles: detail.alternativeTitles,
      contentRating: contentRatingFor(detail.genres),
      contentType: "novel",
      status: normaliseStatus(detail.status),
      author: detail.author,
      rating: detail.rating,
      tagGroups: tags.length > 0 ? [{ id: "genres", title: "Genres", tags }] : [],
      artworkUrls: detail.thumbnailUrl ? [detail.thumbnailUrl] : [],
      shareUrl: novelUrl(detail.slug),
    },
  };
}

/** The site writes "OnGoing"; every other source here writes "Ongoing". */
function normaliseStatus(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return /ongoing/i.test(status) ? "Ongoing" : /completed/i.test(status) ? "Completed" : status;
}

/**
 * Chapter numbering.
 *
 * `chapNum` is the URL index, which is gapless `1..N` on every novel measured.
 * The number embedded in a title is **not** usable: across one 2,429-chapter
 * novel it yields 428 distinct offsets from position, is non-monotonic, and is
 * missing entirely on some entries.
 *
 * Do not port NovelArchive's `detectNumberingOffset` here. It exists to recover a
 * *consistent* offset, and there is none on this site — it would parse every
 * title only to return "no consensus, use position", which is what this already
 * does. See `docs/FreeWebNovel/site-recon.md`.
 */
export function toChapters(entries: ChapterEntry[], sourceManga: SourceManga): Chapter[] {
  return entries.map((entry) => {
    const chapter: Chapter = {
      chapterId: String(entry.index),
      sourceManga,
      langCode: "en",
      chapNum: entry.index,
      // Unset renders as "Vol. TBA"; this site has no volume concept.
      volume: 0,
    };
    // Assigned only when present — the site has entries whose title is just a number.
    if (entry.title) chapter.title = entry.title;
    return chapter;
  });
}

export function toChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: parseChapterBody(html, chapter.title ?? `chapter ${chapter.chapNum}`),
  };
}

/**
 * Whether a row satisfies filters the server could not apply — the exclusions that
 * `genre_match` cannot carry alongside inclusions, and everything at all when the
 * query went to `/search`, which takes no filters.
 *
 * **A listing row shows only its first two genres**, so this can only ever reject,
 * never confirm: seeing an excluded genre proves the row should go, but not seeing
 * one proves nothing. Inclusions are therefore deliberately *not* checked here —
 * doing so would drop correct results whose matching genre was simply the third
 * one the row did not print.
 */
export function matchesFilters(row: ListingRow, filters: SearchFilters): boolean {
  const genres = new Set(row.genres);

  for (const genre of filters.genresExclude ?? []) {
    if (genres.has(genre)) return false;
  }

  // The rating a row prints is the whole value, so this one is decidable.
  if (filters.rating && (row.rating ?? 0) < Number.parseFloat(filters.rating)) return false;

  return true;
}
