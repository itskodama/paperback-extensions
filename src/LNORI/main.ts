/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  BasicRateLimiter,
  CookieStorageInterceptor,
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

import { MainInterceptor, fetchPage } from "./network";
import {
  DISCOVER_FEATURED,
  DISCOVER_GENRES,
  DISCOVER_POPULAR,
  DISCOVER_SEASONAL,
  bookUrl,
  homeUrl,
  libraryUrl,
  parseBookPublishDate,
  parseChapterDetails,
  parseFeaturedItems,
  parseGenreItems,
  parseLibrary,
  parseSeasonalItems,
  parseSeasonalTitle,
  parseSeriesDetails,
  parseVolumeList,
  parseVolumeToc,
  popularItems,
  searchLibrary,
  seriesUrl,
  toSearchResultItem,
  volumeChapters,
  type LibraryEntry,
  type LNORISearchMetadata,
  type TocEntry,
} from "./parser";
import type LNORIConfig from "./pbconfig";

const PAGE_SIZE = 50;

// The catalog page is ~1.8 MB for ~900 series and is CDN-cached for weeks, so one
// parsed copy serves every search of a session
const LIBRARY_TTL = 3_600_000;

type CachedLibrary = {
  fetchedAt: number;
  entries: LibraryEntry[];
};

let libraryCache: CachedLibrary | undefined;

async function getLibrary(): Promise<LibraryEntry[]> {
  if (libraryCache && Date.now() - libraryCache.fetchedAt <= LIBRARY_TTL) {
    return libraryCache.entries;
  }

  const entries = parseLibrary(await fetchPage(libraryUrl()));
  libraryCache = { fetchedAt: Date.now(), entries };
  return entries;
}

// Splitting volumes into chapters costs one book-page fetch per volume, because the
// site ignores Range requests and the TOC only exists there. Published volumes never
// change, so the parsed TOCs are kept for the session and refreshes are free.
type VolumeToc = { toc: TocEntry[]; publishDate?: Date };

const tocCache = new Map<string, VolumeToc>();
const TOC_CACHE_LIMIT = 500;

async function getVolumeToc(path: string): Promise<VolumeToc> {
  const cached = tocCache.get(path);
  if (cached) return cached;

  const html = await fetchPage(bookUrl(path));
  const entry: VolumeToc = { toc: parseVolumeToc(html) };
  const publishDate = parseBookPublishDate(html);
  if (publishDate) entry.publishDate = publishDate;

  if (tocCache.size >= TOC_CACHE_LIMIT) tocCache.clear();
  tocCache.set(path, entry);
  return entry;
}

export class LNORIExtension implements ExtensionImpl<typeof LNORIConfig> {
  // The site is static behind Cloudflare's CDN and chapter listing fetches one page
  // per volume, so the budget is set to keep a long series' listing under ~15s
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 20,
    bufferInterval: 10,
    ignoreImages: true,
  });

  cookieInterceptor = new CookieStorageInterceptor({ storage: "stateManager" });

  mainInterceptor = new MainInterceptor("main");

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.cookieInterceptor.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  async cloudflareBypassCompleted(
    request: Request,
    cookies: Cookie[],
    localStorage: Record<string, string>,
  ): Promise<void> {
    void request;
    void localStorage;

    for (const cookie of cookies) {
      if (cookie.name === "cf_clearance") this.cookieInterceptor.setCookie(cookie);
    }
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    // The seasonal block is titled by the page itself ("Summer 2026 Anime"), so the
    // section name tracks the site; everything else is fixed
    let seasonalTitle: string | undefined;
    try {
      seasonalTitle = parseSeasonalTitle(await fetchPage(homeUrl()));
    } catch {
      // A failed homepage fetch falls back to the static title
    }

    return [
      {
        id: DISCOVER_FEATURED,
        title: "Featured",
        type: DiscoverSectionType.featured,
      },
      {
        id: DISCOVER_SEASONAL,
        title: seasonalTitle ?? "Seasonal Anime",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_POPULAR,
        title: "Popular",
        type: DiscoverSectionType.simpleCarousel,
      },
      {
        id: DISCOVER_GENRES,
        title: "Genres",
        type: DiscoverSectionType.genres,
      },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: Metadata | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    // Popular is compiled from the library catalog; the rest read the homepage,
    // which the page cache serves once for all of them
    if (section.id === DISCOVER_POPULAR) {
      return { items: popularItems(await getLibrary()) };
    }

    const html = await fetchPage(homeUrl());
    switch (section.id) {
      case DISCOVER_FEATURED:
        return { items: parseFeaturedItems(html) };
      case DISCOVER_SEASONAL:
        return { items: parseSeasonalItems(html) };
      case DISCOVER_GENRES:
        return { items: parseGenreItems(html) };
      default:
        return { items: [] };
    }
  }

  async getSearchResults(
    query: SearchQuery<LNORISearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    void sortingOption;

    const matches = searchLibrary(await getLibrary(), query.title, query.metadata?.genre);

    const start = typeof metadata === "number" ? metadata : 0;
    const items = matches.slice(start, start + PAGE_SIZE).map(toSearchResultItem);
    const next = start + PAGE_SIZE;

    return next < matches.length ? { items, metadata: next } : { items };
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const html = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(html, mangaId);
  }

  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // The series page lists every volume; each volume's own TOC then yields its
    // chapters. A volume whose page cannot be fetched degrades to one whole-volume
    // chapter instead of failing the whole list.
    void sinceDate;

    const html = await fetchPage(seriesUrl(sourceManga.mangaId));
    const volumes = parseVolumeList(html);

    const perVolume = await Promise.all(
      volumes.map(async (volume) => {
        try {
          const { toc, publishDate } = await getVolumeToc(volume.path);
          return volumeChapters(volume, toc, publishDate, sourceManga);
        } catch {
          return volumeChapters(volume, [], undefined, sourceManga);
        }
      }),
    );

    // docs/paperback/chapters.md records a device test where sortingIndex did not override the
    // visible order, so this is probably inert — but it is the only expression of true reading
    // order across volumes (chapNum restarts inside each one), it costs nothing, and removing it
    // has never been tried on a device. Left until someone checks.
    const chapters = perVolume.flat();
    chapters.forEach((chapter, index) => {
      chapter.sortingIndex = index;
    });
    return chapters;
  }

  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const html = await fetchPage(bookUrl(chapter.chapterId));
    return parseChapterDetails(html, chapter);
  }
}

export const LNORI = new LNORIExtension();
