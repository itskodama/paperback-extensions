/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */

// TODO:
// - Replace the discover sections with the homepage islands
// - Replace search with the browse endpoint
// - Remove the content.json file

import {
  BasicRateLimiter,
  DiscoverSectionType,
  type AdvancedSearchForm,
  type Chapter,
  type ChapterDetails,
  type DiscoverSection,
  type DiscoverSectionItem,
  type ExtensionImpl,
  type Form,
  type PagedResults,
  type SearchQuery,
  type SearchResultItem,
  type SortingOption,
  type SourceManga,
} from "@paperback/types";

// Template content file
import content from "./content.json";
// Extension forms file
import { AsuraScansAdvancedSearchForm, SettingsForm } from "./forms";
import type { AsuraScansSearchMetadata } from "./models";
// Extension network file
import { MainInterceptor, fetchPage } from "./network";
import {
  browseUrl,
  chapterUrl,
  parseChapterDetails,
  parseChapterList,
  parseSearchResults,
  parseSeriesDetails,
  seriesUrl,
} from "./parser";
import type AsuraScansConfig from "./pbconfig";

// Main extension class
export class AsuraScansExtension implements ExtensionImpl<typeof AsuraScansConfig> {
  // Implementation of the main rate limiter
  mainRateLimiter = new BasicRateLimiter("main", {
    numberOfRequests: 15,
    bufferInterval: 10,
    ignoreImages: true,
  });

  // Implementation of the main interceptor
  mainInterceptor = new MainInterceptor("main");

  // Method from the Extension interface which we implement, initializes the rate limiter, interceptor, discover sections and search filters
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }

  // Implements the settings form, check SettingsForm.ts for more info
  async getSettingsForm(): Promise<Form> {
    return new SettingsForm();
  }

  async getDiscoverSections(): Promise<DiscoverSection[]> {
    // First template discover section, gets populated by the getDiscoverSectionItems method
    const discover_section_template1: DiscoverSection = {
      id: "discover-section-template1",
      title: "Discover Section Template 1",
      subtitle: "This is a template",
      type: DiscoverSectionType.featured,
    };

    // Second template discover section, gets populated by the getDiscoverSectionItems method
    const discover_section_template2: DiscoverSection = {
      id: "discover-section-template2",
      title: "Discover Section Template 2",
      subtitle: "This is another template",
      type: DiscoverSectionType.prominentCarousel,
    };

    // Second template discover section, gets populated by the getDiscoverSectionItems method
    const discover_section_template3: DiscoverSection = {
      id: "discover-section-template3",
      title: "Discover Section Template 3",
      subtitle: "This is yet another template",
      type: DiscoverSectionType.simpleCarousel,
    };

    return [discover_section_template1, discover_section_template2, discover_section_template3];
  }

  // Populates both the discover sections
  async getDiscoverSectionItems(
    section: DiscoverSection,
    metadata: number | undefined,
  ): Promise<PagedResults<DiscoverSectionItem>> {
    void metadata;

    const half = Math.ceil(content.length / 2);

    let start = 0;
    let end = content.length;
    let type: "featuredCarouselItem" | "simpleCarouselItem" | "prominentCarouselItem" =
      "simpleCarouselItem";
    switch (section.id) {
      case "discover-section-template1":
        end = half;
        type = "featuredCarouselItem";
        break;
      case "discover-section-template2":
        start = half;
        type = "prominentCarouselItem";
        break;
      case "discover-section-template3":
        type = "simpleCarouselItem";
        break;
    }

    return {
      items: content.slice(start, end).map((manga): DiscoverSectionItem => {
        const item = {
          mangaId: manga.titleId,
          title: manga.primaryTitle ? manga.primaryTitle : "Unknown Title",
          imageUrl: manga.thumbnailUrl ? manga.thumbnailUrl : "",
        };

        return type === "featuredCarouselItem"
          ? { ...item, type, summary: manga.synopsis }
          : { ...item, type, subtitle: manga.secondaryTitles[0] };
      }),
    };
  }

  // Populates search filters in a form
  async getAdvancedSearchForm(
    query: SearchQuery<AsuraScansSearchMetadata>,
  ): Promise<AdvancedSearchForm> {
    return new AsuraScansAdvancedSearchForm(query);
  }

  // Populates search
  async getSearchResults(
    query: SearchQuery<AsuraScansSearchMetadata>,
    metadata?: number,
    sortingOption?: SortingOption,
  ): Promise<PagedResults<SearchResultItem>> {
    const page = await fetchPage(
      browseUrl({
        search: query.title,
        page: metadata ?? 1,
        sort: sortingOption?.id,
      }),
    );

    return parseSearchResults(page.html);
  }

  // Populates the title details
  async getMangaDetails(mangaId: string): Promise<SourceManga> {
    const page = await fetchPage(seriesUrl(mangaId));
    return parseSeriesDetails(page.html, mangaId);
  }

  // Populates the chapter list
  async getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]> {
    // Asura embeds every chapter in the series page, so the whole list gets returned
    void sinceDate;

    const page = await fetchPage(seriesUrl(sourceManga.mangaId));
    return parseChapterList(page.html, sourceManga);
  }

  // Populates a chapter with images
  async getChapterDetails(chapter: Chapter): Promise<ChapterDetails> {
    const page = await fetchPage(chapterUrl(chapter));
    return parseChapterDetails(page.html, chapter);
  }
}

export const AsuraScans = new AsuraScansExtension();
