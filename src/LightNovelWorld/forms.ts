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

import { GENRES, type LightNovelWorldSearchMetadata } from "./parser";

const LOGIC_ITEMS = [
  { id: "AND", title: "Match all selected genres" },
  { id: "OR", title: "Match any selected genre" },
];

// Genre values are already row-id-safe (hyphenated, no spaces), so they double
// directly as row ids — unlike NovelArchive's genre catalog, no id<->value
// lookup table is needed here. `status` has no row here at all: verified
// non-functional server-side (docs/LightNovelWorld/site-recon.md).
export class LightNovelWorldSearchForm extends AdvancedSearchForm {
  private genreState: Record<string, "included" | "excluded">;
  private genreLogic: string[];

  constructor(query: SearchQuery<Metadata>) {
    super();
    const initial = (query.metadata as LightNovelWorldSearchMetadata | undefined) ?? {};

    const genreState: Record<string, "included" | "excluded"> = {};
    for (const genre of initial.genresInclude ?? []) genreState[genre] = "included";
    for (const genre of initial.genresExclude ?? []) genreState[genre] = "excluded";
    this.genreState = genreState;
    this.genreLogic = [initial.genreLogic ?? "AND"];
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
      ]),
    ];
  }

  async handleGenreChange(value: Record<string, "included" | "excluded">): Promise<void> {
    this.genreState = value;
  }

  async handleGenreLogicChange(value: string[]): Promise<void> {
    this.genreLogic = value;
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

    return metadata;
  }
}
