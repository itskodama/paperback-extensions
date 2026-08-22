/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
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

import {
  applySearchTerm,
  parseGenres,
  parseQueryResponse,
  parseSeriesDetail,
  toDiscoverItem,
  toSearchResultItem,
} from "./catalog.ts";
import {
  chapterIsPaid,
  paidChapterError,
  parseChapterList,
  parseNovelBody,
  parsePages,
  toChapters,
} from "./chapters.ts";
import { HiveToonsAdvancedSearchForm, searchFilters, toBrowseQuery } from "./forms.ts";
import { DEFAULT_FILTERS, DEFAULT_SORT, PER_PAGE, SORT_OPTIONS } from "./models.ts";
import { fetchJson, mainInterceptor, rateLimiter } from "./network.ts";
import type HiveToonsConfig from "./pbconfig.ts";
import { hidePaidChaptersEnabled } from "./settings.ts";
import { HiveToonsSettingsForm } from "./settingsForm.ts";
import { chapterUrl, chaptersUrl, genresUrl, postUrl, queryUrl } from "./urls.ts";

/**
 * Every section is one archive query under a different ordering, which is far cheaper than the
 * homepage — that page is ~750 KB and would have to be fetched and decoded to serve any of them.
 */
const DISCOVER_SECTIONS: { id: string; title: string; sort: string }[] = [
  { id: "popular", title: "Most Popular", sort: "totalViews:desc" },
  { id: "latest", title: "Latest Updates", sort: "lastChapterAddedAt:desc" },
  { id: "recent", title: "Recently Added", sort: "createdAt:desc" },
];

const GENRES_SECTION_ID = "genres";

class HiveToonsExtension implements ExtensionImpl<typeof HiveToonsConfig> {
  async initialise(): Promise<void> {
    rateLimiter.registerInterceptor();
    mainInterceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      ...DISCOVER_SECTIONS.map((section) => ({
        id: section.id,
        title: section.title,
        type: DiscoverSectionType.simpleCarousel,
      })),
      { id: GENRES_SECTION_ID, title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === GENRES_SECTION_ID) {
      return {
        items: parseGenres(await fetchJson(genresUrl())).map((genre) => ({
          type: "genresCarouselItem" as const,
          name: genre.title,
          // Compiled here rather than by the app, so every key must be present.
          searchQuery: {
            title: "",
            metadata: { ...DEFAULT_FILTERS, includedGenres: [genre.id] },
          },
        })),
      };
    }

    const wanted = DISCOVER_SECTIONS.find((candidate) => candidate.id === section.id);
    if (!wanted) return { items: [] };

    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const response = parseQueryResponse(
      await fetchJson(queryUrl({ ...DEFAULT_FILTERS, page }, wanted.sort)),
    );

    const items = response.posts.map(toDiscoverItem);

    return hasMore(page, response.totalCount) ? { items, metadata: { page: page + 1 } } : { items };
  }

  async getSettingsForm(): Promise<HiveToonsSettingsForm> {
    return new HiveToonsSettingsForm();
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<HiveToonsAdvancedSearchForm> {
    return new HiveToonsAdvancedSearchForm(query);
  }

  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const filters = searchFilters(query);
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    const sort = sortingOption?.id ?? DEFAULT_SORT;

    const response = parseQueryResponse(
      await fetchJson(queryUrl(toBrowseQuery(filters, query.title, page), sort)),
    );

    // The origin's search sometimes collapses and answers with the whole catalog, so the term is
    // verified against the results here. Paging is unaffected: each page is checked the same way.
    const posts = applySearchTerm(response.posts, query.title);
    const items = posts.map(toSearchResultItem);

    // Paging is driven by the origin's own count, not by how many survived filtering: a page can
    // filter down to nothing while later pages still hold matches.
    return hasMore(page, response.totalCount) ? { items, metadata: { page: page + 1 } } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    return parseSeriesDetail(await fetchJson(postUrl(mangaId)), mangaId);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // take=all returns the complete list in one response; there is no pagination to walk.
    const payload = await fetchJson(chaptersUrl(sourceManga.mangaId));
    return toChapters(parseChapterList(payload), sourceManga, hidePaidChaptersEnabled());
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    if (chapterIsPaid(chapter)) throw paidChapterError(chapter);

    const mangaId = chapter.sourceManga.mangaId;
    const payload = await fetchJson(chapterUrl(chapter.chapterId));

    if (chapter.sourceManga.mangaInfo.contentType === "novel") {
      const body = parseNovelBody(payload);
      if (body === undefined) {
        throw new Error(`HiveToons served no text for chapter ${chapter.chapNum}`);
      }
      return { id: chapter.chapterId, mangaId, type: "html", html: body };
    }

    const pages = parsePages(payload);
    if (pages.length === 0) {
      // The API serves no images for a chapter it will not release, so an empty list means the
      // site withheld them — which for an anonymous reader is always the paywall.
      throw paidChapterError(chapter);
    }

    return { id: chapter.chapterId, mangaId, pages };
  }
}

function hasMore(page: number, totalCount: number): boolean {
  return page * PER_PAGE < totalCount;
}

export const HiveToons = new HiveToonsExtension();
