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

import { CHAPTER_RANGES, GENRES, STATUSES, type LightNovelWorldSearchMetadata } from "./parser";

const LOGIC_ITEMS = [
  { id: "AND", title: "Match all selected genres" },
  { id: "OR", title: "Match any selected genre" },
];

const STATUS_ITEMS = [
  { id: "all", title: "All" },
  ...STATUSES.map((status) => ({ id: status.id, title: status.label })),
];

const CHAPTER_RANGE_ITEMS = [
  { id: "all", title: "All" },
  ...CHAPTER_RANGES.map((range) => ({ id: range.id, title: range.label })),
];

// Genre and status values are already row-id-safe; chapter_range's "<50"/">1000"
// aren't, so its row ids are resolved back to real values via CHAPTER_RANGES
export class LightNovelWorldSearchForm extends AdvancedSearchForm {
  private genreState: Record<string, "included" | "excluded">;
  private genreLogic: string[];
  private status: string[];
  private chapterRange: string[];

  constructor(query: SearchQuery<Metadata>) {
    super();
    const initial = (query.metadata as LightNovelWorldSearchMetadata | undefined) ?? {};

    const genreState: Record<string, "included" | "excluded"> = {};
    for (const genre of initial.genresInclude ?? []) genreState[genre] = "included";
    for (const genre of initial.genresExclude ?? []) genreState[genre] = "excluded";
    this.genreState = genreState;
    this.genreLogic = [initial.genreLogic ?? "AND"];
    this.status = [initial.status ?? "all"];
    const rangeId = CHAPTER_RANGES.find((range) => range.value === initial.chapterRange)?.id;
    this.chapterRange = [rangeId ?? "all"];
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genreState,
          items: GENRES.map((genre) => ({ id: genre, title: genre.replace("-", " ") })),
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(
            this as LightNovelWorldSearchForm,
            "handleGenreChange",
          ),
        }),
      ]),
      Section("filters", [
        SelectRow("genreLogic", {
          title: "Genre Match",
          layout: "list",
          value: this.genreLogic,
          items: LOGIC_ITEMS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LightNovelWorldSearchForm,
            "handleGenreLogicChange",
          ),
        }),
        SelectRow("status", {
          title: "Status",
          layout: "list",
          value: this.status,
          items: STATUS_ITEMS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LightNovelWorldSearchForm,
            "handleStatusChange",
          ),
        }),
        SelectRow("chapterRange", {
          title: "Chapter Count",
          layout: "list",
          value: this.chapterRange,
          items: CHAPTER_RANGE_ITEMS,
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as LightNovelWorldSearchForm,
            "handleChapterRangeChange",
          ),
        }),
      ]),
    ];
  }

  async handleGenreChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genreState = value;
  }

  async handleGenreLogicChange(value: string[]): Promise<void> {
    this.genreLogic = value;
  }

  async handleStatusChange(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleChapterRangeChange(value: string[]): Promise<void> {
    this.chapterRange = value;
  }

  getSearchQueryMetadata(): Metadata {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const [genre, state] of Object.entries(this.genreState)) {
      (state === "included" ? include : exclude).push(genre);
    }

    const metadata: LightNovelWorldSearchMetadata = {};
    if (include.length > 0) metadata.genresInclude = include;
    if (exclude.length > 0) metadata.genresExclude = exclude;
    if (this.genreLogic[0] === "OR") metadata.genreLogic = "OR";
    if (this.status[0] && this.status[0] !== "all") metadata.status = this.status[0];

    const range = CHAPTER_RANGES.find((r) => r.id === this.chapterRange[0]);
    if (range) metadata.chapterRange = range.value;

    return metadata;
  }
}
