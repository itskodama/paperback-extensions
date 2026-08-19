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

// `safe` is the site's own lowest rating; everything above it is lumped together
// rather than mapped one-to-one, because the app only has three levels.
export const SAFE_CONTENT_RATING = "safe";

export const SORT_OPTIONS = [
  { id: "relevance:desc", title: "Relevance" },
  { id: "chapter_updated_at:desc", title: "Latest Chapter" },
  { id: "created_at:desc", title: "Recently Added" },
  { id: "follows:desc", title: "Most Followed" },
  { id: "rating:desc", title: "Top Rated" },
  { id: "views:desc", title: "Most Viewed" },
] as const;

export const DEFAULT_SORT = SORT_OPTIONS[0].id;
