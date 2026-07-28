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
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { getSession } from "./auth";
import { AsuraScansAdvancedSearchForm } from "./forms";
import { DEFAULT_SORT, SORT_OPTIONS, type AsuraScansSearchMetadata } from "./models";
import { MainInterceptor, fetchChapterJson, fetchPage } from "./network";
import {
  DISCOVER_FEATURED,
  DISCOVER_LATEST_UPDATES,
  DISCOVER_COMIC_TYPE,
  DISCOVER_RECENTLY_ADDED,
  DISCOVER_STATUS,
  DISCOVER_TRENDING,
  browseUrl,
  chapterIsLocked,
  chapterUrl,
  comicTypeItems,
  homeUrl,
  parseBrowseCarousel,
  parseChapterApiPayload,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverItems,
  parseSearchResults,
  parseSeriesDetails,
  seriesUrl,
  statusItems,
} from "./parser";
import type AsuraScansConfig from "./pbconfig";
import { AsuraScansSettingsForm } from "./settingsForm";

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
        type: DiscoverSectionType.chapterUpdates,
      },
      {
        id: DISCOVER_TRENDING,
        title: "Trending",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_RECENTLY_ADDED,
        title: "Recently Added",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_STATUS,
        title: "Status",
        type: DiscoverSectionType.genres,
      },
      {
        id: DISCOVER_COMIC_TYPE,
        title: "Comic Type",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    // Status and Media chips are compiled in; Recently Added is a browse query; the rest are homepage
    switch (section.id) {
      case DISCOVER_STATUS:
        return { items: statusItems() };
      case DISCOVER_COMIC_TYPE:
        return { items: comicTypeItems() };
      case DISCOVER_RECENTLY_ADDED:
        return {
          items: parseBrowseCarousel((await fetchPage(browseUrl({ sort: "newest" }))).html),
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

    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
  }

  async getSearchResults(
    query: SearchQuery<AsuraScansSearchMetadata>,
    metadata?: number,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters = query.metadata;
    const sort = SORT_OPTIONS.find((option) => option.id === sortingOption?.id) ?? DEFAULT_SORT;

    const page = await fetchPage(
      browseUrl({
        search: query.title,
        page: metadata ?? 1,
        sort: sort.sort,
        direction: sort.direction,
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

    // The chapter page is a shared Cloudflare edge cache and never reflects a logged-in session
    // (see network.ts); a subscriber's session unlocks through a separate, uncached JSON endpoint
    if (chapterIsLocked(page.html) && getSession()) {
      try {
        const json = await fetchChapterJson(chapter.sourceManga.mangaId, chapter.chapterId);
        if (json !== undefined) return parseChapterApiPayload(json, chapter);
      } catch {
        // Any failure here — network error, an expired refresh token, or still locked for this
        // user — falls through to the familiar anonymous early-access error below
      }
    }

    return parseChapterDetails(page.html, chapter);
  }

  async getSettingsForm(): Promise<Form> {
    return new AsuraScansSettingsForm();
  }
}

export const AsuraScans = new AsuraScansExtension();
