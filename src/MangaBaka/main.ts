/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type ChapterReadActionQueueProcessingResult,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type MangaProgress,
  type ManagedCollection,
  type ManagedCollectionChangeset,
  type Metadata,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import {
  batchUpsert,
  deleteLibraryEntry,
  fetchGenres,
  fetchLibraryEntry,
  fetchLibrarySeries,
  fetchSeries,
  fetchSeriesList,
  saveLibraryEntry,
} from "./api.ts";
import { isLoggedIn } from "./auth.ts";
import { cryptoSupport } from "./crypto.ts";
import { count, num, positive } from "./decode.ts";
import { MangaBakaSearchForm, type MangaBakaSearchMetadata } from "./forms.ts";
import { toSearchResultItem, toSimpleCarouselItem, toSourceManga } from "./mapping.ts";
import { MainInterceptor } from "./network.ts";
import type MangaBakaConfig from "./pbconfig.ts";
import { collapseReadActions, progressChapter, today } from "./progress.ts";
import {
  autoCompleteEnabled,
  recordCryptoSupport,
  recordSyncStatus,
  titlePreference,
} from "./settings.ts";
import { MangaBakaSettingsForm } from "./settingsForm.ts";
import { MangaBakaTrackingForm } from "./trackingForm.ts";
import {
  BROWSE_SORT,
  DEFAULT_SORT,
  LIBRARY_STATES,
  SEARCH_PAGE_SIZE,
  SORT_OPTIONS,
} from "./types.ts";
import { searchPath } from "./urls.ts";

// Sections that page through /series/search, keyed by the sort they apply.
const SEARCH_SECTIONS: Record<string, string> = {
  trending: "trending_7d",
  popular: "popularity_desc",
  latest: "latest",
};

// Sections served by curated endpoints, which return a single page.
const DISCOVER_ENDPOINTS: Record<string, string> = {
  rising: "/v2/series/discover/rising",
  "hidden-gems": "/v2/series/discover/hidden-gems",
};

export class MangaBakaExtension implements ExtensionImpl<typeof MangaBakaConfig> {
  // The 180/min default bucket, with headroom. Search has its own; see network.ts.
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 60,
    bufferInterval: 60,
    ignoreImages: true,
  });
  mainInterceptor = new MainInterceptor("main");

  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();

    recordCryptoSupport(cryptoSupport());
  }

  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const { series, id } = await fetchSeries(mangaId);

    // `id` may differ from the one asked for; returning it heals a stale tracker link.
    return { ...toSourceManga(series, titlePreference()), mangaId: id };
  }

  async getSearchResults(
    query: SearchQuery<MangaBakaSearchMetadata>,
    metadata: Metadata | undefined,
    sortingOption: SortingOption | undefined,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = positive(metadata) ?? 1;
    const title = query.title.trim();
    const filters = query.metadata ?? {};

    const path = searchPath({
      query: title,
      page,
      limit: SEARCH_PAGE_SIZE,
      sort: sortingOption?.id ?? (title.length > 0 ? DEFAULT_SORT : BROWSE_SORT),
      types: filters.types,
      statuses: filters.statuses,
      contentRatings: filters.contentRatings,
      genres: filters.genres,
      genresExcluded: filters.genresExcluded,
    });

    const { series, pagination } = await fetchSeriesList(path);
    // Explicit arrow: a bare reference would receive Array.map's index as the preference.
    const preference = titlePreference();
    const items = series.map((entry) => toSearchResultItem(entry, preference));

    // `undefined` metadata crosses the bridge as nil and throws, so omit the key entirely.
    return pagination?.next ? { items, metadata: page + 1 } : { items };
  }

  async getSortingOptions(query: SearchQuery<MangaBakaSearchMetadata>): Promise<SortingOption[]> {
    void query;
    return SORT_OPTIONS.map((option) => ({ id: option.id, label: option.label }));
  }

  async getAdvancedSearchForm(
    query: SearchQuery<MangaBakaSearchMetadata>,
  ): Promise<MangaBakaSearchForm> {
    return new MangaBakaSearchForm(query);
  }

  async getSettingsForm(): Promise<Form> {
    return new MangaBakaSettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    return [
      { id: "trending", title: "Trending This Week", type: DiscoverSectionType.simpleCarousel },
      { id: "rising", title: "Rising", type: DiscoverSectionType.simpleCarousel },
      { id: "popular", title: "Most Popular", type: DiscoverSectionType.prominentCarousel },
      { id: "hidden-gems", title: "Hidden Gems", type: DiscoverSectionType.simpleCarousel },
      { id: "latest", title: "Recently Updated", type: DiscoverSectionType.simpleCarousel },
      { id: "genres", title: "Genres", type: DiscoverSectionType.genres },
    ];
  }

  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata?: Metadata,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    if (section.id === "genres") {
      const genres = await fetchGenres();
      return {
        items: genres.map((genre) => ({
          type: "genresCarouselItem" as const,
          searchQuery: { title: "", metadata: { genres: [genre.id] } },
          name: genre.title,
        })),
      };
    }

    const endpoint = DISCOVER_ENDPOINTS[section.id];
    if (endpoint) {
      const { series } = await fetchSeriesList(endpoint);
      const preference = titlePreference();
      return { items: series.map((entry) => toSimpleCarouselItem(entry, preference)) };
    }

    const sort = SEARCH_SECTIONS[section.id];
    if (!sort) return { items: [] };

    const page = positive(metadata) ?? 1;
    const { series, pagination } = await fetchSeriesList(
      searchPath({ page, limit: SEARCH_PAGE_SIZE, sort }),
    );
    const preference = titlePreference();
    const items = series.map((entry) => toSimpleCarouselItem(entry, preference));

    return pagination?.next ? { items, metadata: page + 1 } : { items };
  }

  async getMangaProgress(sourceManga: SourceManga): Promise<MangaProgress | undefined> {
    const entry = await fetchLibraryEntry(sourceManga.mangaId);
    if (!entry) return undefined;

    const progress: MangaProgress = {
      sourceManga,
      lastReadChapter: progressChapter(entry, sourceManga),
    };

    const userRating = positive(entry.rating);
    if (userRating !== undefined) progress.userRating = userRating;

    if (typeof entry.updated_at === "string") {
      const updated = new Date(entry.updated_at);
      if (!Number.isNaN(updated.getTime())) progress.lastReadTime = updated;
    }

    return progress;
  }

  async getMangaProgressManagementForm(sourceManga: SourceManga): Promise<Form> {
    if (!isLoggedIn()) {
      throw new Error("You are not logged in to MangaBaka. Log in from the extension settings.");
    }
    return new MangaBakaTrackingForm(sourceManga);
  }

  /** Never throws; an id in neither array is treated as "not attempted" and retried. */
  async processChapterReadActionQueue(
    actions: TrackedMangaChapterReadAction[],
  ): Promise<ChapterReadActionQueueProcessingResult> {
    const successfulItems: string[] = [];
    const failedItems: string[] = [];
    const failures: string[] = [];

    try {
      // Report nothing rather than fail: the queue then survives until the user logs in.
      if (!isLoggedIn()) {
        recordSyncStatus("Not logged in — nothing was sent.");
        return { successfulItems, failedItems };
      }

      for (const { action, supersededIds } of collapseReadActions(actions)) {
        try {
          await this.syncReadAction(action);
          successfulItems.push(action.id, ...supersededIds);
        } catch (error) {
          failures.push(
            `series ${action.sourceManga.mangaId} ch ${action.chapterNum}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          // Lower chapters are satisfied by the highest write, so they fail alongside it.
          failedItems.push(action.id, ...supersededIds);
        }
      }
    } catch (error) {
      failures.push(`queue aborted: ${error instanceof Error ? error.message : String(error)}`);

      // Nothing may be left unaccounted for, or the app will retry it forever.
      const accounted = new Set([...successfulItems, ...failedItems]);
      for (const action of actions) {
        if (!accounted.has(action.id)) failedItems.push(action.id);
      }
    }

    recordSyncStatus(
      failures.length === 0
        ? `Synced ${successfulItems.length} action${successfulItems.length === 1 ? "" : "s"}.`
        : failures.slice(0, 3).join(" | "),
    );

    return { successfulItems, failedItems };
  }

  private async syncReadAction(action: TrackedMangaChapterReadAction): Promise<void> {
    const seriesId = action.sourceManga.mangaId;
    const entry = await fetchLibraryEntry(seriesId);

    const remote = num(entry?.progress_chapter) ?? 0;
    // Fractional: MangaBaka accepts decimal chapters, and flooring would lose them.
    const target = action.chapterNum;

    // The app may replay an older action, and this device is not the only writer.
    if (remote >= target) return;

    const update: Parameters<typeof saveLibraryEntry>[1] = { progress_chapter: target };

    const volume = num(action.chapterVolume);
    if (volume !== undefined && volume > (entry?.progress_volume ?? 0)) {
      update.progress_volume = volume;
    }

    if (!entry) {
      update.state = "reading";
      update.start_date = today();
    }

    if (autoCompleteEnabled() && (await this.reachedFinalChapter(seriesId, target))) {
      update.state = "completed";
      update.finish_date = today();
    }

    await saveLibraryEntry(seriesId, update, entry !== undefined);
  }

  private async reachedFinalChapter(seriesId: string, progress: number): Promise<boolean> {
    try {
      const { series } = await fetchSeries(seriesId);
      if (series.status !== "completed") return false;

      const total = count(series.total_chapters);
      return total !== undefined && progress >= total;
    } catch {
      return false; // A convenience; failing to check it must never fail the sync.
    }
  }

  async getManagedLibraryCollections(): Promise<ManagedCollection[]> {
    return LIBRARY_STATES.map((state) => ({ id: state.id, title: state.title }));
  }

  async getSourceMangaInManagedCollection(
    managedCollection: ManagedCollection,
  ): Promise<SourceManga[]> {
    const series = await fetchLibrarySeries(managedCollection.id);
    const preference = titlePreference();
    return series.map((entry) => toSourceManga(entry, preference));
  }

  /** The atomic batch upsert makes this one call per 100 titles, not one per title. */
  async commitManagedCollectionChanges(changeset: ManagedCollectionChangeset): Promise<void> {
    const additions = changeset.additions.map((manga) => manga.mangaId);
    if (additions.length > 0) {
      await batchUpsert(additions, { state: changeset.collection.id });
    }

    for (const manga of changeset.deletions) {
      await deleteLibraryEntry(manga.mangaId);
    }
  }
}

export const MangaBaka = new MangaBakaExtension();
