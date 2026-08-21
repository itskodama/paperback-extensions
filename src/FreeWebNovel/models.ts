/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { type SortingOption } from "@paperback/types";

/**
 * Domain vocabulary and payload shapes. No behaviour, no imports from any other
 * module here — everything else in the extension depends on this file, so it has
 * to stay a leaf.
 */

export const DOMAIN = "https://freewebnovel.com";

/** Both listing endpoints stop here; the site says so in its own search tips. */
export const SEARCH_PAGE_LIMIT = 5;

/** Server-capped: asking for more returns 200 anyway. */
export const CHAPTER_PAGE_SIZE = 200;

export const DISCOVER_FEATURED = "featured";
export const DISCOVER_LATEST_RELEASE = "latest-release";
export const DISCOVER_POPULAR = "most-popular";
export const DISCOVER_LATEST = "latest-novel";
export const DISCOVER_COMPLETED = "completed-novel";
export const DISCOVER_GENRES = "genres";

/** Discover sections that are just a `/sort/<key>` browse list, keyed by section id. */
export const BROWSE_SECTIONS: Record<string, string> = {
  [DISCOVER_POPULAR]: "most-popular",
  [DISCOVER_LATEST]: "latest-novel",
  [DISCOVER_COMPLETED]: "completed-novel",
};

/**
 * Paperback's sort control is one flat list with no direction toggle, so each
 * of the site's `sort` values becomes a single option with the direction in its
 * label.
 */
export const SORT_OPTIONS: SortingOption[] = [
  { id: "updated", label: "Recently Updated" },
  { id: "popular", label: "Most Popular" },
  { id: "rating", label: "Highest Rated" },
  { id: "collected", label: "Most Collected" },
  { id: "chapters", label: "Most Chapters" },
  { id: "title", label: "Title — A to Z" },
];

export const DEFAULT_SORT = "updated";

/** The full genre vocabulary, read off the `/search-adv` form. */
export const GENRES: string[] = [
  "Action",
  "Adult",
  "Adventure",
  "Comedy",
  "Drama",
  "Eastern",
  "Ecchi",
  "Fan-fic",
  "Fantasy",
  "Game",
  "Gender Bender",
  "Harem",
  "Historical",
  "Horror",
  "Josei",
  "Martial Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Reincarnation",
  "Romance",
  "School Life",
  "Sci-fi",
  "Seinen",
  "Shoujo",
  "Shounen Ai",
  "Shounen",
  "Slice of Life",
  "Smut",
  "Sports",
  "Supernatural",
  "System",
  "Tragedy",
  "Wuxia",
  "Xianxia",
  "Xuanhuan",
  "Yaoi",
];

/** Genres that push a novel from MATURE to ADULT. */
export const ADULT_GENRES = new Set(["Adult", "Smut"]);

/** `language[]` takes the numeric id; the label is what the site displays. */
export const LANGUAGES: { id: string; label: string }[] = [
  { id: "1", label: "Chinese" },
  { id: "2", label: "Korean" },
  { id: "3", label: "Japanese" },
  { id: "4", label: "English" },
];

export const GENRE_MATCHES: { id: string; label: string }[] = [
  { id: "all", label: "All selected" },
  { id: "any", label: "Any selected" },
];

/**
 * The "no preference" option id. An empty string is not a valid bridge id, so the
 * sentinel stands in for one and is dropped when the filters are built.
 */
export const FILTER_ANY = "any";

export const STATUSES: { id: string; label: string }[] = [
  { id: FILTER_ANY, label: "Any" },
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
];

export const CHAPTER_BANDS: { id: string; label: string }[] = [
  { id: FILTER_ANY, label: "Any" },
  { id: "under-50", label: "Under 50" },
  { id: "50-100", label: "50 – 100" },
  { id: "100-200", label: "100 – 200" },
  { id: "200-500", label: "200 – 500" },
  { id: "500-1000", label: "500 – 1000" },
  { id: "over-1000", label: "Over 1000" },
];

export const MIN_RATINGS: { id: string; label: string }[] = [
  { id: FILTER_ANY, label: "Any" },
  { id: "3", label: "3.0 and up" },
  { id: "4", label: "4.0 and up" },
  { id: "4.5", label: "4.5 and up" },
];

export const UPDATED_WINDOWS: { id: string; label: string }[] = [
  { id: FILTER_ANY, label: "Any time" },
  { id: "24-hours", label: "Last 24 hours" },
  { id: "7-days", label: "Last 7 days" },
  { id: "30-days", label: "Last 30 days" },
  { id: "3-months", label: "Last 3 months" },
];

export const CONTENT_RATINGS: { id: string; label: string }[] = [
  { id: FILTER_ANY, label: "Any" },
  { id: "general", label: "General" },
  { id: "guidance", label: "Parental guidance" },
  { id: "suggestive", label: "Suggestive" },
  { id: "adults-only", label: "Adults only" },
];

/**
 * Filters as the extension carries them, and as they arrive back in
 * `query.metadata`. Every field is optional and **only ever assigned when it has
 * a value** — an `undefined` inside a `Metadata` crashes on device.
 */
export type SearchFilters = {
  genresInclude?: string[];
  genresExclude?: string[];
  genreMatch?: string;
  languages?: string[];
  status?: string;
  chapters?: string;
  rating?: string;
  lastUpdated?: string;
  contentRating?: string;
};

/** One `div.li-row` from any of the four listing endpoints. */
export type ListingRow = {
  slug: string;
  title: string;
  thumbnailUrl: string;
  genres: string[];
  language?: string;
  rating?: number;
  chapterCount?: number;
};

export type ListingPage = {
  rows: ListingRow[];
  lastPage: number;
};

export type NovelDetail = {
  slug: string;
  title: string;
  synopsis: string;
  thumbnailUrl: string;
  alternativeTitles: string[];
  genres: string[];
  author?: string;
  language?: string;
  status?: string;
  rating?: number;
  totalChapters?: number;
  /** The site's own rating: `general`, `guidance`, `suggestive`, `adults-only`. */
  contentRating?: string;
};

export type ChapterEntry = {
  /** The URL index — gapless `1..N`, and the only trustworthy number here. */
  index: number;
  title?: string;
};

/** The `?ajax=chapters` response. `code` is 200 on success, in the body. */
export type ChapterListPage = {
  entries: ChapterEntry[];
  page: number;
  totalPage: number;
  totalChapters: number;
};

export type ReleaseEntry = {
  slug: string;
  title: string;
  thumbnailUrl: string;
  chapterIndex: number;
  chapterTitle?: string;
  publishDate?: Date;
};
