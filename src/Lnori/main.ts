/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  BasicRateLimiter,
  type Chapter,
  type ChapterDetails,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { MainInterceptor, fetchPage } from "./network";
import {
  bookUrl,
  libraryUrl,
  parseChapterDetails,
  parseChapterList,
  parseLibrary,
  parseSeriesDetails,
  searchLibrary,
  seriesUrl,
  toSearchResultItem,
  type LibraryEntry,
} from "./parser";
import type LnoriConfig from "./pbconfig";

const PAGE_SIZE = 50;

// The catalog page is ~1.8 MB for ~900 series and is CDN-cached for weeks, so one
// parsed copy serves every search of a session
const LIBRARY_TTL = 3_600_000;

type CachedLibrary = {
  fetchedAt: number;
  entries: LibraryEntry[];
};

let libraryCache: CachedLibrary | undefined;

async function getLibrary(): Promise<LibraryEntry[]> {
  if (libraryCache && Date.now() - libraryCache.fetchedAt <= LIBRARY_TTL) {
    return libraryCache.entries;
  }

  const entries = parseLibrary(await fetchPage(libraryUrl()));
  libraryCache = { fetchedAt: Date.now(), entries };
  return entries;
}

export class LnoriExtension implements ExtensionImpl<typeof LnoriConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 10,
    bufferInterval: 10,
    ignoreImages: true,
  });

  mainInterceptor = new MainInterceptor("main");

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    void sortingOption;

    const matches = searchLibrary(await getLibrary(), query.title);

    const start = typeof metadata === "number" ? metadata : 0;
    const items = matches.slice(start, start + PAGE_SIZE).map(toSearchResultItem);
    const next = start + PAGE_SIZE;

    return next < matches.length ? { items, metadata: next } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // The series page lists every volume, so the whole list gets returned
    void sinceDate;

    const html = await fetchPage(seriesUrl(sourceManga.mangaId));
    return parseChapterList(html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchPage(bookUrl(chapter.chapterId));
    return parseChapterDetails(html, chapter);
  }
}

export const Lnori = new LnoriExtension();
