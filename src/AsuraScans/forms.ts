/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import {
  AdvancedSearchForm,
  InputRow,
  Section,
  SelectRow,
  StepperRow,
  type SearchQuery,
} from "@paperback/types";

import {
  GENRES,
  SORT_DIRECTIONS,
  STATUS_OPTIONS,
  TYPE_OPTIONS,
  type AsuraScansSearchMetadata,
} from "./models";

const MAX_MIN_CHAPTERS = 500;

export class AsuraScansAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private status: string;
  private type: string;
  private direction: string;
  private minChapters: number;
  private author: string;
  private artist: string;

  constructor(searchQuery: SearchQuery<AsuraScansSearchMetadata>) {
    super();

    const metadata = searchQuery.metadata;
    this.genres = metadata?.genres ?? [];
    this.status = metadata?.status ?? "all";
    this.type = metadata?.type ?? "all";
    this.direction = metadata?.direction ?? "desc";
    this.minChapters = metadata?.minChapters ?? 0;
    this.author = metadata?.author ?? "";
    this.artist = metadata?.artist ?? "";
  }

  override getSections() {
    return [
      Section("genres", [
        SelectRow("genres", {
          title: "Genres",
          subtitle: "Matches titles in any of the selected genres",
          layout: "flow",
          value: this.genres,
          items: GENRES,
          minItemCount: 0,
          maxItemCount: GENRES.length,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleGenresChange",
          ),
        }),
      ]),

      Section("filters", [
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: [this.status],
          items: STATUS_OPTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleStatusChange",
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
            this as AsuraScansAdvancedSearchForm,
            "handleTypeChange",
          ),
        }),

        SelectRow("direction", {
          title: "Sort Direction",
          layout: "list",
          value: [this.direction],
          items: SORT_DIRECTIONS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleDirectionChange",
          ),
        }),

        StepperRow("minChapters", {
          title: "Minimum Chapters",
          value: this.minChapters,
          minValue: 0,
          maxValue: MAX_MIN_CHAPTERS,
          stepValue: 1,
          loopOver: false,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleMinChaptersChange",
          ),
        }),
      ]),

      Section("credits", [
        InputRow("author", {
          title: "Author",
          value: this.author,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleAuthorChange",
          ),
        }),

        InputRow("artist", {
          title: "Artist",
          value: this.artist,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleArtistChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenresChange(value: string[]): Promise<void> {
    this.genres = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value[0] ?? "all";
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.type = value[0] ?? "all";
  }

  async handleDirectionChange(value: string[]): Promise<void> {
    this.direction = value[0] === "asc" ? "asc" : "desc";
  }

  async handleMinChaptersChange(value: number): Promise<void> {
    this.minChapters = value;
  }

  async handleAuthorChange(value: string): Promise<void> {
    this.author = value;
  }

  async handleArtistChange(value: string): Promise<void> {
    this.artist = value;
  }

  override getSearchQueryMetadata(): AsuraScansSearchMetadata {
    return {
      genres: this.genres.length > 0 ? this.genres : undefined,
      status: this.status !== "all" ? this.status : undefined,
      type: this.type !== "all" ? this.type : undefined,
      direction: this.direction !== "desc" ? this.direction : undefined,
      minChapters: this.minChapters > 0 ? this.minChapters : undefined,
      author: this.author.length > 0 ? this.author : undefined,
      artist: this.artist.length > 0 ? this.artist : undefined,
    };
  }
}
