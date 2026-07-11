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

import { AsuraScansAdvancedSearchForm } from "./forms";
import { SORT_FIELDS, type AsuraScansSearchMetadata } from "./models";
import { MainInterceptor, fetchPage } from "./network";
import {
  DISCOVER_COMPLETED,
  DISCOVER_FEATURED,
  DISCOVER_GENRES,
  DISCOVER_LATEST_UPDATES,
  DISCOVER_POPULAR,
  DISCOVER_RECENTLY_ADDED,
  DISCOVER_TRENDING,
  browseUrl,
  chapterUrl,
  genreItems,
  homeUrl,
  parseBrowseCarousel,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverItems,
  parseSearchResults,
  parseSeriesDetails,
  seriesUrl,
} from "./parser";
import type AsuraScansConfig from "./pbconfig";

export class AsuraScansExtension implements ExtensionImpl<typeof AsuraScansConfig> {
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 15,
    bufferInterval: 10,
    ignoreImages: true,
  });

  mainInterceptor = new MainInterceptor("main");

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      {
        id: DISCOVER_FEATURED,
        title: "Featured",
        type: DiscoverSectionType.featured,
      },
      {
        id: DISCOVER_LATEST_UPDATES,
        title: "Latest Updates",
        subtitle: "The newest chapter of each series",
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: DISCOVER_TRENDING,
        title: "Trending",
        type: DiscoverSectionType.prominentCarousel,
      },
      {
        id: DISCOVER_POPULAR,
        title: "Popular",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_RECENTLY_ADDED,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_COMPLETED,
        title: "Completed & Top-Rated",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_GENRES,
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    // Genres are compiled in; the two browse-backed sections come from a query rather than the homepage
    switch (section.id) {
      case DISCOVER_GENRES:
        return { items: genreItems() };
      case DISCOVER_RECENTLY_ADDED:
        return {
          items: parseBrowseCarousel((await fetchPage(browseUrl({ sort: "newest" }))).html),
        };
      case DISCOVER_COMPLETED:
        return {
          items: parseBrowseCarousel(
            (await fetchPage(browseUrl({ status: "completed", sort: "rating" }))).html,
          ),
        };
    }

    // The remaining sections are all rendered into the homepage
    const page = await fetchPage(homeUrl());
    return { items: parseDiscoverItems(page.html, section.id) };
  }

  async getAdvancedSearchForm(
    query: SearchQuery<AsuraScansSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new AsuraScansAdvancedSearchForm(query);
  }

  async getSortingOptions(query: SearchQuery<AsuraScansSearchMetadata>): Promise<SortingOption[]> {
    void query;

    return SORT_FIELDS;
  }

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

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const page = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(page.html, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // Asura embeds every chapter in the series page, so the whole list gets returned
    void sinceDate;

    const page = await fetchPage(seriesUrl(sourceManga.mangaId));
    return parseChapterList(page.html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const page = await fetchPage(chapterUrl(chapter));
    return parseChapterDetails(page.html, chapter);
  }
}

export const AsuraScans = new AsuraScansExtension();
