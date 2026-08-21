/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating } from "@paperback/types";

/**
 * Persisted state the settings form renders, plus the rating cache that makes the
 * verification it controls affordable. Everything else only reads it.
 */

const VERIFY_STATE = "freewebnovel.verifyRatings";
const RATING_CACHE_STATE = "freewebnovel.ratings";

/**
 * **On by default.**
 *
 * A listing row prints only its first two genres and this site orders the explicit
 * tags late, so most adult novels reach a listing looking unremarkable — on the
 * Latest Novels page, twelve of twenty are adult and the rows reveal four. Left
 * unverified they are neither blurred nor filtered, whichever the reader chose.
 *
 * This is deliberately not tied to `Application.filterAdultTitles`. That flag is
 * true only in Filter mode, and a reader on Blurred needs the rating just as much;
 * and choosing to filter adult content is not the same as consenting to the
 * requests verification costs. Both decisions are the reader's, separately.
 */
export function verifyRatingsEnabled(): boolean {
  const stored = Application.getState(VERIFY_STATE);
  return typeof stored === "boolean" ? stored : true;
}

export function setVerifyRatings(enabled: boolean): void {
  Application.setState(enabled, VERIFY_STATE);
}

/**
 * A novel's rating does not change, so it is worth keeping across launches: the
 * cost of verification is paid once per novel rather than once per browse.
 *
 * Stored as one delimited string rather than an object. An array or record written
 * to state is not reliably preserved across the bridge — the same reasoning as
 * Comix's logs.
 */
const RATING_CACHE_LIMIT = 2000;
const ENTRY_SEPARATOR = "\n";
const FIELD_SEPARATOR = "\t";

const RATINGS: Record<string, ContentRating> = {
  SAFE: ContentRating.EVERYONE,
  MATURE: ContentRating.MATURE,
  ADULT: ContentRating.ADULT,
};

let cache: Map<string, ContentRating> | undefined;

function load(): Map<string, ContentRating> {
  if (cache) return cache;

  const entries = new Map<string, ContentRating>();
  const stored = Application.getState(RATING_CACHE_STATE);
  if (typeof stored === "string") {
    for (const line of stored.split(ENTRY_SEPARATOR)) {
      const separator = line.indexOf(FIELD_SEPARATOR);
      if (separator <= 0) continue;
      // Narrow rather than cast: an unrecognised value is a stale format, not a rating.
      const rating = RATINGS[line.slice(separator + 1)];
      if (rating) entries.set(line.slice(0, separator), rating);
    }
  }

  cache = entries;
  return entries;
}

export function cachedRating(slug: string): ContentRating | undefined {
  return load().get(slug);
}

export function rememberRatings(resolved: [string, ContentRating][]): void {
  if (resolved.length === 0) return;
  const entries = load();

  for (const [slug, rating] of resolved) {
    // Re-inserting moves the entry to the end, which is what makes the eviction
    // below drop the least recently seen rather than the first ever stored.
    entries.delete(slug);
    entries.set(slug, rating);
  }

  while (entries.size > RATING_CACHE_LIMIT) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }

  const serialised = [...entries]
    .map(([slug, rating]) => `${slug}${FIELD_SEPARATOR}${rating}`)
    .join(ENTRY_SEPARATOR);
  Application.setState(serialised, RATING_CACHE_STATE);
}

export function cachedRatingCount(): number {
  return load().size;
}

export function clearRatingCache(): void {
  cache = new Map();
  Application.setState("", RATING_CACHE_STATE);
}
