/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** A comic's detail page, chapter list and page images. */

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
  type Island,
} from "./astro.ts";
import { alternativeTitles, ratingFraction } from "./fields.ts";
import { ASURA_DOMAIN, statusLabel } from "./models.ts";
import { seriesUrl } from "./urls.ts";

const SERIES_DETAILS_KEYS = ["title", "alternativeTitles", "seriesId"];

const SERIES_CHAPTERS_KEYS = ["chapters", "publicUrl"];

const CHAPTER_KEYS = ["pages", "chapterId"];

export function parseSeriesDetails(html: string, mangaId: string): SourceManga {
  const details = findIsland(html, SERIES_DETAILS_KEYS);
  const chapters = findIsland(html, SERIES_CHAPTERS_KEYS);

  const secondaryTitles = alternativeTitles(details, "alternativeTitles");

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
      rating: ratingFraction(details, "rating"),
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
      // Asura has no volumes; leaving this unset makes the app label every chapter "Vol. TBA"
      volume: 0,
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

function earlyAccessError(chapter: Chapter, unlockTime: string | undefined): Error {
  const releasesAt = unlockedAt(unlockTime);
  return new Error(
    releasesAt
      ? `Chapter ${chapter.chapNum} is in early access until ${releasesAt}. It will be readable once it is public for all users.`
      : `Chapter ${chapter.chapNum} is in early access. It will be readable once it is public for all users.`,
  );
}

// Reflects only the anonymous lock state — see network.ts's fetchChapterJson for why
export function chapterIsLocked(html: string): boolean {
  const island = findIsland(html, CHAPTER_KEYS);
  return readBoolean(island, "isLocked") || readBoolean(island, "isPremium");
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const island = findIsland(html, CHAPTER_KEYS);

  if (readBoolean(island, "isLocked") || readBoolean(island, "isPremium")) {
    throw earlyAccessError(chapter, readString(island, "unlockTime"));
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

// Same page shape as the embedded island, but snake_case and not tuple-encoded
export function parseChapterApiPayload(payload: unknown, chapter: Chapter): ChapterDetails {
  const data = payload as Island;

  if (readBoolean(data, "is_locked")) {
    throw earlyAccessError(chapter, readString(data, "unlock_time"));
  }

  const chapterObj = (data.chapter ?? {}) as Island;
  const pages = readArray(chapterObj, "pages").flatMap((page) => {
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
