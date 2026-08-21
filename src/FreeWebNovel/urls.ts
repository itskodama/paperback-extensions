/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { CHAPTER_PAGE_SIZE, DEFAULT_SORT, DOMAIN, type SearchFilters } from "./models.ts";

/**
 * Pure URL construction. Every request the extension makes is shaped here, apart
 * from `parsers.ts` (which reads pages) and `main.ts` (which dispatches).
 *
 * The runtime has no `URLSearchParams` and no global `URL`, so query strings are
 * assembled by hand — see `docs/paperback/runtime.md`.
 */

function query(pairs: [string, string][]): string {
  return pairs
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function homeUrl(): string {
  return `${DOMAIN}/home`;
}

export function novelUrl(slug: string): string {
  return `${DOMAIN}/novel/${encodeURIComponent(slug)}`;
}

export function chapterUrl(slug: string, index: number): string {
  return `${novelUrl(slug)}/chapter-${index}`;
}

/**
 * The chapter list the page's own JS paginates. `pageSize` is capped at 200
 * server-side, and the response reports `totalPage`, so page 1 is both data and
 * the count of what is left to fetch.
 */
export function chapterListUrl(slug: string, page: number): string {
  const params = query([
    ["ajax", "chapters"],
    ["page", String(page)],
    ["pageSize", String(CHAPTER_PAGE_SIZE)],
  ]);
  return `${novelUrl(slug)}?${params}`;
}

/**
 * Page 1 is the bare query. The site treats an explicit `page=1` as non-canonical
 * and answers `301` — and this runtime does not follow redirects, so sending one
 * fails the search outright rather than costing a round trip.
 */
export function searchUrl(keyword: string, page: number): string {
  const pairs: [string, string][] = [["keyword", keyword]];
  if (page > 1) pairs.push(["page", String(page)]);
  return `${DOMAIN}/search?${query(pairs)}`;
}

/**
 * A path segment, encoded the way this site encodes them: spaces become `+`.
 * `%20` is not an accepted synonym here — `/genre/Gender%20Bender` returns an
 * empty body where `/genre/Gender+Bender` returns the page.
 */
function pathSegment(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

/** `/sort/<key>[/completed]/<page>`. Page 1 is the bare path. */
export function sortUrl(key: string, page: number, completedOnly = false): string {
  const parts = [`${DOMAIN}/sort/${pathSegment(key)}`];
  if (completedOnly) parts.push("completed");
  if (page > 1) parts.push(String(page));
  return parts.join("/");
}

/** `/genre/<Genre>[/completed]/<page>`. Page is a path segment; `?page=` is ignored. */
export function genreUrl(genre: string, page: number, completedOnly = false): string {
  const parts = [`${DOMAIN}/genre/${pathSegment(genre)}`];
  if (completedOnly) parts.push("completed");
  if (page > 1) parts.push(String(page));
  return parts.join("/");
}

/**
 * The filter engine.
 *
 * `apply=1` is the submit button's own name/value and is **required**: without it
 * the page renders the form with an empty result list and a "select your
 * preferences" placeholder, which is indistinguishable from "no matches".
 *
 * `genre_match` is one mode for the whole selected set, so exclusions cannot ride
 * along with inclusions in a single request. Only the include set is sent; the
 * caller drops excluded genres from the rows afterwards.
 */
export function advancedSearchUrl(filters: SearchFilters, sort: string, page: number): string {
  const pairs: [string, string][] = [["apply", "1"]];

  const include = filters.genresInclude ?? [];
  const exclude = filters.genresExclude ?? [];
  // With nothing included, exclusions are expressible on their own.
  const genres = include.length > 0 ? include : exclude;
  const match = include.length > 0 ? (filters.genreMatch ?? "all") : "exclude";

  for (const genre of genres) pairs.push(["genre[]", genre]);
  if (genres.length > 0) pairs.push(["genre_match", match]);

  for (const language of filters.languages ?? []) pairs.push(["language[]", language]);

  if (filters.status) pairs.push(["status", filters.status]);
  if (filters.chapters) pairs.push(["chapters", filters.chapters]);
  if (filters.rating) pairs.push(["rating", filters.rating]);
  if (filters.lastUpdated) pairs.push(["last_updated", filters.lastUpdated]);
  if (filters.contentRating) pairs.push(["content_rating", filters.contentRating]);

  pairs.push(["sort", sort || DEFAULT_SORT]);
  if (page > 1) pairs.push(["page", String(page)]);

  return `${DOMAIN}/search-adv?${query(pairs)}`;
}

/** Covers and other assets are served host-relative. */
export function absoluteUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${DOMAIN}${path.startsWith("/") ? path : `/${path}`}`;
}
