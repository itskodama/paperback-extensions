/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** The homepage's discover carousels, built from its islands. */

import { ContentRating, type DiscoverSectionItem, type Metadata, type Tag } from "@paperback/types";

import {
  extractIslands,
  findIsland,
  htmlToPlainText,
  readArray,
  readBoolean,
  readNumber,
  readString,
  type Island,
} from "./astro.ts";
import { alternativeTitles, isFutureDate, isNovel } from "./fields.ts";
import { type InfoItem, formatCount, formatRating, shortSummary, titleCase } from "./format.ts";
import { STATUS_OPTIONS, TYPE_OPTIONS, statusLabel } from "./models.ts";

export const BROWSE_KEYS = ["initialSeries", "initialTotalPages"];

export const DISCOVER_FEATURED = "featured";

export const DISCOVER_TRENDING = "trending";

export const DISCOVER_LATEST_UPDATES = "latest-updates";

export const DISCOVER_RECENTLY_ADDED = "recently-added";

export const DISCOVER_STATUS = "status";

export const DISCOVER_COMIC_TYPE = "comic-type";

// A chip carousel whose taps launch a filtered browse, one chip per option

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

// Asura hoists a pinned series to the top of its default ordering, out of order with the rest.
// `is_pinned` marks the series permanently rather than the hoisted row, so it cannot be filtered on
// its own without making that series unfindable.
export function withoutHoistedPin(island: Island, entries: Island[]): Island[] {
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

// Carries the raw fields needed to sort comics and novels into one combined order (see
// mergeRankedResults) alongside the finished item — comics and novels are fetched from entirely
// separate backends that each only sort their own results, so combining them into one list
// correctly requires re-sorting from these raw values, not just concatenating two pre-sorted lists

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
