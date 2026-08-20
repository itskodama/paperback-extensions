/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

export const DOMAIN = "https://comix.to";

// comix.ws is the same backend behind a second domain — verified by both serving
// identical chapter ids and hids — so it is a drop-in origin when .to is
// unreachable, not a separate catalogue. See docs/Comix/site-recon.md.
export const MIRROR_DOMAIN = "https://comix.ws";

// The site keys series by `hid` everywhere a URL is built, but a chapter payload's
// own `mangaId` is the *numeric* id. They are not interchangeable: `mangaId` in
// Paperback terms is always the hid. See docs/Comix/api-shapes.md.
export type Hid = string;

export type Poster = {
  medium?: string;
  large?: string;
};

export type Taxon = {
  id: number;
  title: string;
  slug: string;
};

export type MangaSummary = {
  id: number;
  hid: Hid;
  title: string;
  altTitles?: string[];
  type?: string;
  status?: string;
  originalLanguage?: string;
  poster?: Poster;
  latestChapter?: number;
  hasChapters?: boolean;
  contentRating?: string;
  url?: string;
  year?: number;
  chapterUpdatedAtFormatted?: string;
};

export type MangaDetail = MangaSummary & {
  synopsis?: string;
  followsTotal?: number;
  ratedAvg?: number;
  ratedCount?: number;
  startDate?: string;
  endDate?: string;
  genres?: Taxon[];
  demographics?: Taxon[];
  formats?: Taxon[];
  tags?: Taxon[];
  authors?: Taxon[];
  artists?: Taxon[];
  publishers?: Taxon[];
  firstChapterUrl?: string;
  latestChapterUrl?: string;
};

export type PageMeta = {
  total: number;
  perPage: number;
  page: number;
  lastPage: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ChapterItem = {
  id: number;
  mangaId: number;
  number: number | string;
  volume?: number;
  name?: string;
  language?: string;
  isOfficial?: boolean;
  group?: { id: number; name: string } | null;
  createdAtFormatted?: string;
  url?: string;
};

export type PageItem = {
  width?: number;
  height?: number;
  url: string;
};

export type ChapterPayload = {
  status?: string;
  result?: {
    items?: ChapterItem[];
    meta?: PageMeta;
  };
};

export type PagesPayload = {
  status?: string;
  result?: {
    pages?: {
      baseUrl?: string;
      items?: PageItem[];
    };
  };
};

/**
 * The site's four ratings onto the app's three levels. Every item in every
 * payload carries one, so the app's own content filter does the work and no
 * setting is needed — but only if adult material is labelled ADULT rather than
 * lumped in with MATURE, which would let it through a filter set to exclude it.
 */
export const CONTENT_RATING_MAP: Record<string, "EVERYONE" | "MATURE" | "ADULT"> = {
  safe: "EVERYONE",
  suggestive: "MATURE",
  erotica: "ADULT",
  pornographic: "ADULT",
};

// Every filter value below was taken from requests the site's own browse UI
// issued — see docs/Comix/api-shapes.md. Sort ids are `<field>:<direction>` and
// are split back into `order[<field>]=<direction>` when the query is built.
export const SORT_OPTIONS = [
  { id: "relevance:desc", title: "Relevance" },
  { id: "chapter_updated_at:desc", title: "Latest Chapter" },
  { id: "created_at:desc", title: "Recently Added" },
  { id: "follows_total:desc", title: "Most Follows" },
  { id: "score:desc", title: "Top Rated" },
  { id: "views_total:desc", title: "Most Viewed" },
  { id: "views_7d:desc", title: "Trending (7 days)" },
  { id: "views_30d:desc", title: "Trending (30 days)" },
  { id: "views_90d:desc", title: "Trending (90 days)" },
  { id: "title:asc", title: "Title A-Z" },
  { id: "title:desc", title: "Title Z-A" },
  { id: "year:desc", title: "Newest" },
  { id: "year:asc", title: "Oldest" },
] as const;

export const CONTENT_RATINGS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
  { id: "pornographic", title: "Pornographic" },
] as const;

export const TYPES = [
  { id: "manga", title: "Manga" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "other", title: "Other" },
] as const;

export const STATUSES = [
  { id: "releasing", title: "Releasing" },
  { id: "finished", title: "Finished" },
  { id: "on_hiatus", title: "On Hiatus" },
  { id: "discontinued", title: "Discontinued" },
  { id: "not_yet_released", title: "Not Yet Released" },
] as const;

export const DEMOGRAPHICS = [
  { id: "1", title: "Shoujo" },
  { id: "2", title: "Shounen" },
  { id: "3", title: "Josei" },
  { id: "4", title: "Seinen" },
] as const;

/** Genre ids are numeric and non-contiguous; the site groups them with formats. */
export const GENRES = [
  { id: "6", title: "Action" },
  { id: "7", title: "Adventure" },
  { id: "8", title: "Boys Love" },
  { id: "9", title: "Comedy" },
  { id: "10", title: "Crime" },
  { id: "11", title: "Drama" },
  { id: "12", title: "Fantasy" },
  { id: "13", title: "Girls Love" },
  { id: "40", title: "Harem" },
  { id: "14", title: "Historical" },
  { id: "15", title: "Horror" },
  { id: "16", title: "Isekai" },
  { id: "17", title: "Magical Girls" },
  { id: "18", title: "Mecha" },
  { id: "19", title: "Medical" },
  { id: "20", title: "Mystery" },
  { id: "21", title: "Philosophical" },
  { id: "22", title: "Psychological" },
  { id: "23", title: "Romance" },
  { id: "24", title: "Sci-Fi" },
  { id: "25", title: "Slice of Life" },
  { id: "26", title: "Sports" },
  { id: "27", title: "Superhero" },
  { id: "28", title: "Thriller" },
  { id: "29", title: "Tragedy" },
  { id: "30", title: "Wuxia" },
  { id: "87264", title: "Adult" },
  { id: "87265", title: "Ecchi" },
  { id: "87266", title: "Hentai" },
  { id: "87267", title: "Mature" },
  { id: "87268", title: "Smut" },
] as const;

export const FORMATS = [
  { id: "93164", title: "4-Koma" },
  { id: "93167", title: "Adaptation" },
  { id: "93165", title: "Anthology" },
  { id: "93166", title: "Award Winning" },
  { id: "93168", title: "Doujinshi" },
  { id: "93172", title: "Full Color" },
  { id: "93170", title: "Long Strip" },
  { id: "93169", title: "Oneshot" },
  { id: "93171", title: "Web Comic" },
] as const;

export const DEFAULT_SORT = SORT_OPTIONS[0].id;
