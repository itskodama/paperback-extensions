/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Search results, and merging the independently-sorted comic and novel lists. */

import { ContentRating, type SearchResultItem } from "@paperback/types";

import { findIsland, readArray, readNumber, readString, type Island } from "./astro.ts";
import { BROWSE_KEYS, withoutHoistedPin } from "./discover.ts";
import { isNovel } from "./fields.ts";
import { NOVEL_ID_PREFIX } from "./urls.ts";

// Carries the raw fields needed to sort comics and novels into one combined order (see
// mergeRankedResults) alongside the finished item — comics and novels are fetched from entirely
// separate backends that each only sort their own results, so combining them into one list
// correctly requires re-sorting from these raw values, not just concatenating two pre-sorted lists
export type RankedSearchResult = {
  item: SearchResultItem;
  title: string;
  rating?: number;
  createdAt?: string;
  lastUpdate?: string;
  bookmarks?: number;
};

// A comic's `alt_titles` and a novel's `alternative_titles` are independent per-record lists that
// don't correspond to each other even for what a user would consider "the same" series, so picking
// entry [0] as a subtitle looks inconsistent between the two. "Comic/Novel | Chapter N" instead:
// consistent by construction, and more directly useful for search/discover than a stray alt title
function latestChapterSubtitle(kind: "Comic" | "Novel", chapters: Island[]): string | undefined {
  const number = readNumber(chapters[0] ?? {}, "number");
  return number === undefined ? undefined : `${kind} | Chapter ${number}`;
}

export function rankedSearchResults(html: string): {
  ranked: RankedSearchResult[];
  currentPage: number;
  totalPages: number;
} {
  const island = findIsland(html, BROWSE_KEYS);
  const entries = withoutHoistedPin(island, readArray(island, "initialSeries"));

  const ranked: RankedSearchResult[] = entries.flatMap((series) => {
    const mangaId = readString(series, "slug");
    if (!mangaId || isNovel(series)) return [];

    const title = readString(series, "title") ?? "Unknown Title";
    return [
      {
        item: {
          mangaId,
          title,
          subtitle: latestChapterSubtitle("Comic", readArray(series, "latest_chapters")),
          imageUrl: readString(series, "cover") ?? "",
          contentRating: ContentRating.MATURE,
        },
        title,
        rating: readNumber(series, "rating"),
        createdAt: readString(series, "created_at"),
        lastUpdate: readString(series, "last_chapter_at"),
        bookmarks: readNumber(series, "bookmark_count"),
      },
    ];
  });

  return {
    ranked,
    currentPage: readNumber(island, "initialCurrentPage") ?? 1,
    totalPages: readNumber(island, "initialTotalPages") ?? 1,
  };
}

function rankedSortKey(entry: RankedSearchResult, sortField: string): string | number {
  switch (sortField) {
    case "rating":
      return entry.rating ?? -1;
    case "update":
      return entry.lastUpdate ?? "";
    case "newest":
      // Novels expose no distinct series-creation field, so they fall back to lastUpdate —
      // comics use their own real created_at
      return entry.createdAt ?? entry.lastUpdate ?? "";
    case "popular":
      return entry.bookmarks ?? -1;
    default:
      return entry.title.toLowerCase();
  }
}

// A single full re-sort of the small combined page, rather than a merge of two pre-sorted lists —
// cheap at this scale (one comics page + the whole novel catalog) and avoids needing both
// backends' orderings to agree on tie-breaking
export function mergeRankedResults(
  a: RankedSearchResult[],
  b: RankedSearchResult[],
  sortField: string,
  direction: string,
): SearchResultItem[] {
  return [...a, ...b]
    .sort((x, y) => {
      const kx = rankedSortKey(x, sortField);
      const ky = rankedSortKey(y, sortField);
      const cmp = kx < ky ? -1 : kx > ky ? 1 : 0;
      return direction === "asc" ? cmp : -cmp;
    })
    .map((entry) => entry.item);
}

// Same field names as the /novels catalog (see novels.ts's novelToSourceManga) but plain JSON, not
// an astro-island — cast straight to Island like parseNovelChapterApiPayload does for the other
// JSON endpoint. Multi-genre selection is AND here, not OR like comics (confirmed live) — accepted
// as a known limitation given the tiny catalog, not worked around
export function rankedNovelSearchResults(payload: unknown): {
  ranked: RankedSearchResult[];
  total: number;
} {
  const root = payload as Island;
  const entries = readArray(root, "data");
  const meta = (root.meta ?? {}) as Island;
  const total = readNumber(meta, "total") ?? entries.length;

  const ranked: RankedSearchResult[] = entries.flatMap((entry) => {
    const slug = readString(entry, "slug");
    if (!slug) return [];

    const title = readString(entry, "title") ?? "Unknown Title";
    const lastUpdate = readString(entry, "last_chapter_at");
    return [
      {
        item: {
          mangaId: NOVEL_ID_PREFIX + slug,
          title,
          subtitle: latestChapterSubtitle("Novel", readArray(entry, "recent_chapters")),
          imageUrl: readString(entry, "cover_url") ?? "",
          contentRating: ContentRating.MATURE,
        },
        title,
        rating: readNumber(entry, "rating"),
        lastUpdate,
        bookmarks: readNumber(entry, "bookmarks"),
      },
    ];
  });

  return { ranked, total };
}

export function parseNovelSearchResults(payload: unknown): {
  items: SearchResultItem[];
  total: number;
} {
  const { ranked, total } = rankedNovelSearchResults(payload);
  return { items: ranked.map((entry) => entry.item), total };
}
