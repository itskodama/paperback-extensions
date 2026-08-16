/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Building API paths. Kept free of `network.ts` so this layer stays unit-testable. */

// No URLSearchParams in this runtime. Repeated keys are supported because the batch
// endpoints take `?id=1&id=2`.
export function buildQuery(
  params: Record<string, string | number | boolean | readonly string[] | undefined>,
): string {
  const pairs: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;

    const encodedKey = encodeURIComponent(key);
    if (Array.isArray(value)) {
      for (const entry of value) pairs.push(`${encodedKey}=${encodeURIComponent(entry)}`);
    } else {
      pairs.push(`${encodedKey}=${encodeURIComponent(String(value))}`);
    }
  }

  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

export type SearchParams = {
  query?: string;
  page?: number;
  limit?: number;
  sort?: string;
  types?: readonly string[];
  statuses?: readonly string[];
  contentRatings?: readonly string[];
  genres?: readonly string[];
  genresExcluded?: readonly string[];
  yearFrom?: number;
  yearTo?: number;
};

function present(values: readonly string[] | undefined): readonly string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

/** The API needs ≥1 parameter, and `sort_by` alone satisfies it. */
export function searchPath(params: SearchParams): string {
  return `/v1/series/search${buildQuery({
    q: params.query && params.query.length > 0 ? params.query : undefined,
    page: params.page,
    limit: params.limit,
    sort_by: params.sort,
    type: present(params.types),
    status: present(params.statuses),
    content_rating: present(params.contentRatings),
    genre: present(params.genres),
    genre_not: present(params.genresExcluded),
    year_lower: params.yearFrom,
    year_upper: params.yearTo,
  })}`;
}
