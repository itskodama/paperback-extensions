/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { NovelArchiveSearchForm, type NovelArchiveSearchMetadata } from "./forms";
import { ApiError, MainInterceptor, apiRequest, buildQuery } from "./network";
import {
  chaptersFromDetail,
  chaptersFromSource,
  genreChipItems,
  toChapterDetails,
  toChapterDetailsFromSource,
  toDiscoverItem,
  toSearchResultItem,
  toSourceManga,
  type ChapterJson,
  type NovelDetailResponse,
  type NovelJson,
  type NovelsListResponse,
  type SourceChapterDetailResponse,
  type SourceChapterListResponse,
  type SourceListResponse,
} from "./parser";
import type NovelArchiveConfig from "./pbconfig";

const DISCOVER_TRENDING = "trending";
const DISCOVER_EDITORS_CHOICE = "editors-choice";
const DISCOVER_RECENTLY_UPDATED = "recently-updated";
const DISCOVER_GENRES = "genres";

const DISCOVER_PAGE_SIZE = 30;
const SEARCH_PAGE_SIZE = 24;

const SORT_OPTIONS: SortingOption[] = [
  { id: "recent", label: "Recent" },
  { id: "popular", label: "Popular" },
  { id: "rating", label: "Top Rated" },
  { id: "chapters", label: "Chapter Count" },
];

// getMangaDetails and getChapters both need the same payload (chapter_names is
// already the complete chapter list), and apiRequest's own cache+dedupe means the
// two callers within a session share one network round trip
async function getNovelDetail(mangaId: string): Promise<NovelJson> {
  const response = await apiRequest<NovelDetailResponse>(`/novels/${encodeURIComponent(mangaId)}`);
  return response.novel;
}

export class NovelArchiveExtension implements ExtensionImpl<typeof NovelArchiveConfig> {
  // The API advertises 900 requests / 300s (3 req/s) in its own rate-limit headers;
  // this budget stays well under that, matching LNORI's number
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 20,
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
      { id: DISCOVER_TRENDING, title: "Trending", type: DiscoverSectionType.simpleCarousel },
      {
        id: DISCOVER_EDITORS_CHOICE,
        title: "Editor's Choice",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_RECENTLY_UPDATED,
        title: "Recently Updated",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: DISCOVER_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    if (section.id === DISCOVER_GENRES) {
      return { items: genreChipItems() };
    }

    let endpoint: string;
    switch (section.id) {
      case DISCOVER_TRENDING:
        endpoint = `/novels/trending?limit=${DISCOVER_PAGE_SIZE}`;
        break;
      case DISCOVER_EDITORS_CHOICE:
        endpoint = `/novels/editors-choice?limit=${DISCOVER_PAGE_SIZE}`;
        break;
      case DISCOVER_RECENTLY_UPDATED:
        endpoint = `/novels/recently-updated?limit=${DISCOVER_PAGE_SIZE}`;
        break;
      default:
        return { items: [] };
    }

    const response = await apiRequest<NovelsListResponse>(endpoint);
    return { items: response.novels.map(toDiscoverItem) };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<NovelArchiveSearchForm> {
    return new NovelArchiveSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<NovelArchiveSearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = typeof metadata === "number" ? metadata : 1;
    const filters = query.metadata;

    const query_ = buildQuery({
      search: query.title || undefined,
      fuzzy: query.title ? "1" : undefined,
      genres_include: filters?.genresInclude?.length ? filters.genresInclude.join(",") : undefined,
      genres_exclude: filters?.genresExclude?.length ? filters.genresExclude.join(",") : undefined,
      genre_match: filters?.genreMatch === "any" ? "any" : undefined,
      status: filters?.status && filters.status !== "all" ? filters.status : undefined,
      sort: sortingOption && sortingOption.id !== "recent" ? sortingOption.id : undefined,
      page: String(page),
      per_page: String(SEARCH_PAGE_SIZE),
    });

    const response = await apiRequest<NovelsListResponse>(`/novels${query_}`);
    const items = response.novels.map(toSearchResultItem);

    return response.pagination?.has_next ? { items, metadata: page + 1 } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const detail = await getNovelDetail(mangaId);
    return toSourceManga(detail, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    void sinceDate;
    const mangaId = sourceManga.mangaId;

    // A novel with real alternate sources gets each one exposed as its own
    // Paperback "version" (Manage Version Priority — enable "Chapters Unique
    // by Volume" is NOT what this needs; each source already has its own
    // clean, non-colliding chapNum range from the API's own per-chapter
    // `number` field, no consensus-guessing required). Only novels with no
    // source data at all fall back to the merged endpoint's heuristics.
    const sourcesResponse = await apiRequest<SourceListResponse>(
      `/novels/${encodeURIComponent(mangaId)}/sources`,
    );

    if (sourcesResponse.sources.length === 0) {
      const detail = await getNovelDetail(mangaId);
      return chaptersFromDetail(detail, sourceManga);
    }

    const perSource = await Promise.all(
      sourcesResponse.sources.map(async (source) => {
        const list = await apiRequest<SourceChapterListResponse>(
          `/novels/${encodeURIComponent(mangaId)}/sources/${encodeURIComponent(source.id)}/chapters`,
        );
        return chaptersFromSource(source, list, sourceManga);
      }),
    );
    return perSource.flat();
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const mangaId = chapter.sourceManga.mangaId;

    if (chapter.version) {
      // Per-source chapter — chapterId is "<sourceId>:<number>"
      const separator = chapter.chapterId.indexOf(":");
      const sourceId = chapter.chapterId.slice(0, separator);
      const number = chapter.chapterId.slice(separator + 1);
      const path = `/novels/${encodeURIComponent(mangaId)}/sources/${encodeURIComponent(sourceId)}/chapters/${encodeURIComponent(number)}`;
      const response = await apiRequest<SourceChapterDetailResponse>(path);
      return toChapterDetailsFromSource(response, chapter);
    }

    const chapterPath = (id: string) =>
      `/novels/${encodeURIComponent(mangaId)}/chapters/${encodeURIComponent(id)}`;

    try {
      const response = await apiRequest<ChapterJson>(chapterPath(chapter.chapterId));
      return toChapterDetails(response, chapter);
    } catch (error) {
      // Position-based chapterId is reliable for every novel sampled except
      // ones with a gap at the start (see parser.ts) — only retry when this
      // specific id doesn't exist and a novel-wide offset was detected; never
      // retry on any other error, and never try the offset-adjusted id first
      // (verified: for some novels that silently returns a *different*
      // chapter's content rather than 404ing)
      const offset = chapter.additionalInfo?.offset;
      if (error instanceof ApiError && error.status === 404 && offset) {
        const fallbackId = String(Number(chapter.chapterId) + Number(offset));
        const response = await apiRequest<ChapterJson>(chapterPath(fallbackId));
        return toChapterDetails(response, chapter);
      }
      throw error;
    }
  }
}

export const NovelArchive = new NovelArchiveExtension();
