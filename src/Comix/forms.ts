/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  type FormSectionElement,
  type Metadata,
  type SearchQuery,
} from "@paperback/types";

import {
  CONTENT_RATINGS,
  DEFAULT_SORT,
  DEMOGRAPHICS,
  FORMATS,
  GENRES,
  SORT_OPTIONS,
  STATUSES,
  TYPES,
} from "./models.ts";

export type ComixSearchMetadata = {
  sort: string;
  contentRatings: string[];
  types: string[];
  statuses: string[];
  demographics: string[];
  genres: string[];
  formats: string[];
  genresMode: string;
};

const GENRE_MODES = [
  { id: "and", title: "Match all selected" },
  { id: "or", title: "Match any selected" },
];

export const DEFAULT_SEARCH_METADATA: ComixSearchMetadata = {
  sort: DEFAULT_SORT,
  contentRatings: ["safe", "suggestive"],
  types: [],
  statuses: [],
  demographics: [],
  genres: [],
  formats: [],
  genresMode: "and",
};

/**
 * Row ids stay alphanumeric: the site's own values contain colons and digits
 * (`chapter_updated_at:desc`, genre id `87264`) and are used as option ids and
 * row *values*, never as row ids. See docs/paperback/forms.md.
 */
export class ComixSearchForm extends AdvancedSearchForm {
  private state: ComixSearchMetadata;

  constructor(query: SearchQuery<Metadata>) {
    super();
    const incoming = query.metadata as Partial<ComixSearchMetadata> | undefined;
    this.state = { ...DEFAULT_SEARCH_METADATA, ...incoming };
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("ordering", [
        SelectRow("sortOrder", {
          title: "Sort by",
          value: [this.state.sort],
          minItemCount: 1,
          maxItemCount: 1,
          options: SORT_OPTIONS.map((option) => ({ id: option.id, title: option.title })),
          onValueChange: Application.Selector(this as ComixSearchForm, "setSort"),
        }),
      ]),
      Section("audience", [
        this.multi(
          "contentRating",
          "Content rating",
          CONTENT_RATINGS,
          this.state.contentRatings,
          "setContentRatings",
        ),
        this.multi(
          "demographic",
          "Demographic",
          DEMOGRAPHICS,
          this.state.demographics,
          "setDemographics",
        ),
      ]),
      Section("work", [
        this.multi("type", "Type", TYPES, this.state.types, "setTypes"),
        this.multi("status", "Status", STATUSES, this.state.statuses, "setStatuses"),
        this.multi("format", "Format", FORMATS, this.state.formats, "setFormats"),
      ]),
      Section("genres", [
        this.multi("genre", "Genres", GENRES, this.state.genres, "setGenres"),
        SelectRow("genreMode", {
          title: "Genre matching",
          value: [this.state.genresMode],
          minItemCount: 1,
          maxItemCount: 1,
          options: GENRE_MODES,
          onValueChange: Application.Selector(this as ComixSearchForm, "setGenresMode"),
        }),
      ]),
    ];
  }

  private multi(
    id: string,
    title: string,
    options: ReadonlyArray<{ id: string; title: string }>,
    value: string[],
    handler:
      | "setContentRatings"
      | "setDemographics"
      | "setTypes"
      | "setStatuses"
      | "setFormats"
      | "setGenres",
  ): ReturnType<typeof SelectRow> {
    return SelectRow(id, {
      title,
      value,
      minItemCount: 0,
      maxItemCount: options.length,
      options: options.map((option) => ({ id: option.id, title: option.title })),
      onValueChange: Application.Selector(this as ComixSearchForm, handler),
    });
  }

  async setSort(value: string[]): Promise<void> {
    this.state = { ...this.state, sort: value[0] ?? DEFAULT_SORT };
  }

  async setGenresMode(value: string[]): Promise<void> {
    this.state = { ...this.state, genresMode: value[0] ?? "and" };
  }

  async setContentRatings(value: string[]): Promise<void> {
    this.state = { ...this.state, contentRatings: value };
  }

  async setDemographics(value: string[]): Promise<void> {
    this.state = { ...this.state, demographics: value };
  }

  async setTypes(value: string[]): Promise<void> {
    this.state = { ...this.state, types: value };
  }

  async setStatuses(value: string[]): Promise<void> {
    this.state = { ...this.state, statuses: value };
  }

  async setFormats(value: string[]): Promise<void> {
    this.state = { ...this.state, formats: value };
  }

  async setGenres(value: string[]): Promise<void> {
    this.state = { ...this.state, genres: value };
  }

  // Metadata crosses the Swift bridge, where `undefined` inside the object is a
  // crash rather than an omission, so every field is always populated.
  getSearchQueryMetadata(): Metadata {
    return { ...this.state } as unknown as Metadata;
  }
}
