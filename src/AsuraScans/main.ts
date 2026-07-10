/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

// Extension forms file
import { AsuraScansAdvancedSearchForm } from "./forms";
import { SORT_FIELDS, type AsuraScansSearchMetadata } from "./models";
// Extension network file
import { MainInterceptor, fetchPage } from "./network";
import {
  DISCOVER_LATEST_UPDATES,
  DISCOVER_POPULAR,
  DISCOVER_TRENDING,
  browseUrl,
  chapterUrl,
  homeUrl,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverItems,
  parseSearchResults,
  parseSeriesDetails,
  seriesUrl,
} from "./parser";
import type AsuraScansConfig from "./pbconfig";

// Main extension class
export class AsuraScansExtension implements ExtensionImpl<typeof AsuraScansConfig> {
  // Implementation of the main rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 15,
    bufferInterval: 10,
    ignoreImages: true,
  });

  // Implementation of the main interceptor
  mainInterceptor = new MainInterceptor("main");

  // Method from the Extension interface which we implement, initializes the rate limiter, interceptor, discover sections and search filters
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: DISCOVER_TRENDING,
        title: "Trending",
        type: DiscoverSectionType.featured,
      },
      {
        id: DISCOVER_LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: DISCOVER_POPULAR,
        title: "Popular",
        type: DiscoverSectionType.simpleCarousel,
      },
    ];
  }

  // Populates the discover sections, all of which come from the homepage
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    // Asura renders every section into the homepage, so there is nothing to page through
    void metadata;

    const page = await fetchPage(homeUrl());
    return { items: parseDiscoverItems(page.html, section.id) };
  }

  // Populates search filters in a form
  async getAdvancedSearchForm(
    query: SearchQuery<AsuraScansSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new AsuraScansAdvancedSearchForm(query);
  }

  // Populates the sort field picker shown alongside search
  async getSortingOptions(query: SearchQuery<AsuraScansSearchMetadata>): Promise<SortingOption[]> {
    void query;

    return SORT_FIELDS;
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery<AsuraScansSearchMetadata>,
    metadata?: number,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters = query.metadata;

    const page = await fetchPage(
      browseUrl({
        search: query.title,
        page: metadata ?? 1,
        sort: sortingOption?.id,
        direction: filters?.direction,
        genres: filters?.genres,
        status: filters?.status,
        type: filters?.type,
        minChapters: filters?.minChapters,
        author: filters?.author,
        artist: filters?.artist,
      }),
    );

    return parseSearchResults(page.html);
  }

  // Populates the title details
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const page = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(page.html, mangaId);
  }

  // Populates the chapter list
  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // Asura embeds every chapter in the series page, so the whole list gets returned
    void sinceDate;

    const page = await fetchPage(seriesUrl(sourceManga.mangaId));
    return parseChapterList(page.html, sourceManga);
  }

  // Populates a chapter with images
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const page = await fetchPage(chapterUrl(chapter));
    return parseChapterDetails(page.html, chapter);
  }
}

export const AsuraScans = new AsuraScansExtension();
