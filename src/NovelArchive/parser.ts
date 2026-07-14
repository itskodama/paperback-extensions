/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

export const NOVELARCHIVE_DOMAIN = "https://novelarchive.cc";

// --- API JSON shapes ---
// The API is first-party JSON (no HTML parsing anywhere in this extension); shapes
// verified by hand against the live endpoints during recon (docs/NovelArchive/site-recon.md)

export type NovelJson = {
  id: string;
  author: string;
  chapter_names: string[];
  genres: string;
  cover_url: string;
  title: string;
  associated_names: string[];
  description: string;
  total_chapters: string;
  release_status: string;
};

export type NovelsListResponse = {
  novels: NovelJson[];
  pagination?: { has_next: boolean };
};

export type NovelDetailResponse = { novel: NovelJson };

export type ChapterJson = { chapter: { number: number; name: string; content: string } };

export type GenreEntry = { value: string; label: string };
export type GenresResponse = { genres: GenreEntry[] };

// --- Shared helpers ---

export function novelUrl(mangaId: string): string {
  return `${NOVELARCHIVE_DOMAIN}/novel?id=${encodeURIComponent(mangaId)}`;
}

function absoluteCoverUrl(coverUrl: string): string {
  return coverUrl.startsWith("http") ? coverUrl : `${NOVELARCHIVE_DOMAIN}${coverUrl}`;
}

function splitGenres(genres: string): string[] {
  return genres
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => genre.length > 0);
}

// A form row id (and, defensively, a tag id) must be alphanumeric or only
// `._-@()[]%?#+=/&:` — genre values from the API are lowercase and space-separated
// ("academy setting"), which is not row-id-safe on its own
function genreId(value: string): string {
  return value.replace(/\s+/g, "_");
}

// Sexual-content genre tags only — deliberately excludes orientation tags (yaoi,
// yuri, boys love, shounen ai, shoujo ai, lgbt+) and violence-only tags (gore,
// torture, gangs), neither of which signal explicit content on their own
const ADULT_GENRES = new Set([
  "adult",
  "erotica",
  "explicit sex",
  "sex slavery",
  "sex work",
  "prostitution",
  "bdsm",
  "rape",
  "mind break",
  "hypnosis",
  "smut",
]);

function contentRatingFor(genres: string[]): ContentRating {
  const lower = genres.map((genre) => genre.toLowerCase());
  return lower.some((genre) => ADULT_GENRES.has(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

// --- Search results / discover items ---

export function toSearchResultItem(novel: NovelJson): SearchResultItem {
  return {
    mangaId: novel.id,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteCoverUrl(novel.cover_url),
    contentRating: contentRatingFor(splitGenres(novel.genres)),
  };
}

export function toDiscoverItem(novel: NovelJson): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: novel.id,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteCoverUrl(novel.cover_url),
    contentRating: contentRatingFor(splitGenres(novel.genres)),
  };
}

// One curated chip per broad genre; the full ~200-tag vocabulary belongs in the
// search form's exhaustive multi-select, not a horizontal chip row
const DISCOVER_GENRES = [
  "Fantasy",
  "Action",
  "Romance",
  "Isekai",
  "System",
  "Cultivation",
  "Xianxia",
  "Comedy",
  "Drama",
  "Horror",
  "Mystery",
  "Sci-Fi",
  "Slice of Life",
  "Adventure",
  "Harem",
  "School",
  "Reincarnation",
  "Martial Arts",
  "Supernatural",
  "Tragedy",
];

export function genreChipItems(): DiscoverSectionItem[] {
  return DISCOVER_GENRES.map((name) => ({
    type: "genresCarouselItem",
    name,
    searchQuery: { title: "", metadata: { genresInclude: [name.toLowerCase()] } },
    contentRating: ContentRating.MATURE,
  }));
}

// --- Manga details ---

export function toSourceManga(detail: NovelJson, mangaId: string): SourceManga {
  const genres = splitGenres(detail.genres);
  const tagGroups: TagSection[] =
    genres.length > 0
      ? [
          {
            id: "genres",
            title: "Genres",
            tags: genres.map((genre) => ({ id: genreId(genre.toLowerCase()), title: genre })),
          },
        ]
      : [];

  const thumbnailUrl = absoluteCoverUrl(detail.cover_url);

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: detail.description || "No synopsis.",
      primaryTitle: detail.title,
      secondaryTitles: detail.associated_names ?? [],
      contentRating: contentRatingFor(genres),
      contentType: "novel",
      author: detail.author,
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: novelUrl(mangaId),
    },
  };
}

// --- Chapters ---
// The novel-detail response's chapter_names is already the complete, ordered
// chapter list, so getChapters needs no extra request at all

export function chaptersFromDetail(detail: NovelJson, sourceManga: SourceManga): Chapter[] {
  return detail.chapter_names.map((name, index) => {
    const chapNum = index + 1;
    const title = name.trim();
    return {
      chapterId: String(chapNum),
      sourceManga,
      langCode: "en",
      chapNum,
      volume: 0,
      title: title.length > 0 ? title : `Chapter ${chapNum}`,
    };
  });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Chapter content is plain text with paragraphs separated by one or more newlines
// (observed as a single \n on some novels, \n\n on others, depending on the
// upstream source) — split on one-or-more, never a fixed delimiter
function toXhtml(content: string): string {
  const body = content
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
    .join("");

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

export function toChapterDetails(json: ChapterJson, chapter: Chapter): ChapterDetails {
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(json.chapter.content),
  };
}

// --- Genre catalog (search form + resolving filter chip ids back to API values) ---

export type GenreOption = { id: string; label: string; value: string };

export function toGenreOptions(response: GenresResponse): GenreOption[] {
  return response.genres.map((genre) => ({
    id: genreId(genre.value),
    label: genre.label,
    value: genre.value,
  }));
}
