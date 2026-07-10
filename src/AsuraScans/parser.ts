/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
  type TagSection,
} from "@paperback/types";

import {
  findIsland,
  htmlToPlainText,
  readArray,
  readBoolean,
  readNumber,
  readString,
} from "./astro";
import { ASURA_DOMAIN, statusLabel } from "./models";

const SERIES_DETAILS_KEYS = ["title", "alternativeTitles", "seriesId"];
const SERIES_CHAPTERS_KEYS = ["chapters", "publicUrl"];
const CHAPTER_KEYS = ["pages", "chapterId"];

export function seriesUrl(mangaId: string): string {
  return `${ASURA_DOMAIN}/comics/${mangaId}`;
}

export function chapterUrl(chapter: Chapter): string {
  const publicUrl = chapter.additionalInfo?.publicUrl;
  const base = publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(chapter.sourceManga.mangaId);
  return `${base}/chapter/${chapter.chapterId}`;
}

export function parseSeriesDetails(html: string, mangaId: string): SourceManga {
  const details = findIsland(html, SERIES_DETAILS_KEYS);
  const chapters = findIsland(html, SERIES_CHAPTERS_KEYS);

  const alternativeTitles = readString(details, "alternativeTitles");
  const secondaryTitles = alternativeTitles
    ? alternativeTitles
        .split("•")
        .map((title) => title.trim())
        .filter((title) => title.length > 0)
    : [];

  const genres: Tag[] = readArray(details, "genres").flatMap((genre) => {
    const id = readString(genre, "slug");
    const title = readString(genre, "name");
    return id && title ? [{ id, title }] : [];
  });

  const tagGroups: TagSection[] =
    genres.length > 0 ? [{ id: "genres", title: "Genres", tags: genres }] : [];

  const thumbnailUrl = readString(details, "coverUrl") ?? "";
  const description = readString(details, "description");
  const publicUrl = readString(chapters, "publicUrl");

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: description ? htmlToPlainText(description) : "No synopsis.",
      primaryTitle: readString(details, "title") ?? "Unknown Title",
      secondaryTitles,
      contentRating: ContentRating.MATURE,
      status: statusLabel(readString(details, "status")),
      author: readString(details, "author"),
      artist: readString(details, "artist"),
      rating: readNumber(details, "rating"),
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(mangaId),
    },
  };
}

export function parseChapterList(html: string, sourceManga: SourceManga): Chapter[] {
  const island = findIsland(html, SERIES_CHAPTERS_KEYS);
  const publicUrl = readString(island, "publicUrl");
  const chapters: Chapter[] = [];

  for (const entry of readArray(island, "chapters")) {
    const chapNum = readNumber(entry, "number");
    if (chapNum === undefined) continue;

    const additionalInfo: Record<string, string> = {};
    if (publicUrl) additionalInfo.publicUrl = publicUrl;

    const publishedAt = readString(entry, "published_at");
    const publishDate = publishedAt ? new Date(publishedAt) : undefined;

    chapters.push({
      chapterId: String(chapNum),
      sourceManga,
      langCode: "en",
      chapNum,
      title: readString(entry, "title"),
      publishDate: publishDate && !Number.isNaN(publishDate.getTime()) ? publishDate : undefined,
      additionalInfo,
    });
  }

  return chapters;
}

function unlockedAt(unlockTime: string | undefined): string | undefined {
  if (!unlockTime) return undefined;
  const date = new Date(unlockTime);
  return Number.isNaN(date.getTime()) ? undefined : date.toLocaleString();
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const island = findIsland(html, CHAPTER_KEYS);

  if (readBoolean(island, "isLocked") || readBoolean(island, "isPremium")) {
    const releasesAt = unlockedAt(readString(island, "unlockTime"));
    throw new Error(
      releasesAt
        ? `Chapter ${chapter.chapNum} is in early access until ${releasesAt}. It will be readable once it is public for all users.`
        : `Chapter ${chapter.chapNum} is in early access. It will be readable once it is public for all users.`,
    );
  }

  const pages = readArray(island, "pages").flatMap((page) => {
    const url = readString(page, "url");
    return url ? [url] : [];
  });

  if (pages.length === 0) {
    throw new Error(`Asura Scans served no pages for chapter ${chapter.chapNum}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    pages,
  };
}
