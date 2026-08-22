/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Pure URL construction. Kept apart from the parsers (which read responses) and `main.ts` (which
 * dispatches) so the shape of every request the extension makes lives in one place.
 */

import { API_DOMAIN, DEFAULT_SORT, DOMAIN, PER_PAGE, type SearchFilters } from "./models.ts";

export type BrowseQuery = SearchFilters & {
  page: number;
  searchTerm?: string;
};

function append(params: string[], key: string, value: string): void {
  params.push(`${key}=${encodeURIComponent(value)}`);
}

/**
 * The archive endpoint the site's own filter UI calls. `view=archive` is the public projection;
 * the only other one, `manage`, needs a privileged session.
 */
export function queryUrl(query: BrowseQuery, sort: string): string {
  const [orderBy, orderDirection] = (sort || DEFAULT_SORT).split(":");
  const params = [`page=${query.page}`, `perPage=${PER_PAGE}`, "view=archive"];

  append(params, "orderBy", orderBy ?? "lastChapterAddedAt");
  append(params, "orderDirection", orderDirection ?? "desc");

  if (query.searchTerm) append(params, "searchTerm", query.searchTerm);
  if (query.includedGenres.length > 0) {
    append(params, "genreIds", query.includedGenres.join(","));
  }
  if (query.excludedGenres.length > 0) {
    append(params, "excludedGenreIds", query.excludedGenres.join(","));
  }
  if (query.type !== "all") append(params, "seriesType", query.type);
  if (query.status !== "all") append(params, "seriesStatus", query.status);
  if (query.minChapters > 0) append(params, "minChapters", String(query.minChapters));
  if (query.maxChapters > 0) append(params, "maxChapters", String(query.maxChapters));

  return `${DOMAIN}/api/query?${params.join("&")}`;
}

/** `take=all` returns every chapter in one response, so there is no list to walk. */
export function chaptersUrl(postId: string): string {
  return `${API_DOMAIN}/api/chapters?postId=${encodeURIComponent(postId)}&skip=0&take=all&order=desc`;
}

/** Series detail as JSON. The site's own page carries the same object inside ~1 MB of HTML. */
export function postUrl(postId: string): string {
  return `${API_DOMAIN}/api/post?postId=${encodeURIComponent(postId)}`;
}

/** A chapter's images (comics) or text (novels), keyed by its numeric id. */
export function chapterUrl(chapterId: string): string {
  return `${API_DOMAIN}/api/chapter?chapterId=${encodeURIComponent(chapterId)}`;
}

export function genresUrl(): string {
  return `${API_DOMAIN}/api/genres`;
}

/** Only ever handed to the reader as a shareable link — nothing is fetched from it. */
export function seriesUrl(slug: string): string {
  return `${DOMAIN}/series/${encodeURIComponent(slug)}`;
}
