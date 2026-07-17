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

import { LightNovelWorldSearchForm } from "./forms";
import { MainInterceptor, fetchJson, fetchPage } from "./network";
import {
  CHAPTER_LIST_PAGE_SIZE,
  advancedSearchUrl,
  chapterCardToChapter,
  chapterListUrl,
  chapterUrl,
  genreChipItems,
  hasNextAdvancedSearchPage,
  homeUrl,
  novelUrl,
  parseAdvancedSearchResults,
  parseBoostShelfCards,
  parseChapterCards,
  parseChapterContent,
  parseChapterListTotal,
  parseNovelDetails,
  parseRankingCards,
  parseUpdateCards,
  rankingUrl,
  recommendationsUrl,
  searchUrl,
  toAdvancedSearchResultItem,
  toFeaturedItem,
  toLatestNovelItem,
  toRankingItem,
  toSearchResultItem,
  toTrendingItem,
  toUpdateItem,
  updatesUrl,
  type LightNovelWorldSearchMetadata,
  type SearchApiResponse,
} from "./parser";
import type LightNovelWorldConfig from "./pbconfig";

const DISCOVER_RECOMMENDED = "recommended";
const DISCOVER_TRENDING = "trending";
const DISCOVER_POPULAR = "popular";
const DISCOVER_LATEST_NOVELS = "latest-novels";
const DISCOVER_LATEST_UPDATES = "latest";
const DISCOVER_GENRES = "genres";

const SORT_OPTIONS: SortingOption[] = [
  { id: "rank", label: "Relevance" },
  { id: "views", label: "Most Viewed" },
  { id: "bookmarks", label: "Most Bookmarked" },
  { id: "updates", label: "Recently Updated" },
  { id: "new", label: "Newest" },
];

// The chapter-list page's own total (from the "Go to Chapter" input's max
// attribute) lets every remaining page be fetched concurrently in one shot; a
// markup change that breaks that parse degrades to fetching sequentially until
// a short page is seen, same fallback discipline as LNORI's per-volume TOC read
async function fetchAllChapterListPages(slug: string): Promise<string[]> {
  const first = await fetchPage(chapterListUrl(slug, 1));
  const total = parseChapterListTotal(first);

  if (total !== undefined) {
    const totalPages = Math.max(1, Math.ceil(total / CHAPTER_LIST_PAGE_SIZE));
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        fetchPage(chapterListUrl(slug, index + 2)),
      ),
    );
    return [first, ...rest];
  }

  const pages = [first];
  let cards = parseChapterCards(first);
  let page = 1;
  while (cards.length === CHAPTER_LIST_PAGE_SIZE) {
    page += 1;
    const html = await fetchPage(chapterListUrl(slug, page));
    cards = parseChapterCards(html);
    if (cards.length === 0) break;
    pages.push(html);
  }
  return pages;
}

export class LightNovelWorldExtension implements ExtensionImpl<typeof LightNovelWorldConfig> {
  // Cloudflare-fronted but never challenges a plain GET (verified during recon);
  // this budget matches LNORI/NovelArchive's number for the same profile
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
      { id: DISCOVER_RECOMMENDED, title: "Recommended", type: DiscoverSectionType.featured },
      {
        id: DISCOVER_TRENDING,
        title: "Trending This Week",
        type: DiscoverSectionType.simpleCarousel,
      },
      { id: DISCOVER_POPULAR, title: "Popular", type: DiscoverSectionType.simpleCarousel },
      {
        id: DISCOVER_LATEST_NOVELS,
        title: "Latest Novels",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_LATEST_UPDATES,
        title: "Latest Updates",
        type: DiscoverSectionType.chapterUpdates,
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
    if (section.id === DISCOVER_RECOMMENDED) {
      const response = await fetchJson<SearchApiResponse>(recommendationsUrl());
      return { items: response.novels.map(toFeaturedItem) };
    }
    if (section.id === DISCOVER_TRENDING) {
      const html = await fetchPage(homeUrl());
      return { items: parseBoostShelfCards(html).map(toTrendingItem) };
    }
    if (section.id === DISCOVER_POPULAR) {
      const html = await fetchPage(rankingUrl());
      return { items: parseRankingCards(html).map(toRankingItem) };
    }
    if (section.id === DISCOVER_LATEST_NOVELS) {
      const html = await fetchPage(advancedSearchUrl(undefined, "new", 1));
      return { items: parseAdvancedSearchResults(html).map(toLatestNovelItem) };
    }
    if (section.id === DISCOVER_LATEST_UPDATES) {
      const html = await fetchPage(updatesUrl());
      return { items: parseUpdateCards(html).map(toUpdateItem) };
    }
    return { items: [] };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<LightNovelWorldSearchForm> {
    return new LightNovelWorldSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<LightNovelWorldSearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters = query.metadata;
    const hasFilters = !!(filters?.genresInclude?.length || filters?.genresExclude?.length);
    const title = query.title.trim();

    // The real search API has no genre/sort filtering of its own and
    // advanced-search has no free-text query param (verified during recon), so
    // a plain title search always prefers the API; filters (with or without a
    // title alongside them, which advanced-search can't honor) go through the
    // filtered HTML listing instead
    if (!hasFilters && title) {
      const response = await fetchJson<SearchApiResponse>(searchUrl(title));
      return { items: response.novels.map(toSearchResultItem) };
    }

    const page = typeof metadata === "number" ? metadata : 1;
    const html = await fetchPage(advancedSearchUrl(filters, sortingOption?.id, page));
    const cards = parseAdvancedSearchResults(html);
    const items = cards.map(toAdvancedSearchResultItem);

    return hasNextAdvancedSearchPage(cards.length) ? { items, metadata: page + 1 } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchPage(novelUrl(mangaId));
    return parseNovelDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    void sinceDate;

    const pages = await fetchAllChapterListPages(sourceManga.mangaId);
    return pages.flatMap((html) =>
      parseChapterCards(html).map((card) => chapterCardToChapter(card, sourceManga)),
    );
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchPage(chapterUrl(chapter.sourceManga.mangaId, chapter.chapterId));
    return parseChapterContent(html, chapter);
  }
}

export const LightNovelWorld = new LightNovelWorldExtension();
