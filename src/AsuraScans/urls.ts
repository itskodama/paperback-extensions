/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Building asurascans.com URLs. Novel ids carry a `novel:` prefix; see isNovelMangaId. */

import { type Chapter } from "@paperback/types";

import { ASURA_API, ASURA_DOMAIN } from "./models.ts";

export function homeUrl(): string {
  return `${ASURA_DOMAIN}/`;
}

export type BrowseQuery = {
  search?: string;
  page?: number;
  sort?: string;
  direction?: string;
  genres?: string[];
  status?: string;
  type?: string;
  minChapters?: number;
  author?: string;
  artist?: string;
};

export function seriesUrl(mangaId: string): string {
  return `${ASURA_DOMAIN}/comics/${mangaId}`;
}

export function browseUrl(query: BrowseQuery): string {
  const params: string[] = [];
  const append = (key: string, value: string) => {
    params.push(`${key}=${encodeURIComponent(value)}`);
  };

  if (query.search) append("search", query.search);
  if (query.genres && query.genres.length > 0) append("genres", query.genres.join(","));
  if (query.status && query.status !== "all") append("status", query.status);
  if (query.type && query.type !== "all") append("type", query.type);
  // Asura's `sort` selects the field and `order` selects the direction
  if (query.sort) append("sort", query.sort);
  if (query.direction) append("order", query.direction);
  if (query.minChapters !== undefined && query.minChapters > 0) {
    append("min_chapters", String(query.minChapters));
  }
  if (query.author) append("author", query.author);
  if (query.artist) append("artist", query.artist);
  if (query.page !== undefined && query.page > 1) append("page", String(query.page));

  return params.length > 0
    ? `${ASURA_DOMAIN}/browse?${params.join("&")}`
    : `${ASURA_DOMAIN}/browse`;
}

export function chapterUrl(chapter: Chapter): string {
  const publicUrl = chapter.additionalInfo?.publicUrl;
  const base = publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(chapter.sourceManga.mangaId);
  return `${base}/chapter/${chapter.chapterId}`;
}

// A novel and a comic can share the same slug (the comics route resolves any slug, see above), so
// novel mangaIds get their own namespace — otherwise a manga viewed once as one type stays stuck
// as that type in the app's own per-manga cache forever, since the cache key would be identical
export const NOVEL_ID_PREFIX = "novel:";

export function isNovelMangaId(mangaId: string): boolean {
  return mangaId.startsWith(NOVEL_ID_PREFIX);
}

export function novelSlugFromMangaId(mangaId: string): string {
  return isNovelMangaId(mangaId) ? mangaId.slice(NOVEL_ID_PREFIX.length) : mangaId;
}

export function novelCatalogUrl(): string {
  return `${ASURA_DOMAIN}/novels`;
}

export function novelUrl(mangaId: string): string {
  return `${ASURA_DOMAIN}/novels/${novelSlugFromMangaId(mangaId)}`;
}

export function novelChapterUrl(chapter: Chapter): string {
  return `${novelUrl(chapter.sourceManga.mangaId)}/chapter/${chapter.chapterId}`;
}

export type NovelSearchQuery = {
  search?: string;
  genres?: string[];
  status?: string;
  author?: string;
  artist?: string;
  minChapters?: number;
  sort?: string;
  direction?: string;
  limit?: number;
  offset?: number;
};

export function novelSearchUrl(query: NovelSearchQuery): string {
  const params: string[] = [];
  const append = (key: string, value: string) => {
    params.push(`${key}=${encodeURIComponent(value)}`);
  };

  if (query.search) append("search", query.search);
  if (query.genres && query.genres.length > 0) append("genres", query.genres.join(","));
  if (query.status && query.status !== "all") append("status", query.status);
  if (query.author) append("author", query.author);
  if (query.artist) append("artist", query.artist);
  if (query.minChapters !== undefined && query.minChapters > 0) {
    append("min_chapters", String(query.minChapters));
  }
  if (query.sort) append("sort", query.sort);
  if (query.direction) append("order", query.direction);
  if (query.limit !== undefined) append("limit", String(query.limit));
  if (query.offset !== undefined && query.offset > 0) append("offset", String(query.offset));

  return `${ASURA_API}/api/novel-series${params.length > 0 ? `?${params.join("&")}` : ""}`;
}
