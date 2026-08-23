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
  type UpdateManager,
} from "@paperback/types";

import { ComixSearchForm, DEFAULT_SEARCH_METADATA, type ComixSearchMetadata } from "./forms.ts";
import { fetchText, isCloudflareError, noteBypassCompleted } from "./http.ts";
import { DEFAULT_SORT, SORT_OPTIONS, type MangaDetail } from "./models.ts";
import { cookieStorage, mainInterceptor, rateLimiter } from "./network.ts";
import {
  contentRatingOf,
  extractInitialData,
  findQuery,
  mangaSummaries,
  parseChapterPayload,
  parsePagesPayload,
  posterUrl,
  toSearchResultItem,
  toSourceManga,
} from "./parsers.ts";
import type ComixConfig from "./pbconfig.ts";
import { fullUpdateScanEnabled, latestSeen, rememberLatestSeen } from "./settings.ts";
import { ComixSettingsForm } from "./settingsForm.ts";
import { browseUrl, homeUrl, seriesUrl } from "./urls.ts";
import {
  captureBrowse,
  captureChapterList,
  captureNewestChapters,
  capturePageList,
} from "./webview.ts";

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
    const queries = extractInitialData(await fetchText(homeUrl()));
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

  async getSettingsForm(): Promise<ComixSettingsForm> {
    return new ComixSettingsForm();
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
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const search: ComixSearchMetadata = {
      ...DEFAULT_SEARCH_METADATA,
      ...(query.metadata as Partial<ComixSearchMetadata> | undefined),
    };
    const page = (metadata as { page?: number } | undefined)?.page ?? 1;
    // The sort comes from the app's own selector rather than the filter form.
    const url = browseUrl(query.title, search, sortingOption?.id ?? DEFAULT_SORT, page);

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

  // Both the details screen and the chapter list start from the same
  // server-rendered payload, so the fetch-and-extract lives in one place.
  private async seriesDetail(hid: string): Promise<MangaDetail | undefined> {
    const queries = extractInitialData(await fetchText(seriesUrl(hid)));
    return findQuery(queries, (key) => key[0] === "manga" && key[1] === "detail") as
      | MangaDetail
      | undefined;
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const detail = await this.seriesDetail(mangaId);
    if (!detail?.hid) throw new Error(`Comix: no details found for ${mangaId}`);
    return toSourceManga(detail);
  }

  async getChapters(sourceManga: SourceManga): Promise<Chapter[]> {
    // The series page is cheap and already cached, and its `latestChapter` tells
    // a reused chapter list from a stale one.
    const detail = await this.seriesDetail(sourceManga.mangaId);

    // A series with nothing uploaded is an empty list, not a failure — and the
    // series page says so, sparing a WebView run that would only time out waiting
    // for a request the site never makes.
    if (detail?.hasChapters === false) return [];

    const payloads = await captureChapterList(sourceManga.mangaId, detail?.latestChapter);
    // Seeds the update tracker, so the next library sweep can skip this title
    // without a WebView walk.
    if (detail?.latestChapter !== undefined) {
      rememberLatestSeen(sourceManga.mangaId, detail.latestChapter);
    }
    return payloads.flatMap((payload) => parseChapterPayload(payload, sourceManga));
  }

  /**
   * Without this the app checks a library by calling getChapters on every
   * followed title, and each of those is a WebView walk of 20-35s. They queue
   * behind one another and behind whatever the reader is trying to open, which
   * is what made opening a chapter intermittently stall for tens of seconds.
   *
   * The series page reports its newest chapter cheaply and without a WebView, so
   * a title whose newest chapter has not moved is skipped outright.
   */
  async processTitlesForUpdates(updateManager: UpdateManager): Promise<void> {
    const seen = latestSeen();

    for (const manga of updateManager.getQueuedItems()) {
      let detail: MangaDetail | undefined;
      try {
        detail = await this.seriesDetail(manga.mangaId);
      } catch (error) {
        // A challenge has to reach the app — it raises the bypass inline in the
        // library updater — while anything else is one title's problem and must
        // not abandon the rest of the sweep. Matched with the same helper the
        // fetch layer uses: a bare `type` check misses the forms a CloudflareError
        // takes once it has crossed the bridge, and missing it here silently
        // skips every remaining title instead of prompting.
        if (isCloudflareError(error)) throw error;
        continue;
      }

      const latest = detail?.latestChapter;
      if (latest === undefined || detail?.hasChapters === false) {
        await updateManager.setUpdatePriority(manga.mangaId, "skip");
        continue;
      }

      if (seen.get(manga.mangaId) === latest) {
        await updateManager.setUpdatePriority(manga.mangaId, "skip");
        continue;
      }

      rememberLatestSeen(manga.mangaId, latest);

      // Falling through to `high` makes the app call getChapters, which walks
      // every page — four hundred of them on a long series, to discover perhaps
      // one new chapter. Reading the newest page and handing over just what is
      // new avoids that entirely.
      if (fullUpdateScanEnabled() || !(await this.reportNewChapters(updateManager, manga))) {
        await updateManager.setUpdatePriority(manga.mangaId, "high");
      }
    }
  }

  /**
   * Hands the app the chapters it does not already have, without a full walk.
   * Returns false if that could not be done, so the caller can fall back.
   */
  private async reportNewChapters(
    updateManager: UpdateManager,
    sourceManga: SourceManga,
  ): Promise<boolean> {
    let payload;
    try {
      payload = await captureNewestChapters(sourceManga.mangaId);
    } catch {
      return false;
    }
    if (!payload) return false;

    const newest = parseChapterPayload(payload, sourceManga);
    if (newest.length === 0) return false;

    const known = new Set(
      (await updateManager.getChapters(sourceManga.mangaId)).map((c) => c.chapterId),
    );
    const unseen = newest.filter((chapter) => !known.has(chapter.chapterId));

    await updateManager.setNewChapters(sourceManga.mangaId, unseen);
    return true;
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

    // Noted so that a challenge surviving this does not re-prompt immediately.
    noteBypassCompleted();

    // Only the clearance is kept: persisting the site's other cookies would
    // outlive their session and be sent back stale.
    cookies
      .filter((cookie) => cookie.name === "cf_clearance")
      .forEach((cookie) => cookieStorage.setCookie(cookie));
  }
}

export const Comix = new ComixExtension();
