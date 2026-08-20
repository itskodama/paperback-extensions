/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { DEFAULT_SORT, DOMAIN, MIRROR_DOMAIN } from "./models.ts";

/**
 * Pure URL construction. Kept apart from `parsers.ts` (which reads pages) and
 * `main.ts` (which dispatches) so the shape of every request the extension makes
 * lives in one place.
 */

function isOffOrigin(url: string): boolean {
  return !url.startsWith(DOMAIN) && !url.startsWith(MIRROR_DOMAIN);
}

// Everything the site's own page pulls while it runs in the WebView. Confirmed
// from the app's debug log: these do reach the extension's interceptors.
const PAGE_RESOURCE_PATHS = ["/assets/", "/api/", "/images/"];

/**
 * Whether a request is one this extension made, as opposed to one the site's own
 * page made while running inside the WebView.
 *
 * Only ours should be paced. A WebView page load pulls a dozen bundles, its API
 * calls and its avatars from the origin, and throttling those throttles the site
 * behaving normally — a browser does not do it, and doing it here cost roughly
 * 9 seconds per request once the budget was spent. Page images additionally live
 * on extensionless CDN URLs, which BasicRateLimiter's extension-matching
 * exemption never recognised.
 */
export function isOwnRequest(url: string): boolean {
  if (isOffOrigin(url)) return false;

  const path = url.slice(url.indexOf("/", "https://".length));
  return !PAGE_RESOURCE_PATHS.some((prefix) => path.startsWith(prefix));
}

export function homeUrl(): string {
  return `${DOMAIN}/`;
}

export function seriesUrl(hid: string): string {
  return `${DOMAIN}/title/${hid}`;
}

type BrowseFilters = {
  contentRatings: string[];
  types: string[];
  statuses: string[];
  demographics: string[];
  genres: string[];
  formats: string[];
  genresMode: string;
};

function appendAll(params: string[], key: string, values: string[]): void {
  for (const value of values) {
    params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }
}

/**
 * The browse page reads its filters straight from the query string and signs
 * whatever it finds, so the extension only has to compose the URL the site's own
 * UI would have. A sort id is `<field>:<direction>` expanding to `order[<field>]`,
 * and repeated filters use the `name[]` form.
 */
export function browseUrl(
  title: string,
  filters: BrowseFilters,
  sort: string,
  page: number,
): string {
  const [field, direction] = (sort || DEFAULT_SORT).split(":");
  const params = [
    `q=${encodeURIComponent(title)}`,
    `order[${field ?? "relevance"}]=${direction ?? "desc"}`,
    `page=${page}`,
  ];

  appendAll(params, "content_rating[]", filters.contentRatings);
  appendAll(params, "types[]", filters.types);
  appendAll(params, "statuses[]", filters.statuses);
  appendAll(params, "demographics[]", filters.demographics);
  appendAll(params, "genres_in[]", filters.genres);
  appendAll(params, "formats[]", filters.formats);
  // The site only sends the mode when it disambiguates more than one genre.
  if (filters.genres.length > 1) params.push(`genres_mode=${filters.genresMode}`);

  return `${DOMAIN}/browse?${params.join("&")}`;
}
