/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import {
  AdvancedSearchForm,
  Section,
  SelectRow,
  StepperRow,
  type SearchQuery,
} from "@paperback/types";

import { GENRES, STATUS_OPTIONS, TYPE_OPTIONS, type AsuraScansSearchMetadata } from "./models";
import { fetchCreators, type Creators } from "./network";

const MAX_MIN_CHAPTERS = 500;

const AUTHOR_PREFIX = "author:";
const ARTIST_PREFIX = "artist:";

export class AsuraScansAdvancedSearchForm extends AdvancedSearchForm {
  private genres: string[];
  private status: string;
  private type: string;
  private minChapters: number;
  private author: string;
  private artist: string;
  private creators: Creators = { authors: [], artists: [] };

  constructor(searchQuery: SearchQuery<AsuraScansSearchMetadata>) {
    super();

    const metadata = searchQuery.metadata;
    this.genres = metadata?.genres ?? [];
    this.status = metadata?.status ?? "all";
    this.type = metadata?.type ?? "all";
    this.minChapters = metadata?.minChapters ?? 0;
    this.author = metadata?.author ?? "";
    this.artist = metadata?.artist ?? "";
  }

  // Asura draws the creator list from its API rather than a free-text box
  override async formDidAppear(): Promise<void> {
    try {
      this.creators = await fetchCreators();
      this.reloadForm();
    } catch {
      // Leave the creator picker empty if the list cannot be loaded
    }
  }

  override getSections() {
    // One combined single-select list; the role suffix and id keep authors and artists apart
    const creatorItems = [
      ...this.creators.authors.map((name) => ({
        id: `${AUTHOR_PREFIX}${name}`,
        title: `${name} (Author)`,
      })),
      ...this.creators.artists.map((name) => ({
        id: `${ARTIST_PREFIX}${name}`,
        title: `${name} (Artist)`,
      })),
    ].sort((a, b) => a.title.localeCompare(b.title));

    const selectedCreator = this.author
      ? `${AUTHOR_PREFIX}${this.author}`
      : this.artist
        ? `${ARTIST_PREFIX}${this.artist}`
        : undefined;

    return [
      Section("filters", [
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

        SelectRow("type", {
          title: "Comic Type",
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

        SelectRow("creator", {
          title: "Creator",
          subtitle: "A single author or artist",
          layout: "list",
          value: selectedCreator ? [selectedCreator] : [],
          items: creatorItems,
          minItemCount: 0,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as AsuraScansAdvancedSearchForm,
            "handleCreatorChange",
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

  async handleMinChaptersChange(value: number): Promise<void> {
    this.minChapters = value;
  }

  // A creator is one author or one artist; picking either clears the other
  async handleCreatorChange(value: string[]): Promise<void> {
    const pick = value[0];
    if (pick?.startsWith(AUTHOR_PREFIX)) {
      this.author = pick.slice(AUTHOR_PREFIX.length);
      this.artist = "";
    } else if (pick?.startsWith(ARTIST_PREFIX)) {
      this.artist = pick.slice(ARTIST_PREFIX.length);
      this.author = "";
    } else {
      this.author = "";
      this.artist = "";
    }
  }

  // Metadata reaches the app as a raw JSValue, where an undefined property becomes nil and throws
  override getSearchQueryMetadata(): AsuraScansSearchMetadata {
    const metadata: AsuraScansSearchMetadata = {};

    if (this.genres.length > 0) metadata.genres = this.genres;
    if (this.status !== "all") metadata.status = this.status;
    if (this.type !== "all") metadata.type = this.type;
    if (this.minChapters > 0) metadata.minChapters = this.minChapters;
    if (this.author.length > 0) metadata.author = this.author;
    if (this.artist.length > 0) metadata.artist = this.artist;

    return metadata;
  }
}
