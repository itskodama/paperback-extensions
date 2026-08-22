/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  StepperRow,
  TriStateSelectRow,
  type FormSectionElement,
  type Metadata,
  type SearchQuery,
} from "@paperback/types";

import { parseGenres } from "./catalog.ts";
import {
  DEFAULT_FILTERS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type GenreOption,
  type SearchFilters,
} from "./models.ts";
import { fetchJson } from "./network.ts";
import { genresUrl, type BrowseQuery } from "./urls.ts";

/** Generous enough to bracket the longest series on the site, which runs past 600. */
const MAX_CHAPTERS = 1000;
const CHAPTER_STEP = 10;

/** Fills in anything the app did not send, so the caller always has a complete filter set. */
export function searchFilters(query: SearchQuery<Metadata>): SearchFilters {
  return {
    ...DEFAULT_FILTERS,
    ...(query.metadata as Partial<SearchFilters> | undefined),
  };
}

export function toBrowseQuery(filters: SearchFilters, title: string, page: number): BrowseQuery {
  const query: BrowseQuery = { ...filters, page };

  const term = title.trim();
  if (term.length > 0) query.searchTerm = term;
  return query;
}

export class HiveToonsAdvancedSearchForm extends AdvancedSearchForm {
  private genres: Record<string, "included" | "excluded">;
  private type: string;
  private status: string;
  private minChapters: number;
  private maxChapters: number;
  private genreOptions: GenreOption[] = [];

  constructor(query: SearchQuery<Metadata>) {
    super();

    const filters = searchFilters(query);
    this.genres = {
      ...Object.fromEntries(filters.includedGenres.map((id) => [id, "included" as const])),
      ...Object.fromEntries(filters.excludedGenres.map((id) => [id, "excluded" as const])),
    };
    this.type = filters.type;
    this.status = filters.status;
    this.minChapters = filters.minChapters;
    this.maxChapters = filters.maxChapters;
  }

  /** The genre catalog is an endpoint, so it is read once the form is on screen. */
  override async formDidAppear(): Promise<void> {
    try {
      this.genreOptions = parseGenres(await fetchJson(genresUrl()));
      this.reloadForm();
    } catch {
      // Leave the picker empty rather than failing the whole form.
    }
  }

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section("filters", [
        // The site's own filter is tri-state too — it sends genres as `+id` / `-id`.
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genres,
          items: this.genreOptions,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as HiveToonsAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),

        SelectRow("type", {
          title: "Type",
          layout: "list",
          value: [this.type],
          items: TYPE_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HiveToonsAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),

        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: [this.status],
          items: STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as HiveToonsAdvancedSearchForm,
            "handleStatusChange",
          ),
        }),
      ]),

      Section("chapters", [
        StepperRow("minChapters", {
          title: "Minimum Chapters",
          subtitle: "Zero for no minimum",
          value: this.minChapters,
          minValue: 0,
          maxValue: MAX_CHAPTERS,
          stepValue: CHAPTER_STEP,
          loopOver: false,
          onValueChange: Application.Selector(
            this as HiveToonsAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),

        StepperRow("maxChapters", {
          title: "Maximum Chapters",
          subtitle: "Zero for no maximum",
          value: this.maxChapters,
          minValue: 0,
          maxValue: MAX_CHAPTERS,
          stepValue: CHAPTER_STEP,
          loopOver: false,
          onValueChange: Application.Selector(
            this as HiveToonsAdvancedSearchForm,
            "handleMaxChaptersChange",
          ),
        }),
      ]),
    ];
  }

  override getSearchQueryMetadata(): SearchFilters {
    const selected = Object.entries(this.genres);

    return {
      includedGenres: selected.filter(([, state]) => state === "included").map(([id]) => id),
      excludedGenres: selected.filter(([, state]) => state === "excluded").map(([id]) => id),
      type: this.type,
      status: this.status,
      minChapters: this.minChapters,
      maxChapters: this.maxChapters,
    };
  }

  async handleGenresChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genres = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value[0] ?? "all";
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value[0] ?? "all";
  }

  async handleMinChaptersChange(value: number): Promise<void> {
    this.minChapters = value;
  }

  async handleMaxChaptersChange(value: number): Promise<void> {
    this.maxChapters = value;
  }
}
