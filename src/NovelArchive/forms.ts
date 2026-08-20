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

import { apiRequest } from "./network.ts";
import { toGenreOptions, type GenreOption, type GenresResponse } from "./parser.ts";

export type NovelArchiveSearchMetadata = {
  genresInclude?: string[];
  genresExclude?: string[];
  genreMatch?: "all" | "any";
  status?: string;
};

const STATUS_ITEMS = [
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
];

const MATCH_ITEMS = [
  { id: "all", title: "Match all selected genres" },
  { id: "any", title: "Match any selected genre" },
];

// novelarchive.cc's own filter panel presents genres as a single set of tri-state
// chips (neutral / include / exclude); @paperback/types' TriStateSelectRow is the
// exact primitive for that, so this form doesn't need the two-separate-multiselect
// workaround an older SDK would have forced
export class NovelArchiveSearchForm extends AdvancedSearchForm {
  private genres: GenreOption[] = [];
  private genreState: Record<string, "included" | "excluded"> = {};
  private status: string[];
  private genreMatch: string[];
  private readonly initialMetadata: NovelArchiveSearchMetadata;

  // Re-opening the filter sheet passes the currently-applied query back in, so the
  // form should reflect it rather than always starting blank
  constructor(query: SearchQuery<Metadata>) {
    super();
    this.initialMetadata = (query.metadata as NovelArchiveSearchMetadata | undefined) ?? {};
    this.status = [this.initialMetadata.status ?? "all"];
    this.genreMatch = [this.initialMetadata.genreMatch ?? "all"];
  }

  override async formDidAppear(): Promise<void> {
    if (this.genres.length > 0) return;
    const response = await apiRequest<GenresResponse>("/novels/genres");
    this.genres = toGenreOptions(response);

    const idByValue = new Map(this.genres.map((genre) => [genre.value, genre.id]));
    const genreState: Record<string, "included" | "excluded"> = {};
    for (const value of this.initialMetadata.genresInclude ?? []) {
      const id = idByValue.get(value);
      if (id) genreState[id] = "included";
    }
    for (const value of this.initialMetadata.genresExclude ?? []) {
      const id = idByValue.get(value);
      if (id) genreState[id] = "excluded";
    }
    this.genreState = genreState;

    this.reloadForm();
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genreState,
          items: this.genres.map((genre) => ({ id: genre.id, title: genre.label })),
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as NovelArchiveSearchForm, "handleGenreChange"),
        }),
      ]),
      Section("filters", [
        SelectRow("genreMatch", {
          title: "Genre Match",
          layout: "list",
          value: this.genreMatch,
          items: MATCH_ITEMS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as NovelArchiveSearchForm,
            "handleGenreMatchChange",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUS_ITEMS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(this as NovelArchiveSearchForm, "handleStatusChange"),
        }),
      ]),
    ];
  }

  async handleGenreChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genreState = value;
  }

  async handleGenreMatchChange(value: string[]): Promise<void> {
    this.genreMatch = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  // Row ids are the charset-safe slug (spaces replaced with `_`, see parser.ts);
  // resolve back to the real API genre value by lookup rather than re-deriving the
  // transform, per forms.md's guidance
  getSearchQueryMetadata(): Metadata {
    const valueById = new Map(this.genres.map((genre) => [genre.id, genre.value]));

    const include: string[] = [];
    const exclude: string[] = [];
    for (const [id, state] of Object.entries(this.genreState)) {
      const value = valueById.get(id);
      if (!value) continue;
      (state === "included" ? include : exclude).push(value);
    }

    const metadata: NovelArchiveSearchMetadata = {};
    if (include.length > 0) metadata.genresInclude = include;
    if (exclude.length > 0) metadata.genresExclude = exclude;
    if (this.genreMatch[0] === "any") metadata.genreMatch = "any";
    if (this.status[0] && this.status[0] !== "all") metadata.status = this.status[0];

    return metadata;
  }
}
