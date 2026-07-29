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
import {
  DEFAULT_SORT,
  NOVEL_SORT_MAP,
  SORT_OPTIONS,
  type AsuraScansSearchMetadata,
  type SortOption,
} from "./models";
import {
  MainInterceptor,
  fetchChapterJson,
  fetchNovelChapterJson,
  fetchNovelSearch,
  fetchPage,
} from "./network";
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
  isNovelMangaId,
  mergeRankedResults,
  novelCatalogEntry,
  novelCatalogUrl,
  novelChapterIsLocked,
  novelChapterUrl,
  novelSearchUrl,
  novelSlugFromMangaId,
  novelToSourceManga,
  novelUrl,
  parseChapterApiPayload,
  parseChapterDetails,
  parseChapterList,
  parseDiscoverItems,
  parseNovelCatalog,
  parseNovelChapterApiPayload,
  parseNovelChapterDetails,
  parseNovelChapterList,
  parseNovelSearchResults,
  parseSeriesDetails,
  rankedNovelSearchResults,
  rankedSearchResults,
  seriesUrl,
  statusItems,
} from "./parser";
import type AsuraScansConfig from "./pbconfig";
import { AsuraScansSettingsForm } from "./settingsForm";

// Comfortably above the current ~7-title novel catalog: on a mixed search's first page this
// fetches effectively everything; as a dedicated type=novel page size it's just a normal,
// generous page. Revisit if the novel count approaches it.
const NOVEL_SEARCH_LIMIT = 50;

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
        title: "Type",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    // Status and Type chips are compiled in; Recently Added merges a comics browse query with the
    // novel search API's own newest sort; the rest are rendered into the homepage
    switch (section.id) {
      case DISCOVER_STATUS:
        return { items: statusItems() };
      case DISCOVER_COMIC_TYPE:
        return { items: comicTypeItems() };
      case DISCOVER_RECENTLY_ADDED: {
        const comicsHtml = (await fetchPage(browseUrl({ sort: "newest" }))).html;
        const { ranked: comicsRanked } = rankedSearchResults(comicsHtml);

        const novelPayload = await fetchNovelSearch(
          novelSearchUrl({
            sort: NOVEL_SORT_MAP.newest,
            direction: "desc",
            limit: NOVEL_SEARCH_LIMIT,
          }),
        );
        const { ranked: novelsRanked } = rankedNovelSearchResults(novelPayload);

        const merged = mergeRankedResults(novelsRanked, comicsRanked, "newest", "desc");
        return {
          items: merged.map((item) => ({
            type: "simpleCarouselItem" as const,
            mangaId: item.mangaId,
            title: item.title,
            subtitle: item.subtitle,
            imageUrl: item.imageUrl,
            contentRating: item.contentRating,
          })),
        };
      }
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

    // type=novel is a dead end on comics' own /browse (confirmed), so it gets its own fully
    // paginated branch; `metadata` is reinterpreted as an offset here rather than a page number —
    // safe because `type` cannot change mid-pagination for a given search session
    if (filters?.type === "novel") {
      return this.searchNovels(query.title, filters, sort, metadata ?? 0);
    }

    const comicsPage = metadata ?? 1;
    const comicsHtml = (
      await fetchPage(
        browseUrl({
          search: query.title,
          page: comicsPage,
          sort: sort.sort,
          direction: sort.direction,
          genres: filters?.genres,
          status: filters?.status,
          type: filters?.type,
          minChapters: filters?.minChapters,
          author: filters?.author,
          artist: filters?.artist,
        }),
      )
    ).html;

    const { ranked: comicsRanked, currentPage, totalPages } = rankedSearchResults(comicsHtml);
    const nextPage = currentPage < totalPages ? currentPage + 1 : undefined;

    // The novel catalog is small enough to fetch whole and merge-sort in once, on a mixed
    // (type unset or "all") search's first page only; a specific comic type keeps today's
    // comics-only behavior, and later pages are comics-only since the whole novel catalog was
    // already merged in on page 1
    if (comicsPage === 1 && (!filters?.type || filters.type === "all")) {
      const novelPayload = await fetchNovelSearch(
        novelSearchUrl({
          search: query.title,
          genres: filters?.genres,
          status: filters?.status,
          author: filters?.author,
          artist: filters?.artist,
          minChapters: filters?.minChapters,
          sort: NOVEL_SORT_MAP[sort.sort] ?? sort.sort,
          direction: sort.direction,
          limit: NOVEL_SEARCH_LIMIT,
        }),
      );
      const { ranked: novelsRanked } = rankedNovelSearchResults(novelPayload);
      const items = mergeRankedResults(novelsRanked, comicsRanked, sort.sort, sort.direction);
      return nextPage !== undefined ? { items, metadata: nextPage } : { items };
    }

    const comicsItems = comicsRanked.map((entry) => entry.item);
    return nextPage !== undefined
      ? { items: comicsItems, metadata: nextPage }
      : { items: comicsItems };
  }

  private async searchNovels(
    title: string,
    filters: AsuraScansSearchMetadata | undefined,
    sort: SortOption,
    offset: number,
  ): Promise<PagedResults<SearchResultItem>> {
    const payload = await fetchNovelSearch(
      novelSearchUrl({
        search: title,
        genres: filters?.genres,
        status: filters?.status,
        author: filters?.author,
        artist: filters?.artist,
        minChapters: filters?.minChapters,
        sort: NOVEL_SORT_MAP[sort.sort] ?? sort.sort,
        direction: sort.direction,
        limit: NOVEL_SEARCH_LIMIT,
        offset,
      }),
    );

    const { items, total } = parseNovelSearchResults(payload);
    const nextOffset = offset + items.length;
    return nextOffset < total ? { items, metadata: nextOffset } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    if (isNovelMangaId(mangaId)) {
      const slug = novelSlugFromMangaId(mangaId);
      const catalog = parseNovelCatalog((await fetchPage(novelCatalogUrl())).html);
      const novel = novelCatalogEntry(catalog, slug);
      if (novel) return novelToSourceManga(novel);
      throw new Error(`Asura Scans no longer lists the novel ${slug}`);
    }

    const page = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(page.html, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // Asura embeds every chapter in the series/novel page, so the whole list gets returned
    void sinceDate;

    if (sourceManga.mangaInfo.contentType === "novel") {
      const page = await fetchPage(novelUrl(sourceManga.mangaId));
      return parseNovelChapterList(page.html, sourceManga);
    }

    const page = await fetchPage(seriesUrl(sourceManga.mangaId));
    return parseChapterList(page.html, sourceManga);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapter.sourceManga.mangaInfo.contentType === "novel") {
      const page = await fetchPage(novelChapterUrl(chapter));

      if (novelChapterIsLocked(page.html) && getSession()) {
        try {
          const slug = novelSlugFromMangaId(chapter.sourceManga.mangaId);
          const json = await fetchNovelChapterJson(slug, chapter.chapterId);
          if (json !== undefined) return parseNovelChapterApiPayload(json, chapter);
        } catch {
          // Falls through to the anonymous shard-cost error below on any failure here
        }
      }

      return parseNovelChapterDetails(page.html, chapter);
    }

    const page = await fetchPage(chapterUrl(chapter));

    if (chapterIsLocked(page.html) && getSession()) {
      try {
        const json = await fetchChapterJson(chapter.sourceManga.mangaId, chapter.chapterId);
        if (json !== undefined) return parseChapterApiPayload(json, chapter);
      } catch {
        // Falls through to the anonymous early-access error below on any failure here
      }
    }

    return parseChapterDetails(page.html, chapter);
  }

  async getSettingsForm(): Promise<Form> {
    return new AsuraScansSettingsForm();
  }
}

export const AsuraScans = new AsuraScansExtension();
