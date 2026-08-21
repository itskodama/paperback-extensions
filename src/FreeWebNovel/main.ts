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
  ContentRating as ContentRatingValue,
  type ContentRating,
  type SortingOption,
  type SourceManga,
  type UpdateManager,
} from "@paperback/types";

import { parseChapterList, resolveChapterTitles } from "./chapters.ts";
import { FreeWebNovelSearchForm } from "./forms.ts";
import {
  genreChipItems,
  matchesFilters,
  toChapterDetails,
  toChapterUpdateItem,
  contentRatingFor,
  detailContentRating,
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
import { MainInterceptor, fetchJson, fetchPage, fetchPageOnce } from "./network.ts";
import { parseFeatured, parseLatestReleases, parseListing, parseNovelDetail } from "./parsers.ts";
import type FreeWebNovelConfig from "./pbconfig.ts";
import { cachedRating, rememberRatings, verifyRatingsEnabled } from "./settings.ts";
import { FreeWebNovelSettingsForm } from "./settingsForm.ts";
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
      const rows = parseFeatured(await fetchPage(homeUrl()));
      const rated = await this.ratings(rows);
      return { items: rows.map((row) => toFeaturedItem(row, rated.get(row.slug))) };
    }
    if (section.id === DISCOVER_LATEST_RELEASE) {
      const entries = parseLatestReleases(await fetchPage(homeUrl()));
      const rated = await this.ratings(entries);
      return { items: entries.map((entry) => toChapterUpdateItem(entry, rated.get(entry.slug))) };
    }

    const key = BROWSE_SECTIONS[section.id];
    if (!key) return { items: [] };

    const page = typeof metadata === "number" ? metadata : 1;
    const listing = parseListing(await fetchPage(sortUrl(key, page)));
    const rated = await this.ratings(listing.rows);
    const items = listing.rows.map((row) => toSimpleCarouselItem(row, rated.get(row.slug)));

    return page < listing.lastPage ? { items, metadata: page + 1 } : { items };
  }

  /**
   * True ratings for a page of rows.
   *
   * A listing row carries no rating and only its first two genres, and this site
   * orders the explicit tags late — on the Latest Novels page twelve of twenty
   * novels are adult and the rows reveal four. The novel page is the only place
   * that settles it.
   *
   * Gated on the extension's own setting rather than `Application.filterAdultTitles`,
   * which is true only in Filter mode: a reader on Blurred needs the rating just as
   * much, and would otherwise see none of it applied.
   */
  private async ratings(
    rows: { slug: string; genres?: string[] }[],
  ): Promise<Map<string, ContentRating>> {
    if (!verifyRatingsEnabled()) return new Map();

    const resolved = new Map<string, ContentRating>();
    const unknown: string[] = [];

    for (const row of rows) {
      if (resolved.has(row.slug)) continue;

      // A row that already prints an adult tag needs no confirming.
      if (row.genres && contentRatingFor(row.genres) === ContentRatingValue.ADULT) {
        resolved.set(row.slug, ContentRatingValue.ADULT);
        continue;
      }

      const remembered = cachedRating(row.slug);
      if (remembered) resolved.set(row.slug, remembered);
      else unknown.push(row.slug);
    }

    if (unknown.length === 0) return resolved;

    const fetched = await Promise.all(
      unknown.map(async (slug): Promise<[string, ContentRating, boolean]> => {
        try {
          const detail = parseNovelDetail(await fetchPageOnce(novelUrl(slug)), slug);
          return [slug, detailContentRating(detail), true];
        } catch {
          // Unverifiable: answer with the stricter of the two rather than leaving
          // adult content unmarked. Flagged not-durable so a transient failure is
          // not remembered as a verdict — the site does drop requests under load.
          return [slug, ContentRatingValue.ADULT, false];
        }
      }),
    );

    for (const [slug, rating] of fetched) resolved.set(slug, rating);
    rememberRatings(
      fetched.filter(([, , durable]) => durable).map(([slug, rating]) => [slug, rating]),
    );

    return resolved;
  }

  // --- Search ---

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS;
  }

  async getSettingsForm(): Promise<FreeWebNovelSettingsForm> {
    return new FreeWebNovelSettingsForm();
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
    const rows = listing.rows.filter((row) => matchesFilters(row, filters));
    const rated = await this.ratings(rows);
    const items = rows.map((row) => toSearchResultItem(row, rated.get(row.slug)));

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

    // Resolved over the assembled list, never per page: deciding whether a title's
    // second number is numbering or prose is a question about the novel, not the
    // entry. See resolveChapterTitles.
    return resolveChapterTitles([first, ...rest].flatMap((page) => page.entries));
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

    // Resolved against this page alone rather than the whole novel, which is the
    // point of the cheap path. A 200-entry sample decides the same way the full
    // list would — the two populations it separates differ by 65 points.
    const entries = resolveChapterTitles(newest.entries);

    const known = new Set((await updateManager.getChapters(mangaId)).map((c) => c.chapterId));
    const unseen = toChapters(entries, sourceManga).filter(
      (chapter) => !known.has(chapter.chapterId),
    );

    // Everything new sat outside the last page, so the app has to walk it properly.
    if (known.size + unseen.length < total) return false;

    await updateManager.setNewChapters(mangaId, unseen);
    return true;
  }
}

export const FreeWebNovel = new FreeWebNovelExtension();
