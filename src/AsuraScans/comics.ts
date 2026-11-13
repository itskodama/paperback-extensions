/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** A comic's details, chapter list and page images, from the JSON API. */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SourceManga,
  type Tag,
} from "@paperback/types";

import {
  htmlToPlainText,
  readArray,
  readBoolean,
  readNumber,
  readString,
  type Island,
} from "./astro.ts";
import { alternativeTitles, isEarlyAccess, ratingFraction } from "./fields.ts";
import { ASURA_DOMAIN, statusLabel } from "./models.ts";
import { seriesUrl } from "./urls.ts";

export function parseSeriesApiDetails(payload: unknown, mangaId: string): SourceManga {
  const envelope = (payload ?? {}) as Island;
  const series = (envelope.series ?? envelope.data ?? envelope) as Island;

  const title = readString(series, "title");
  if (!title) throw new Error(`Asura Scans' API returned no series for ${mangaId}`);

  const genres: Tag[] = readArray(series, "genres").flatMap((genre) => {
    const id = readString(genre, "slug");
    const name = readString(genre, "name");
    return id && name ? [{ id, title: name }] : [];
  });

  const thumbnailUrl = readString(series, "cover_url") ?? readString(series, "cover") ?? "";
  const description = readString(series, "description");
  const publicUrl = readString(series, "public_url");

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: description ? htmlToPlainText(description) : "No synopsis.",
      primaryTitle: title,
      secondaryTitles: alternativeTitles(series, "alt_titles"),
      contentRating: ContentRating.MATURE,
      status: statusLabel(readString(series, "status")),
      // "_" is the API's placeholder for an unknown creator
      author: knownCreator(readString(series, "author")),
      artist: knownCreator(readString(series, "artist")),
      rating: ratingFraction(series, "rating"),
      tagGroups: genres.length > 0 ? [{ id: "genres", title: "Genres", tags: genres }] : [],
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: publicUrl ? `${ASURA_DOMAIN}${publicUrl}` : seriesUrl(mangaId),
    },
  };
}

function knownCreator(name: string | undefined): string | undefined {
  return name && name !== "_" ? name : undefined;
}

export function parseChapterApiList(
  payload: unknown,
  sourceManga: SourceManga,
  hideEarlyAccess = false,
): Chapter[] {
  const envelope = (payload ?? {}) as Island;
  const entries = Array.isArray(payload) ? (payload as Island[]) : readArray(envelope, "data");
  if (entries.length === 0) {
    throw new Error(`Asura Scans' API returned no chapters for ${sourceManga.mangaId}`);
  }
  const chapters: Chapter[] = [];

  for (const entry of entries) {
    const chapNum = readNumber(entry, "number");
    if (chapNum === undefined) continue;
    if (hideEarlyAccess && isEarlyAccess(entry)) continue;

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

// Tile-scrambled pages need a canvas pass this extension does not have yet
export function hasScrambledPages(payload: unknown): boolean {
  const chapterObj = ((payload ?? {}) as Island).chapter as Island | undefined;
  return readArray(chapterObj ?? {}, "pages").some(
    (page) => Array.isArray(page.tiles) && page.tiles.length > 0,
  );
}

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
