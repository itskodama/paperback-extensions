/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Domain constants and the shapes the site's own JSON uses. See docs/HiveToons/site-recon.md. */

export const DOMAIN = "https://hivetoons.org";

/** Everything except `/api/query` answers only here; the main host 404s the rest. */
export const API_DOMAIN = "https://api.hivetoons.org";

/** The origin caps the page size here — asking for 120 or 200 still returns 100. */
export const PER_PAGE = 100;

// --- Sorting ---

/** `<orderBy>:<orderDirection>`, both halves passed straight through to the API. */
export const DEFAULT_SORT = "lastChapterAddedAt:desc";

/**
 * `chaptersCount` and `averageRating` are deliberately absent. The first is a valid ordering whose
 * response ignores `perPage` entirely, and the second is not a valid ordering at all — it falls
 * back to the default silently rather than erroring. See site-recon.md#traps.
 */
export const SORT_OPTIONS: { id: string; title: string }[] = [
  { id: "lastChapterAddedAt:desc", title: "Latest Chapter" },
  { id: "totalViews:desc", title: "Most Popular" },
  { id: "createdAt:desc", title: "Recently Added" },
  { id: "createdAt:asc", title: "Oldest First" },
  { id: "updatedAt:desc", title: "Recently Updated" },
  { id: "postTitle:asc", title: "Title (A-Z)" },
  { id: "postTitle:desc", title: "Title (Z-A)" },
];

// --- Filters ---

/**
 * The filter set the advanced-search form collects and the archive URL sends. Shared so the two
 * cannot drift, and defined here rather than in either so neither layer depends on the other.
 *
 * It doubles as `Metadata`, which crosses to the app as a raw JSValue — so every key must always
 * be present, and genres are two flat lists rather than one record of union values. See
 * docs/paperback/bridge.md.
 */
export type SearchFilters = {
  includedGenres: string[];
  excludedGenres: string[];
  type: string;
  status: string;
  minChapters: number;
  maxChapters: number;
};

export const DEFAULT_FILTERS: SearchFilters = {
  includedGenres: [],
  excludedGenres: [],
  type: "all",
  status: "all",
  minChapters: 0,
  maxChapters: 0,
};

// --- Filter vocabularies ---

export const TYPE_OPTIONS: { id: string; title: string }[] = [
  { id: "all", title: "All" },
  { id: "MANHWA", title: "Manhwa" },
  { id: "MANHUA", title: "Manhua" },
  { id: "MANGA", title: "Manga" },
  { id: "NOVEL", title: "Novel" },
];

export const STATUS_OPTIONS: { id: string; title: string }[] = [
  { id: "all", title: "All" },
  { id: "ONGOING", title: "Ongoing" },
  { id: "COMPLETED", title: "Completed" },
  { id: "HIATUS", title: "Hiatus" },
  { id: "DROPPED", title: "Dropped" },
];

/**
 * Content rating is decided from a title's genre *names*, not their ids.
 *
 * The site's ids are arbitrary and non-contiguous, and a set of them only ever describes the
 * catalog as it stood when it was written — a genre added next month goes unrated. Names are what
 * the site actually publishes and are stable across the platform's other deployments, so matching
 * on them means a new `Smut` or `Hentai` needs no code change.
 *
 * Matched exactly against a normalised name, never as a substring: `Adult` must not be caught by
 * an unrelated genre that merely contains the word.
 */
export const ADULT_GENRE_NAMES: ReadonlySet<string> = new Set([
  "adult",
  "erotica",
  "hentai",
  // Tags denoting sexualised minors are rated at the strictest level the app offers, so that a
  // reader filtering adult content is never shown one unasked.
  "lolicon",
  "shotacon",
  "smut",
]);

export const MATURE_GENRE_NAMES: ReadonlySet<string> = new Set(["ecchi", "gore", "mature"]);

// --- The site's own JSON ---

export type ApiGenre = {
  id: number;
  name: string;
};

/** A genre as the filter form and the discover section render it. */
export type GenreOption = {
  id: string;
  title: string;
};

/**
 * Only what the catalog screens actually render. The response carries a good deal more — type,
 * status, rating, `hot`, `isPinned`, sale fields, the newest few chapters in full — which
 * site-recon.md records and this deliberately does not model.
 */
export type ApiPost = {
  id: number;
  slug: string;
  postTitle: string;
  featuredImage?: string;
  genres: ApiGenre[];
  /** Shown as the result subtitle; the rest of the attached chapter objects go unused. */
  latestChapterNumber?: number;
};

/**
 * The response also carries a `searchTerm` echo, deliberately not modelled here: it is unreliable
 * in both directions and has been observed returning a *different* query's term. See
 * docs/HiveToons/site-recon.md#3-the-search-silently-falls-back-to-the-whole-catalog.
 */
export type ApiQueryResponse = {
  posts: ApiPost[];
  totalCount: number;
};

export type ApiChapter = {
  /** Numeric, because `/api/chapter` is keyed by it. Still charset-safe as a `chapterId`. */
  id: string;
  number: number;
  title?: string;
  /** The only trustworthy paywall signal: `isLocked`/`isAccessible` lie to an anonymous client. */
  price: number;
  unlockAt?: string;
  createdAt?: string;
};
