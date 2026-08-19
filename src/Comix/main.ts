/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  DiscoverSectionType,
  type Chapter,
  type ChapterDetails,
  type Cookie,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Metadata,
  type PagedResults,
  type Request,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

import { ComixSearchForm, type ComixSearchMetadata } from "./forms.ts";
import { DOMAIN, DEFAULT_SORT, SORT_OPTIONS, type MangaDetail } from "./models.ts";
import { cookieStorage, fetchText, mainInterceptor, rateLimiter } from "./network.ts";
import {
  contentRatingOf,
  extractInitialData,
  findQuery,
  mangaSummaries,
  parseChapterPayload,
  parsePagesPayload,
  posterUrl,
  seriesUrl,
  toSearchResultItem,
  toSourceManga,
} from "./parsers.ts";
import type ComixConfig from "./pbconfig.ts";
import { captureBrowse, captureChapterList, capturePageList } from "./webview.ts";

// Homepage sections come straight from the server-rendered payload, so none of
// them need the WebView. Each id is matched against a decoded query key.
const DISCOVER_SECTIONS = [
  { id: "trending", title: "Trending", type: "trending" },
  { id: "follows", title: "Most Followed", type: "follows" },
] as const;

export class ComixExtension implements ExtensionImpl<typeof ComixConfig> {
  async initialise(): Promise<void> {
    // Cookie storage registers before the main interceptor so the clearance is
    // attached to a request before anything inspects the response it produces.
    rateLimiter.registerInterceptor();
    cookieStorage.registerInterceptor();
    mainInterceptor.registerInterceptor();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return DISCOVER_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      type: DiscoverSectionType.simpleCarousel,
    }));
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    const queries = extractInitialData(await fetchText(`${DOMAIN}/`));
    const wanted = DISCOVER_SECTIONS.find((candidate) => candidate.id === section.id);

    const value = findQuery(queries, (key) => {
      if (key[0] !== "manga" || key[1] !== "top") return false;
      const params = key[2] as { type?: string } | undefined;
      return params?.type === wanted?.type;
    });

    return {
      items: mangaSummaries(value).map((manga) => ({
        type: "simpleCarouselItem" as const,
        mangaId: manga.hid,
        title: manga.title,
        subtitle: manga.latestChapter ? `Chapter ${manga.latestChapter}` : undefined,
        imageUrl: posterUrl(manga),
        contentRating: contentRatingOf(manga),
      })),
    };
  }

  async getSortingOptions(): Promise<SortingOption[]> {
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.title }));
  }

  async getAdvancedSearchForm(query: SearchQuery<Metadata>): Promise<ComixSearchForm> {
    return new ComixSearchForm(query);
  }

  /**
   * `/browse` ships an empty shell and loads its list over a signed, encrypted
   * request, so this is the one read path that has to go through the WebView.
   */
  async getSearchResults(
    query: SearchQuery<Metadata>,
    metadata?: Metadata,
  ): Promise<PagedResults<SearchResultItem>> {
    const search = (query.metadata as ComixSearchMetadata | undefined) ?? {};
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;

    const url =
      `${DOMAIN}/browse?q=${encodeURIComponent(query.title)}` +
      `&sort=${encodeURIComponent(search.sort ?? DEFAULT_SORT)}&page=${page}`;

    const captured = (await captureBrowse(url)) as {
      items?: unknown;
      meta?: { hasNext?: boolean };
    };
    const items = mangaSummaries(captured.items).map(toSearchResultItem);

    return {
      items,
      metadata: captured.meta?.hasNext ? { page: page + 1 } : undefined,
    };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const queries = extractInitialData(await fetchText(seriesUrl(mangaId)));
    const detail = findQuery(queries, (key) => key[0] === "manga" && key[1] === "detail") as
      | MangaDetail
      | undefined;

    if (!detail?.hid) throw new Error(`Comix: no details found for ${mangaId}`);
    return toSourceManga(detail);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    const payloads = await captureChapterList(sourceManga.mangaId);
    return payloads.flatMap((payload) => parseChapterPayload(payload, sourceManga));
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const pages = parsePagesPayload(
      await capturePageList(`/title/${chapter.sourceManga.mangaId}/${chapter.chapterId}`),
    );

    if (pages.length === 0) {
      throw new Error(`Comix: chapter ${chapter.chapterId} returned no pages`);
    }

    return { id: chapter.chapterId, mangaId: chapter.sourceManga.mangaId, pages };
  }

  async cloudflareBypassCompleted(
    request: Request,
    cookies: Cookie[],
    localStorage: Record<string, string>,
  ): Promise<void> {
    void request;
    void localStorage;

    // Only the clearance is kept: persisting the site's other cookies would
    // outlive their session and be sent back stale.
    cookies
      .filter((cookie) => cookie.name === "cf_clearance")
      .forEach((cookie) => cookieStorage.setCookie(cookie));
  }
}

export const Comix = new ComixExtension();
