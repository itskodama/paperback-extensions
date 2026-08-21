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
  type UpdateManager,
} from "@paperback/types";

import { FreeWebNovelSearchForm } from "./forms.ts";
import {
  genreChipItems,
  matchesFilters,
  toChapterDetails,
  toChapterUpdateItem,
  toChapters,
  toFeaturedItem,
  toSearchResultItem,
  toSimpleCarouselItem,
  toSourceManga,
} from "./mappers.ts";
import {
  BROWSE_SECTIONS,
  CHAPTER_PAGE_SIZE,
  DEFAULT_SORT,
  DISCOVER_COMPLETED,
  DISCOVER_FEATURED,
  DISCOVER_GENRES,
  DISCOVER_LATEST,
  DISCOVER_LATEST_RELEASE,
  DISCOVER_POPULAR,
  SEARCH_PAGE_LIMIT,
  SORT_OPTIONS,
  type ChapterEntry,
  type SearchFilters,
} from "./models.ts";
import { MainInterceptor, fetchJson, fetchPage } from "./network.ts";
import {
  parseChapterList,
  parseFeatured,
  parseLatestReleases,
  parseListing,
  parseNovelDetail,
} from "./parsers.ts";
import type FreeWebNovelConfig from "./pbconfig.ts";
import {
  advancedSearchUrl,
  chapterListUrl,
  chapterUrl,
  homeUrl,
  novelUrl,
  searchUrl,
  sortUrl,
} from "./urls.ts";

export class FreeWebNovelExtension implements ExtensionImpl<typeof FreeWebNovelConfig> {
  // Matches LNORI's budget. The site answered 16 concurrent requests without
  // throttling, so this is conservative rather than measured — settle it from the
  // app's debug log, not another desktop probe. See docs/FreeWebNovel/site-recon.md.
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

  // --- Discover ---

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: DISCOVER_FEATURED, title: "Featured", type: DiscoverSectionType.featured },
      {
        id: DISCOVER_LATEST_RELEASE,
        title: "Latest Releases",
        type: DiscoverSectionType.chapterUpdates,
      },
      { id: DISCOVER_POPULAR, title: "Most Popular", type: DiscoverSectionType.simpleCarousel },
      { id: DISCOVER_LATEST, title: "Latest Novels", type: DiscoverSectionType.simpleCarousel },
      { id: DISCOVER_COMPLETED, title: "Completed", type: DiscoverSectionType.simpleCarousel },
      { id: DISCOVER_GENRES, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === DISCOVER_GENRES) return { items: genreChipItems() };

    // Featured and Latest Releases both read the homepage; the in-flight dedupe in
    // network.ts is what keeps that one request rather than two.
    if (section.id === DISCOVER_FEATURED) {
      return { items: parseFeatured(await fetchPage(homeUrl())).map(toFeaturedItem) };
    }
    if (section.id === DISCOVER_LATEST_RELEASE) {
      return { items: parseLatestReleases(await fetchPage(homeUrl())).map(toChapterUpdateItem) };
    }

    const key = BROWSE_SECTIONS[section.id];
    if (!key) return { items: [] };

    const page = typeof metadata === "number" ? metadata : 1;
    const listing = parseListing(await fetchPage(sortUrl(key, page)));
    const items = listing.rows.map(toSimpleCarouselItem);

    return page < listing.lastPage ? { items, metadata: page + 1 } : { items };
  }

  // --- Search ---

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<FreeWebNovelSearchForm> {
    return new FreeWebNovelSearchForm(query);
  }

  /**
   * The site splits search across two endpoints that cannot be combined: `/search`
   * does free text and takes no filters, `/search-adv` does filters and ignores
   * `keyword`. A title wins, because a user who typed one is looking for it.
   */
  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = typeof metadata === "number" ? metadata : 1;
    const filters = (query.metadata as SearchFilters | undefined) ?? {};
    const title = query.title.trim();

    const url = title
      ? searchUrl(title, page)
      : advancedSearchUrl(filters, sortingOption?.id ?? DEFAULT_SORT, page);

    const listing = parseListing(await fetchPage(url));
    const items = listing.rows
      .filter((row) => matchesFilters(row, filters))
      .map(toSearchResultItem);

    // Both endpoints stop at 100 results whatever the pager claims.
    const lastPage = Math.min(listing.lastPage, SEARCH_PAGE_LIMIT);
    return page < lastPage ? { items, metadata: page + 1 } : { items };
  }

  // --- Titles and chapters ---

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return toSourceManga(parseNovelDetail(await fetchPage(novelUrl(mangaId)), mangaId));
  }

  /**
   * Page 1 of the chapter list reports `totalPage`, so it is both data and the
   * count of what is left — the remaining pages then issue together. A 7,205-chapter
   * novel is 37 requests and none of them is speculative.
   */
  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const entries = await this.chapterEntries(sourceManga.mangaId);
    return toChapters(entries, sourceManga);
  }

  private async chapterEntries(mangaId: string): Promise<ChapterEntry[]> {
    const first = parseChapterList(await fetchJson(chapterListUrl(mangaId, 1)));

    const rest = await Promise.all(
      Array.from({ length: Math.max(0, first.totalPage - 1) }, async (_unused, index) =>
        parseChapterList(await fetchJson(chapterListUrl(mangaId, index + 2))),
      ),
    );

    return [first, ...rest].flatMap((page) => page.entries);
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const url = chapterUrl(chapter.sourceManga.mangaId, Number(chapter.chapterId));
    return toChapterDetails(await fetchPage(url), chapter);
  }

  /**
   * Library sweeps, without which every refresh re-walks every novel in full.
   *
   * The novel page states `data-total-chapters` outright, so one request decides
   * whether anything changed at all. When something has, only the newest list page
   * is fetched and diffed — the app never needs the other thirty-six.
   */
  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    for (const manga of updateManager.getQueuedItems()) {
      const mangaId = manga.mangaId;

      let total: number | undefined;
      try {
        total = parseNovelDetail(await fetchPage(novelUrl(mangaId)), mangaId).totalChapters;
      } catch {
        // One title's failure must not abandon the rest of the sweep.
        continue;
      }

      if (total === undefined) {
        await updateManager.setUpdatePriority(mangaId, "high");
        continue;
      }

      if (total === (await updateManager.getNumberOfChapters(mangaId))) {
        await updateManager.setUpdatePriority(mangaId, "skip");
        continue;
      }

      if (!(await this.reportNewChapters(updateManager, manga, total))) {
        await updateManager.setUpdatePriority(mangaId, "high");
      }
    }
  }

  /** True when the newest page alone accounted for everything the app was missing. */
  private async reportNewChapters(
    updateManager: UpdateManager,
    sourceManga: SourceManga,
    total: number,
  ): Promise<boolean> {
    const mangaId = sourceManga.mangaId;

    let newest;
    try {
      const url = chapterListUrl(mangaId, Math.max(1, Math.ceil(total / CHAPTER_PAGE_SIZE)));
      newest = parseChapterList(await fetchJson(url));
    } catch {
      return false;
    }

    const known = new Set((await updateManager.getChapters(mangaId)).map((c) => c.chapterId));
    const unseen = toChapters(newest.entries, sourceManga).filter(
      (chapter) => !known.has(chapter.chapterId),
    );

    // Everything new sat outside the last page, so the app has to walk it properly.
    if (known.size + unseen.length < total) return false;

    await updateManager.setNewChapters(mangaId, unseen);
    return true;
  }
}

export const FreeWebNovel = new FreeWebNovelExtension();
