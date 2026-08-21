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

import { parseChapterBody } from "./chapters.ts";
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
import { novelUrl } from "./urls.ts";

/**
 * Domain data onto Paperback types. Kept apart from `parsers.ts` so the reading
 * and the shaping can be tested — and can break — independently.
 */

/** The site's own vocabulary, from the novel page and the filter form. */
const SITE_RATINGS: Record<string, ContentRating> = {
  general: ContentRating.EVERYONE,
  guidance: ContentRating.EVERYONE,
  suggestive: ContentRating.MATURE,
  "adults-only": ContentRating.ADULT,
};

/**
 * **A lower bound, not a verdict.** An Adult or Smut tag proves a novel is adult;
 * their absence proves nothing, because a listing row prints only its first two
 * genres and this site orders the explicit ones late. Of twenty novels on the
 * Latest Novels page, twelve are adult and the rows reveal four.
 *
 * Only `parseNovelDetail` sees the full genre list and the site's own rating.
 */
export function contentRatingFor(genres: string[]): ContentRating {
  return genres.some((genre) => ADULT_GENRES.has(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

/**
 * The novel page carries both signals, and they are not the same kind of thing.
 *
 * An Adult or Smut tag is *proof* and outranks everything — the site rates some
 * novels "Parental Guidance Suggested" while tagging them both. Failing that, the
 * site's own rating is its word and is taken at face value, including when it
 * clears a novel outright. With neither, the rating is simply unknown, and this
 * source's floor is MATURE.
 */
export function detailContentRating(detail: NovelDetail): ContentRating {
  if (detail.genres.some((genre) => ADULT_GENRES.has(genre))) return ContentRating.ADULT;

  const stated = detail.contentRating ? SITE_RATINGS[detail.contentRating] : undefined;
  return stated ?? ContentRating.MATURE;
}

function subtitleFor(row: ListingRow): string | undefined {
  const parts: string[] = [];
  if (row.chapterCount !== undefined) {
    parts.push(`${row.chapterCount.toLocaleString("en-US")} Chapters`);
  }
  if (row.language) parts.push(row.language);
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

export function toSearchResultItem(row: ListingRow, rating?: ContentRating): SearchResultItem {
  return {
    mangaId: row.slug,
    title: row.title,
    subtitle: subtitleFor(row),
    imageUrl: row.thumbnailUrl,
    contentRating: rating ?? contentRatingFor(row.genres),
  };
}

export function toSimpleCarouselItem(row: ListingRow, rating?: ContentRating): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: row.slug,
    title: row.title,
    subtitle: subtitleFor(row),
    imageUrl: row.thumbnailUrl,
    contentRating: rating ?? contentRatingFor(row.genres),
  };
}

type InfoItem = { symbol: string; text: string };

/** `infoItems` is capped at two by the type, so rating and length are the picks. */
export function toFeaturedItem(row: ListingRow, rating?: ContentRating): DiscoverSectionItem {
  const ratingInfo: InfoItem | undefined =
    row.rating === undefined ? undefined : { symbol: "star.fill", text: row.rating.toFixed(1) };
  const lengthInfo: InfoItem | undefined =
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
      ratingInfo && lengthInfo
        ? [ratingInfo, lengthInfo]
        : (ratingInfo ?? lengthInfo)
          ? [(ratingInfo ?? lengthInfo)!]
          : undefined,
    contentRating: rating ?? contentRatingFor(row.genres),
  };
}

export function toChapterUpdateItem(
  entry: ReleaseEntry,
  rating?: ContentRating,
): DiscoverSectionItem {
  return {
    type: "chapterUpdatesCarouselItem",
    mangaId: entry.slug,
    chapterId: String(entry.chapterIndex),
    title: entry.title,
    subtitle: entry.chapterTitle ?? `Chapter ${entry.chapterIndex}`,
    imageUrl: entry.thumbnailUrl,
    publishDate: entry.publishDate,
    // The feed carries no genres at all, so unverified means unknown.
    contentRating: rating ?? ContentRating.MATURE,
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
      contentRating: detailContentRating(detail),
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
 * `chapNum` is the URL index, which is gapless `1..N` on every novel measured. The
 * number embedded in a title is not usable for it: across one 2,429-chapter novel
 * it yields 428 distinct offsets from position, is non-monotonic, and is missing
 * on some entries.
 *
 * Do not port NovelArchive's `detectNumberingOffset` for *this* question — it
 * recovers a consistent offset, and there is none here to recover.
 *
 * That argument does not extend to the separate question of whether a leading
 * number belongs to the title, where a per-novel consensus does exist and is what
 * `resolveChapterTitles` decides. Conflating the two shipped a bug once already.
 * See `docs/FreeWebNovel/site-recon.md`.
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
