/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  TriStateSelectRow,
  type FormSectionElement,
  type Metadata,
  type SearchQuery,
} from "@paperback/types";

import { fetchGenres } from "./api";
import {
  CONTENT_RATING_FILTERS,
  SERIES_STATUS_FILTERS,
  SERIES_TYPE_FILTERS,
  type GenreOption,
} from "./types";

export type MangaBakaSearchMetadata = {
  types?: string[];
  statuses?: string[];
  contentRatings?: string[];
  genres?: string[];
  genresExcluded?: string[];
};

export class MangaBakaSearchForm extends AdvancedSearchForm {
  private genres: GenreOption[] = [];
  private genreState: Record<string, "included" | "excluded"> = {};
  private types: string[];
  private statuses: string[];
  private contentRatings: string[];

  private readonly initialMetadata: MangaBakaSearchMetadata;

  // Re-opening the filter sheet passes the applied query back in, so the form reflects
  // it rather than resetting to blank.
  constructor(query: SearchQuery<Metadata>) {
    super();
    this.initialMetadata = (query.metadata as MangaBakaSearchMetadata | undefined) ?? {};
    this.types = [...(this.initialMetadata.types ?? [])];
    this.statuses = [...(this.initialMetadata.statuses ?? [])];
    this.contentRatings = [...(this.initialMetadata.contentRatings ?? [])];

    for (const genre of this.initialMetadata.genres ?? []) this.genreState[genre] = "included";
    for (const genre of this.initialMetadata.genresExcluded ?? []) {
      this.genreState[genre] = "excluded";
    }
  }

  // 46 genres is a workable chip grid. The 2,685-entry tag tree deliberately is not
  // exposed here — see docs/MangaBaka/site-recon.md.
  override async formDidAppear(): Promise<void> {
    if (this.genres.length > 0) return;

    this.genres = await fetchGenres();
    this.reloadForm();
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genreState,
          // MangaBaka's genre `value` slugs (`boys_love`) are already inside the
          // bridge's permitted ID charset, so they are used verbatim as row ids while
          // the human-readable label stays in `title`.
          items: this.genres.map((genre) => ({ id: genre.id, title: genre.title })),
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as MangaBakaSearchForm, "handleGenreChange"),
        }),
      ]),
      Section("filters", [
        SelectRow("types", {
          title: "Type",
          layout: "list",
          value: this.types,
          items: SERIES_TYPE_FILTERS.map((type) => ({ id: type.id, title: type.title })),
          minItemCount: 0,
          maxItemCount: SERIES_TYPE_FILTERS.length,
          onValueChange: Application.Selector(this as MangaBakaSearchForm, "handleTypeChange"),
        }),
        SelectRow("statuses", {
          title: "Status",
          layout: "list",
          value: this.statuses,
          items: SERIES_STATUS_FILTERS.map((status) => ({ id: status.id, title: status.title })),
          minItemCount: 0,
          maxItemCount: SERIES_STATUS_FILTERS.length,
          onValueChange: Application.Selector(this as MangaBakaSearchForm, "handleStatusChange"),
        }),
        SelectRow("content-ratings", {
          title: "Content Rating",
          layout: "list",
          value: this.contentRatings,
          items: CONTENT_RATING_FILTERS.map((rating) => ({ id: rating.id, title: rating.title })),
          minItemCount: 0,
          maxItemCount: CONTENT_RATING_FILTERS.length,
          onValueChange: Application.Selector(
            this as MangaBakaSearchForm,
            "handleContentRatingChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenreChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genreState = value;
  }

  async handleTypeChange(value: string[]): Promise<void> {
    this.types = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.statuses = value;
  }

  async handleContentRatingChange(value: string[]): Promise<void> {
    this.contentRatings = value;
  }

  // Only present keys are assigned: a Metadata property set to undefined crosses the
  // bridge as nil and throws (docs/paperback/bridge.md).
  getSearchQueryMetadata(): Metadata {
    const included: string[] = [];
    const excluded: string[] = [];

    for (const [id, state] of Object.entries(this.genreState)) {
      (state === "included" ? included : excluded).push(id);
    }

    const metadata: MangaBakaSearchMetadata = {};
    if (included.length > 0) metadata.genres = included;
    if (excluded.length > 0) metadata.genresExcluded = excluded;
    if (this.types.length > 0) metadata.types = this.types;
    if (this.statuses.length > 0) metadata.statuses = this.statuses;
    if (this.contentRatings.length > 0) metadata.contentRatings = this.contentRatings;

    return metadata;
  }
}
