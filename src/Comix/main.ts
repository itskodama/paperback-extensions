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

// TEMPORARY — see probeCanvas.
const CANVAS_PROBE_QUERY = "comix:probe-canvas";

type QueryParams = { type?: string; scope?: string; order?: Record<string, string> };

/**
 * Every section is served by the homepage's own embedded payload, so the whole
 * discover screen costs one cached request and never touches the WebView.
 * `matches` picks a section out of that payload by its decoded query key.
 */
const DISCOVER_SECTIONS: {
  id: string;
  title: string;
  matches: (verb: string, params: QueryParams) => boolean;
}[] = [
  {
    id: "popular",
    title: "Most Popular",
    matches: (verb, params) => verb === "top" && params.type === "trending",
  },
  {
    id: "follows",
    title: "Most Follows",
    matches: (verb, params) => verb === "top" && params.type === "follows",
  },
  {
    id: "latest",
    title: "Latest Updates",
    matches: (verb, params) =>
      verb === "list" && params.scope === "hot" && params.order?.chapter_updated_at === "desc",
  },
  {
    id: "recent",
    title: "Recently Added",
    matches: (verb, params) => verb === "list" && params.order?.created_at === "desc",
  },
];

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
    if (!wanted) return { items: [] };

    const value = findQuery(queries, (key) => {
      if (key[0] !== "manga" || typeof key[1] !== "string") return false;
      return wanted.matches(key[1], (key[2] as QueryParams | undefined) ?? {});
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
    // TEMPORARY — searching this exact term reports the probe instead of results.
    // Remove once the canvas question is settled.
    if (query.title.trim() === CANVAS_PROBE_QUERY) {
      throw new Error(`Comix canvas probe -> ${this.probeCanvas()}`);
    }

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
    // The series page is cheap and already cached, and its `latestChapter` is
    // what tells a reused chapter list from a stale one.
    const queries = extractInitialData(await fetchText(seriesUrl(sourceManga.mangaId)));
    const detail = findQuery(queries, (key) => key[0] === "manga" && key[1] === "detail") as
      | MangaDetail
      | undefined;

    const payloads = await captureChapterList(sourceManga.mangaId, detail?.latestChapter);
    return payloads.flatMap((payload) => parseChapterPayload(payload, sourceManga));
  }

  /**
   * TEMPORARY — remove once answered. 0.9 exposes no way to construct a
   * PBCanvas, which is the only thing blocking tile descrambling. The 0.8 compat
   * layer declares App.createPBCanvas/createPBImage but is not re-exported from
   * the package root, so whether it still exists at runtime can only be settled
   * on device. Reported through an error because it is the one channel that
   * reliably reaches the screen.
   */
  private probeCanvas(): string {
    const globals = globalThis as Record<string, unknown>;
    const app = globals["App"] as Record<string, unknown> | undefined;

    return [
      `App: ${app ? "present" : "absent"}`,
      `createPBCanvas: ${typeof app?.["createPBCanvas"]}`,
      `createPBImage: ${typeof app?.["createPBImage"]}`,
      `PBCanvas global: ${typeof globals["PBCanvas"]}`,
      `createCanvas: ${typeof globals["createCanvas"]}`,
    ].join(" | ");
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    // The site's own path carries the slug and chapter number, neither of which
    // is derivable from the ids, so getChapters records it on the chapter.
    const path = chapter.additionalInfo?.url;
    if (!path) {
      throw new Error(`Comix: chapter ${chapter.chapterId} has no page url recorded`);
    }

    const pages = parsePagesPayload(await capturePageList(path));

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
