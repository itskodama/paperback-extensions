/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { DEFAULT_SORT, DOMAIN } from "./models.ts";

/**
 * Pure URL construction. Kept apart from `parsers.ts` (which reads pages) and
 * `main.ts` (which dispatches) so the shape of every request the extension makes
 * lives in one place.
 */

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
