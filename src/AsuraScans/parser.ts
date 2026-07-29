/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type Metadata,
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
  readNumberArray,
  readString,
  readStringArray,
  type Island,
} from "./astro.ts";
import { ASURA_DOMAIN, STATUS_OPTIONS, TYPE_OPTIONS, statusLabel } from "./models.ts";

const SERIES_DETAILS_KEYS = ["title", "alternativeTitles", "seriesId"];
const SERIES_CHAPTERS_KEYS = ["chapters", "publicUrl"];
const CHAPTER_KEYS = ["pages", "chapterId"];
const BROWSE_KEYS = ["initialSeries", "initialTotalPages"];

const ASURA_RATING_MAX = 10;

export const DISCOVER_FEATURED = "featured";
export const DISCOVER_TRENDING = "trending";
export const DISCOVER_LATEST_UPDATES = "latest-updates";
export const DISCOVER_RECENTLY_ADDED = "recently-added";
export const DISCOVER_STATUS = "status";
export const DISCOVER_COMIC_TYPE = "comic-type";
export const DISCOVER_NOVELS = "novels";

// A chip carousel whose taps launch a filtered browse, one chip per option
function facetItems(options: Tag[], metadata: (id: string) => Metadata): DiscoverSectionItem[] {
  return options
    .filter((option) => option.id !== "all")
    .map((option) => ({
      type: "genresCarouselItem",
      name: option.title,
      searchQuery: { title: "", metadata: metadata(option.id) },
      contentRating: ContentRating.MATURE,
    }));
}

export function statusItems(): DiscoverSectionItem[] {
  return facetItems(STATUS_OPTIONS, (id) => ({ status: id }));
}

export function comicTypeItems(): DiscoverSectionItem[] {
  return facetItems(TYPE_OPTIONS, (id) => ({ type: id }));
}

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

// Asura serves novels from the same payloads as comics, under /novels/
function isNovel(entry: Island): boolean {
  const path = readString(entry, "public_url") ?? readString(entry, "comic_public_url");
  return path !== undefined && path.startsWith("/novels/");
}

// Free chapters carry the epoch as their early-access deadline; a future one is still locked
function isFutureDate(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
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

// Several islands share the `items` key. Entries tell most of them apart, but the two ten-entry
// lists are identical in shape: Trending carries the site's own `title`, Popular an `editorsPick`.
function discoverEntries(
  islands: Island[],
  key: string,
  marker: string,
  islandMarker?: string,
): Island[] {
  for (const island of islands) {
    if (islandMarker !== undefined && !(islandMarker in island)) continue;

    const entries = readArray(island, key);
    const first = entries[0];
    if (first && marker in first) return entries;
  }
  return [];
}

type InfoItem = { symbol: string; text: string };

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

// 255678 -> "256K", 3965770 -> "4M"
function formatCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// A hero card shows a sentence or two on one line, not the whole synopsis
function shortSummary(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

function featuredItems(islands: Island[]): DiscoverSectionItem[] {
  return discoverEntries(islands, "items", "is_featured").flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId || isNovel(series)) return [];

    const supertitleParts: string[] = [];
    const type = readString(series, "type");
    if (type) supertitleParts.push(titleCase(type));
    const statusName = statusLabel(readString(series, "status"));
    if (statusName !== "Unknown") supertitleParts.push(statusName);

    const infoItems: InfoItem[] = [];
    const rating = readNumber(series, "rating");
    if (rating !== undefined && rating > 0) {
      infoItems.push({ symbol: "star.fill", text: formatRating(rating) });
    }
    const views = readNumber(series, "view_count");
    if (views !== undefined && views > 0) {
      infoItems.push({ symbol: "eye.fill", text: formatCount(views) });
    }

    const description = readString(series, "description");

    return [
      {
        type: "featuredCarouselItem" as const,
        mangaId,
        title: readString(series, "title") ?? "Unknown Title",
        // The cover matches the series page; banner_url is a different image and empty a third of the time
        imageUrl: readString(series, "cover_url") ?? "",
        supertitle: supertitleParts.length > 0 ? supertitleParts.join(" · ") : undefined,
        infoItems:
          infoItems.length > 0 ? (infoItems as [InfoItem] | [InfoItem, InfoItem]) : undefined,
        summary: description ? shortSummary(htmlToPlainText(description)) : undefined,
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
      if (!mangaId || chapNum === undefined || isNovel(chapter)) return [];

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

    const name = readString(chapter, "name") ?? String(chapNum);
    const earlyAccess =
      readBoolean(chapter, "is_premium") || isFutureDate(readString(chapter, "early_access_until"));

    items.push({
      type: "chapterUpdatesCarouselItem",
      mangaId,
      chapterId: String(chapNum),
      title: readString(chapter, "comic_name") ?? "Unknown Title",
      subtitle: earlyAccess ? `Chapter ${name} - Early Access` : `Chapter ${name}`,
      imageUrl: readString(chapter, "comic_cover") ?? "",
      publishDate,
      contentRating: ContentRating.MATURE,
    });
  }

  return items;
}

function seriesCarouselItems(
  entries: Island[],
  type: "simpleCarouselItem" | "prominentCarouselItem",
): DiscoverSectionItem[] {
  return entries.flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId || isNovel(series)) return [];

    const latest = readNumber(series, "latest_chapter_number");

    return [
      {
        type,
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
    case DISCOVER_FEATURED:
      return featuredItems(islands);
    case DISCOVER_TRENDING:
      return seriesCarouselItems(
        discoverEntries(islands, "items", "latest_chapter_number", "title"),
        "simpleCarouselItem",
      );
    case DISCOVER_LATEST_UPDATES:
      return latestUpdateItems(islands);
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
    if (!mangaId || isNovel(series)) return [];

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

  return currentPage < totalPages ? { items, metadata: currentPage + 1 } : { items };
}

// A browse result page rendered as a discover carousel rather than search results
export function parseBrowseCarousel(html: string): DiscoverSectionItem[] {
  const island = findIsland(html, BROWSE_KEYS);

  return withoutHoistedPin(island, readArray(island, "initialSeries")).flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId || isNovel(series)) return [];

    return [
      {
        type: "simpleCarouselItem" as const,
        mangaId,
        title: readString(series, "title") ?? "Unknown Title",
        subtitle: alternativeTitles(series, "alt_titles")[0],
        imageUrl: readString(series, "cover") ?? "",
        contentRating: ContentRating.MATURE,
      },
    ];
  });
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

function earlyAccessError(chapter: Chapter, unlockTime: string | undefined): Error {
  const releasesAt = unlockedAt(unlockTime);
  return new Error(
    releasesAt
      ? `Chapter ${chapter.chapNum} is in early access until ${releasesAt}. It will be readable once it is public for all users.`
      : `Chapter ${chapter.chapNum} is in early access. It will be readable once it is public for all users.`,
  );
}

// Reflects only the anonymous lock state — see network.ts's fetchChapterJson for why
export function chapterIsLocked(html: string): boolean {
  const island = findIsland(html, CHAPTER_KEYS);
  return readBoolean(island, "isLocked") || readBoolean(island, "isPremium");
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const island = findIsland(html, CHAPTER_KEYS);

  if (readBoolean(island, "isLocked") || readBoolean(island, "isPremium")) {
    throw earlyAccessError(chapter, readString(island, "unlockTime"));
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

// Same page shape as the embedded island, but snake_case and not tuple-encoded
export function parseChapterApiPayload(payload: unknown, chapter: Chapter): ChapterDetails {
  const data = payload as Island;

  if (readBoolean(data, "is_locked")) {
    throw earlyAccessError(chapter, readString(data, "unlock_time"));
  }

  const chapterObj = (data.chapter ?? {}) as Island;
  const pages = readArray(chapterObj, "pages").flatMap((page) => {
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

// --- Novels (/novels, /novels/<slug>, /novels/<slug>/chapter/<n>) ---
// A separate pipeline from comics above: the comics route (/comics/<slug>-<hash>) resolves a
// novel's slug too, but its chapters island is a disconnected, comic-shaped table with different
// ids that doesn't correspond to what /novels/<slug>/chapter/<n> actually serves

const NOVEL_CATALOG_KEYS = ["initialItems"];
const NOVEL_CHAPTERS_KEYS = ["chapters", "novelSlug", "totalChapters"];
const NOVEL_CHAPTER_KEYS = ["paragraphs", "isLocked"];

export function novelCatalogUrl(): string {
  return `${ASURA_DOMAIN}/novels`;
}

export function novelUrl(mangaId: string): string {
  return `${ASURA_DOMAIN}/novels/${mangaId}`;
}

export function novelChapterUrl(chapter: Chapter): string {
  return `${novelUrl(chapter.sourceManga.mangaId)}/chapter/${chapter.chapterId}`;
}

export function parseNovelCatalog(html: string): Island[] {
  const island = findIsland(html, NOVEL_CATALOG_KEYS);
  return readArray(island, "initialItems");
}

export function novelCatalogEntry(catalog: Island[], mangaId: string): Island | undefined {
  return catalog.find((entry) => readString(entry, "slug") === mangaId);
}

export function novelToSourceManga(entry: Island): SourceManga {
  const mangaId = readString(entry, "slug") ?? "";
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

export function novelToDiscoverItem(entry: Island): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: readString(entry, "slug") ?? "",
    title: readString(entry, "title") ?? "Unknown Title",
    imageUrl: readString(entry, "cover_url") ?? "",
    contentRating: ContentRating.MATURE,
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
