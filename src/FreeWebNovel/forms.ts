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

import { safeId } from "./html.ts";
import {
  CHAPTER_BANDS,
  CONTENT_RATINGS,
  FILTER_ANY,
  GENRES,
  GENRE_MATCHES,
  LANGUAGES,
  MIN_RATINGS,
  STATUSES,
  UPDATED_WINDOWS,
  type SearchFilters,
} from "./models.ts";

type GenreState = Record<string, "included" | "excluded">;

/** Row ids are slugged — "Slice of Life" is not a legal id. */
const GENRE_ITEMS = GENRES.map((genre) => ({ id: safeId(genre), title: genre }));
const GENRE_BY_ID = new Map(GENRES.map((genre) => [safeId(genre), genre]));

function items(vocabulary: { id: string; label: string }[]) {
  return vocabulary.map((entry) => ({ id: entry.id, title: entry.label }));
}

/**
 * The site's own `/search-adv` panel, mapped one-to-one.
 *
 * The genre vocabulary is static, so unlike NovelArchive's form this one needs no
 * `formDidAppear` fetch — it renders completely from synchronous state on first
 * paint, which is the lowest-risk shape a form can have.
 *
 * The one thing the site cannot do is include and exclude at once: `genre_match`
 * is a single mode for the whole selected set. Inclusions are sent to the server
 * and exclusions are applied to the results afterwards; see `mappers.ts`.
 */
export class FreeWebNovelSearchForm extends AdvancedSearchForm {
  private genreState: GenreState;
  private genreMatch: string[];
  private languages: string[];
  private status: string[];
  private chapters: string[];
  private rating: string[];
  private lastUpdated: string[];
  private contentRating: string[];

  // Re-opening the sheet passes the applied query back in, so the form reflects it
  // rather than always starting blank.
  constructor(query: SearchQuery<Metadata>) {
    super();
    const applied = (query.metadata as SearchFilters | undefined) ?? {};

    const genreState: GenreState = {};
    for (const genre of applied.genresInclude ?? []) genreState[safeId(genre)] = "included";
    for (const genre of applied.genresExclude ?? []) genreState[safeId(genre)] = "excluded";
    this.genreState = genreState;

    this.genreMatch = [applied.genreMatch ?? "all"];
    this.languages = applied.languages ?? [];
    this.status = [applied.status ?? FILTER_ANY];
    this.chapters = [applied.chapters ?? FILTER_ANY];
    this.rating = [applied.rating ?? FILTER_ANY];
    this.lastUpdated = [applied.lastUpdated ?? FILTER_ANY];
    this.contentRating = [applied.contentRating ?? FILTER_ANY];
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("genres", [
        TriStateSelectRow("genres", {
          title: "Genres",
          layout: "flow",
          value: this.genreState,
          items: GENRE_ITEMS,
          allowExclusion: true,
          allowEmptySelection: true,
          onValueChange: Application.Selector(this as FreeWebNovelSearchForm, "handleGenres"),
        }),
        this.single(
          "genreMatch",
          "Genre Match",
          this.genreMatch,
          GENRE_MATCHES,
          "handleGenreMatch",
        ),
      ]),
      Section("language", [
        SelectRow("languages", {
          title: "Original Language",
          layout: "flow",
          value: this.languages,
          items: items(LANGUAGES),
          minItemCount: 0,
          maxItemCount: LANGUAGES.length,
          onValueChange: Application.Selector(this as FreeWebNovelSearchForm, "handleLanguages"),
        }),
      ]),
      Section("filters", [
        this.single("status", "Status", this.status, STATUSES, "handleStatus"),
        this.single("chapters", "Chapters", this.chapters, CHAPTER_BANDS, "handleChapters"),
        this.single("rating", "Minimum Rating", this.rating, MIN_RATINGS, "handleRating"),
        this.single("lastUpdated", "Updated", this.lastUpdated, UPDATED_WINDOWS, "handleUpdated"),
        this.single(
          "contentRating",
          "Content Rating",
          this.contentRating,
          CONTENT_RATINGS,
          "handleContentRating",
        ),
      ]),
    ];
  }

  private single(
    id: string,
    title: string,
    value: string[],
    vocabulary: { id: string; label: string }[],
    handler:
      | "handleGenreMatch"
      | "handleStatus"
      | "handleChapters"
      | "handleRating"
      | "handleUpdated"
      | "handleContentRating",
  ) {
    return SelectRow(id, {
      title,
      layout: "list",
      value,
      items: items(vocabulary),
      minItemCount: 1,
      maxItemCount: 1,
      onValueChange: Application.Selector(this as FreeWebNovelSearchForm, handler),
    });
  }

  async handleGenres(value: GenreState): Promise<void> {
    this.genreState = value;
  }

  async handleGenreMatch(value: string[]): Promise<void> {
    this.genreMatch = value;
  }

  async handleLanguages(value: string[]): Promise<void> {
    this.languages = value;
  }

  async handleStatus(value: string[]): Promise<void> {
    this.status = value;
  }

  async handleChapters(value: string[]): Promise<void> {
    this.chapters = value;
  }

  async handleRating(value: string[]): Promise<void> {
    this.rating = value;
  }

  async handleUpdated(value: string[]): Promise<void> {
    this.lastUpdated = value;
  }

  async handleContentRating(value: string[]): Promise<void> {
    this.contentRating = value;
  }

  /**
   * Only keys that have a value are assigned — an `undefined` inside a `Metadata`
   * crashes on device, and this return value is a `Metadata`.
   */
  getSearchQueryMetadata(): Metadata {
    const include: string[] = [];
    const exclude: string[] = [];
    for (const [id, state] of Object.entries(this.genreState)) {
      // Resolve by lookup rather than re-deriving the slug transform.
      const genre = GENRE_BY_ID.get(id);
      if (!genre) continue;
      (state === "included" ? include : exclude).push(genre);
    }

    const filters: SearchFilters = {};
    if (include.length > 0) filters.genresInclude = include;
    if (exclude.length > 0) filters.genresExclude = exclude;
    if (this.genreMatch[0] === "any") filters.genreMatch = "any";
    if (this.languages.length > 0) filters.languages = this.languages;

    assign(filters, "status", this.status[0]);
    assign(filters, "chapters", this.chapters[0]);
    assign(filters, "rating", this.rating[0]);
    assign(filters, "lastUpdated", this.lastUpdated[0]);
    assign(filters, "contentRating", this.contentRating[0]);

    return filters;
  }
}

type ScalarFilter = "status" | "chapters" | "rating" | "lastUpdated" | "contentRating";

function assign(filters: SearchFilters, key: ScalarFilter, value: string | undefined): void {
  if (value && value !== FILTER_ANY) filters[key] = value;
}
