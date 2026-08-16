/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * The shapes MangaBaka's API returns and the vocabularies it uses. Nothing here interprets
 * them; that lives in `titles.ts`, `mapping.ts` and `progress.ts`. See site-recon.md.
 */

import { ContentRating } from "@paperback/types";

export const SITE_BASE = "https://mangabaka.org";
export const API_BASE = "https://api.mangabaka.org";

/** better-auth mounts its routes on the site host, not the API host. */
export const AUTH_BASE = `${SITE_BASE}/auth`;

// Series

export type SeriesTitle = {
  language?: string | null;
  traits?: string[];
  title?: string | null;
  note?: string | null;
  is_primary?: boolean;
};

export type CoverVariant = { x1?: string | null; x2?: string | null; x3?: string | null };

/** v1 nests (`raw: { url }`); v2's discover feeds flatten each field to a bare URL. */
export type CoverField =
  | string
  | {
      url?: string | null;
      size?: number | null;
      width?: number | null;
      height?: number | null;
      blurhash?: string | null;
      thumbhash?: string | null;
      format?: string | null;
    }
  | null;

export type CoverVariantField = string | CoverVariant | null;

export type SeriesCover = {
  raw?: CoverField;
  x150?: CoverVariantField;
  x250?: CoverVariantField;
  x350?: CoverVariantField;
};

export type Series = {
  id: number;
  state?: string | null;
  merged_with?: number | null;
  title?: string | null;
  native_title?: string | null;
  romanized_title?: string | null;
  titles?: SeriesTitle[] | null;
  cover?: SeriesCover | null;
  authors?: string[] | null;
  artists?: string[] | null;
  description?: string | null;
  year?: number | null;
  status?: string | null;
  content_rating?: string | null;
  type?: string | null;
  rating?: number | null;
  is_licensed?: boolean | null;
  has_anime?: boolean | null;
  /** Nullable **strings**, not numbers — e.g. `"232"`. */
  total_chapters?: string | null;
  final_volume?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
};

export type SeriesContentRating = "safe" | "suggestive" | "erotica" | "pornographic";

export const CONTENT_RATINGS: Record<SeriesContentRating, ContentRating> = {
  safe: ContentRating.EVERYONE,
  suggestive: ContentRating.MATURE,
  erotica: ContentRating.ADULT,
  pornographic: ContentRating.ADULT,
};

export const SERIES_STATUS_LABELS: Record<string, string> = {
  cancelled: "Cancelled",
  completed: "Completed",
  hiatus: "Hiatus",
  releasing: "Ongoing",
  unknown: "Unknown",
  upcoming: "Upcoming",
};

export const SERIES_TYPE_LABELS: Record<string, string> = {
  manga: "Manga",
  novel: "Novel",
  manhwa: "Manhwa",
  manhua: "Manhua",
  oel: "OEL",
  other: "Other",
};

export type GenreOption = { id: string; title: string };
export type GenresResponse = { label?: string | null; value?: string | null }[];

// Library

export type LibraryEntry = {
  id?: number;
  series_id?: number;
  state?: string | null;
  rating?: number | null;
  progress_chapter?: number | null;
  progress_volume?: number | null;
  number_of_rereads?: number | null;
  start_date?: string | null;
  finish_date?: string | null;
  is_private?: boolean | null;
  priority?: number | null;
  note?: string | null;
  updated_at?: string | null;
};

/** The ids double as form row ids; the titles are display-only and never legal as ids. */
export const LIBRARY_STATES = [
  { id: "reading", title: "Reading" },
  { id: "rereading", title: "Rereading" },
  { id: "completed", title: "Completed" },
  { id: "paused", title: "Paused" },
  { id: "dropped", title: "Dropped" },
  { id: "plan_to_read", title: "Plan to Read" },
  { id: "considering", title: "Considering" },
] as const;

export const DEFAULT_LIBRARY_STATE = "plan_to_read";

export const LIBRARY_PRIORITIES = [
  { id: "10", title: "Low" },
  { id: "20", title: "Normal" },
  { id: "30", title: "High" },
] as const;

export const DEFAULT_PRIORITY = 20;

// From the OpenAPI schema, so a stepper cannot submit a body the API will reject.
export const MAX_PROGRESS = 10_000;
export const MAX_REREADS = 1_000;
export const MAX_RATING = 100;

// Search

/** `relevance_desc` is meaningless without a query, hence {@link BROWSE_SORT}. */
export const SORT_OPTIONS = [
  { id: "relevance_desc", label: "Relevance" },
  { id: "popularity_desc", label: "Most Popular" },
  { id: "score_desc", label: "Highest Rated" },
  { id: "trending_7d", label: "Trending (7 days)" },
  { id: "trending_30d", label: "Trending (30 days)" },
  { id: "latest", label: "Recently Updated" },
  { id: "published_start_date_desc", label: "Newest" },
  { id: "published_start_date_asc", label: "Oldest" },
  { id: "name_asc", label: "Title (A–Z)" },
  { id: "name_desc", label: "Title (Z–A)" },
  { id: "chapters_desc", label: "Most Chapters" },
  { id: "random", label: "Random" },
] as const;

export const DEFAULT_SORT = "relevance_desc";
export const BROWSE_SORT = "popularity_desc";

/** The API caps `limit`; 30 stays under it. */
export const SEARCH_PAGE_SIZE = 30;

export const SERIES_TYPE_FILTERS = [
  { id: "manga", title: "Manga" },
  { id: "novel", title: "Novel" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "oel", title: "OEL" },
  { id: "other", title: "Other" },
] as const;

export const SERIES_STATUS_FILTERS = [
  { id: "releasing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "cancelled", title: "Cancelled" },
  { id: "upcoming", title: "Upcoming" },
  { id: "unknown", title: "Unknown" },
] as const;

export const CONTENT_RATING_FILTERS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
] as const;
