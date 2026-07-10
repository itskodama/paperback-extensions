/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type PagedResults,
  type SearchResultItem,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import {
  extractIslands,
  findIsland,
  htmlToPlainText,
  readArray,
  readBoolean,
  readNumber,
  readString,
  readStringArray,
  type Island,
} from "./astro";
import { ASURA_DOMAIN, statusLabel } from "./models";

const SERIES_DETAILS_KEYS = ["title", "alternativeTitles", "seriesId"];
const SERIES_CHAPTERS_KEYS = ["chapters", "publicUrl"];
const CHAPTER_KEYS = ["pages", "chapterId"];
const BROWSE_KEYS = ["initialSeries", "initialTotalPages"];

const ASURA_RATING_MAX = 10;

export const DISCOVER_TRENDING = "trending";
export const DISCOVER_LATEST_UPDATES = "latest-updates";
export const DISCOVER_POPULAR = "popular";

export function homeUrl(): string {
  return `${ASURA_DOMAIN}/`;
}

export type BrowseQuery = {
  search?: string;
  page?: number;
  sort?: string;
  direction?: string;
  genres?: string[];
  status?: string;
  type?: string;
  minChapters?: number;
  author?: string;
  artist?: string;
};

// Paperback renders `rating` as a percentage, so it expects a 0-1 fraction
function ratingFraction(source: Island, key: string): number | undefined {
  const rating = readNumber(source, key);
  if (rating === undefined) return undefined;
  return Math.min(Math.max(rating / ASURA_RATING_MAX, 0), 1);
}

// The series page joins alternative titles with a bullet; browse returns them as an array
function alternativeTitles(source: Island, key: string): string[] {
  const joined = readString(source, key);
  const titles = joined ? joined.split("•") : readStringArray(source, key);
  return titles.map((title) => title.trim()).filter((title) => title.length > 0);
}

export function seriesUrl(mangaId: string): string {
  return `${ASURA_DOMAIN}/comics/${mangaId}`;
}

export function browseUrl(query: BrowseQuery): string {
  const params: string[] = [];
  const append = (key: string, value: string) => {
    params.push(`${key}=${encodeURIComponent(value)}`);
  };

  if (query.search) append("search", query.search);
  if (query.genres && query.genres.length > 0) append("genres", query.genres.join(","));
  if (query.status && query.status !== "all") append("status", query.status);
  if (query.type && query.type !== "all") append("type", query.type);
  // Asura's `sort` selects the field and `order` selects the direction
  if (query.sort) append("sort", query.sort);
  if (query.direction) append("order", query.direction);
  if (query.minChapters !== undefined && query.minChapters > 0) {
    append("min_chapters", String(query.minChapters));
  }
  if (query.author) append("author", query.author);
  if (query.artist) append("artist", query.artist);
  if (query.page !== undefined && query.page > 1) append("page", String(query.page));

  return params.length > 0
    ? `${ASURA_DOMAIN}/browse?${params.join("&")}`
    : `${ASURA_DOMAIN}/browse`;
}

// The homepage renders several islands of the same shape, told apart by the fields their entries carry
function discoverEntries(islands: Island[], key: string, marker: string): Island[] {
  for (const island of islands) {
    const entries = readArray(island, key);
    const first = entries[0];
    if (first && marker in first) return entries;
  }
  return [];
}

function trendingItems(islands: Island[]): DiscoverSectionItem[] {
  return discoverEntries(islands, "items", "is_featured").flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId) return [];

    const description = readString(series, "description");

    return [
      {
        type: "featuredCarouselItem" as const,
        mangaId,
        title: readString(series, "title") ?? "Unknown Title",
        imageUrl: readString(series, "banner_url") ?? readString(series, "cover_url") ?? "",
        summary: description ? htmlToPlainText(description) : undefined,
        contentRating: ContentRating.MATURE,
      },
    ];
  });
}

// Asura groups the feed by series and pins one entry to the top, so it is neither
// one entry per series nor in publish order
function latestUpdateItems(islands: Island[]): DiscoverSectionItem[] {
  const chapters = discoverEntries(islands, "chapters", "comic_slug")
    .flatMap((chapter) => {
      const mangaId = readString(chapter, "comic_slug");
      const chapNum = readNumber(chapter, "number");
      if (!mangaId || chapNum === undefined) return [];

      const publishedAt = readString(chapter, "published_at");
      const parsed = publishedAt ? new Date(publishedAt) : undefined;
      const publishDate = parsed && !Number.isNaN(parsed.getTime()) ? parsed : undefined;

      return [{ chapter, mangaId, chapNum, publishDate }];
    })
    .sort((a, b) => (b.publishDate?.getTime() ?? 0) - (a.publishDate?.getTime() ?? 0));

  const seen = new Set<string>();
  const items: DiscoverSectionItem[] = [];

  for (const { chapter, mangaId, chapNum, publishDate } of chapters) {
    if (seen.has(mangaId)) continue;
    seen.add(mangaId);

    items.push({
      type: "chapterUpdatesCarouselItem",
      mangaId,
      chapterId: String(chapNum),
      title: readString(chapter, "comic_name") ?? "Unknown Title",
      subtitle: `Chapter ${readString(chapter, "name") ?? String(chapNum)}`,
      imageUrl: readString(chapter, "comic_cover") ?? "",
      publishDate,
      contentRating: ContentRating.MATURE,
    });
  }

  return items;
}

function popularItems(islands: Island[]): DiscoverSectionItem[] {
  return discoverEntries(islands, "items", "latest_chapter_number").flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId) return [];

    const latest = readNumber(series, "latest_chapter_number");

    return [
      {
        type: "simpleCarouselItem" as const,
        mangaId,
        title: readString(series, "title") ?? "Unknown Title",
        subtitle: latest === undefined ? undefined : `Chapter ${latest}`,
        imageUrl: readString(series, "cover_url") ?? "",
        contentRating: ContentRating.MATURE,
      },
    ];
  });
}

export function parseDiscoverItems(html: string, sectionId: string): DiscoverSectionItem[] {
  const islands = extractIslands(html);

  switch (sectionId) {
    case DISCOVER_TRENDING:
      return trendingItems(islands);
    case DISCOVER_LATEST_UPDATES:
      return latestUpdateItems(islands);
    case DISCOVER_POPULAR:
      return popularItems(islands);
    default:
      return [];
  }
}

// Asura hoists a pinned series to the top of its default ordering, out of order with the rest.
// `is_pinned` marks the series permanently rather than the hoisted row, so it cannot be filtered on
// its own without making that series unfindable.
function withoutHoistedPin(island: Island, entries: Island[]): Island[] {
  if (readString(island, "initialQuery")) return entries;
  if (readString(island, "initialOrder") !== "update") return entries;

  const [hoisted, next] = entries;
  if (!hoisted || !next || !readBoolean(hoisted, "is_pinned")) return entries;

  const hoistedUpdate = readString(hoisted, "last_chapter_at");
  const nextUpdate = readString(next, "last_chapter_at");
  if (!hoistedUpdate || !nextUpdate) return entries;

  const ascending = readString(island, "initialSortDirection") === "asc";
  const outOfOrder = ascending ? hoistedUpdate > nextUpdate : hoistedUpdate < nextUpdate;

  return outOfOrder ? entries.slice(1) : entries;
}

export function parseSearchResults(html: string): PagedResults<SearchResultItem> {
  const island = findIsland(html, BROWSE_KEYS);
  const entries = withoutHoistedPin(island, readArray(island, "initialSeries"));

  const items: SearchResultItem[] = entries.flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId) return [];

    return [
      {
        mangaId,
        title: readString(series, "title") ?? "Unknown Title",
        subtitle: alternativeTitles(series, "alt_titles")[0],
        imageUrl: readString(series, "cover") ?? "",
        contentRating: ContentRating.MATURE,
      },
    ];
  });

  const currentPage = readNumber(island, "initialCurrentPage") ?? 1;
  const totalPages = readNumber(island, "initialTotalPages") ?? 1;

  // Omit the key entirely on the last page rather than set it to undefined
  return currentPage < totalPages ? { items, metadata: currentPage + 1 } : { items };
}

export function chapterUrl(chapter: Chapter): string {
  const publicUrl = chapter.additionalInfo?.publicUrl;
  const base = publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(chapter.sourceManga.mangaId);
  return `${base}/chapter/${chapter.chapterId}`;
}

export function parseSeriesDetails(html: string, mangaId: string): SourceManga {
  const details = findIsland(html, SERIES_DETAILS_KEYS);
  const chapters = findIsland(html, SERIES_CHAPTERS_KEYS);

  const secondaryTitles = alternativeTitles(details, "alternativeTitles");

  const genres: Tag[] = readArray(details, "genres").flatMap((genre) => {
    const id = readString(genre, "slug");
    const title = readString(genre, "name");
    return id && title ? [{ id, title }] : [];
  });

  const tagGroups: TagSection[] =
    genres.length > 0 ? [{ id: "genres", title: "Genres", tags: genres }] : [];

  const thumbnailUrl = readString(details, "coverUrl") ?? "";
  const description = readString(details, "description");
  const publicUrl = readString(chapters, "publicUrl");

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: description ? htmlToPlainText(description) : "No synopsis.",
      primaryTitle: readString(details, "title") ?? "Unknown Title",
      secondaryTitles,
      contentRating: ContentRating.MATURE,
      status: statusLabel(readString(details, "status")),
      author: readString(details, "author"),
      artist: readString(details, "artist"),
      rating: ratingFraction(details, "rating"),
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(mangaId),
    },
  };
}

export function parseChapterList(html: string, sourceManga: SourceManga): Chapter[] {
  const island = findIsland(html, SERIES_CHAPTERS_KEYS);
  const publicUrl = readString(island, "publicUrl");
  const chapters: Chapter[] = [];

  for (const entry of readArray(island, "chapters")) {
    const chapNum = readNumber(entry, "number");
    if (chapNum === undefined) continue;

    const additionalInfo: Record<string, string> = {};
    if (publicUrl) additionalInfo.publicUrl = publicUrl;

    const publishedAt = readString(entry, "published_at");
    const publishDate = publishedAt ? new Date(publishedAt) : undefined;

    chapters.push({
      chapterId: String(chapNum),
      sourceManga,
      langCode: "en",
      chapNum,
      // Asura has no volumes; leaving this unset makes the app label every chapter "Vol. TBA"
      volume: 0,
      title: readString(entry, "title"),
      publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
      additionalInfo,
    });
  }

  return chapters;
}

function unlockedAt(unlockTime: string | undefined): string | undefined {
  if (!unlockTime) return undefined;
  const date = new Date(unlockTime);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const island = findIsland(html, CHAPTER_KEYS);

  if (readBoolean(island, "isLocked") || readBoolean(island, "isPremium")) {
    const releasesAt = unlockedAt(readString(island, "unlockTime"));
    throw new Error(
      releasesAt
        ? `Chapter ${chapter.chapNum} is in early access until ${releasesAt}. It will be readable once it is public for all users.`
        : `Chapter ${chapter.chapNum} is in early access. It will be readable once it is public for all users.`,
    );
  }

  const pages = readArray(island, "pages").flatMap((page) => {
    const url = readString(page, "url");
    return url ? [url] : [];
  });

  if (pages.length === 0) {
    throw new Error(`Asura Scans served no pages for chapter ${chapter.chapNum}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
