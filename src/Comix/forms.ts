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

import { DEFAULT_SORT, SORT_OPTIONS } from "./models.ts";

export type ComixSearchMetadata = {
  sort?: string;
  page?: number;
};

const CONTENT_RATING_ITEMS = [
  { id: "safe", title: "Safe" },
  { id: "suggestive", title: "Suggestive" },
  { id: "erotica", title: "Erotica" },
];

/**
 * Row ids must stay within the platform's restricted charset — the site's own
 * sort values contain a colon (`chapter_updated_at:desc`), so they are never used
 * as ids, only as row *values*. See docs/paperback/forms.md.
 */
export class ComixSearchForm extends AdvancedSearchForm {
  private sort: string[];
  private contentRatings: string[];

  constructor(query: SearchQuery<Metadata>) {
    super();
    const metadata = (query.metadata as ComixSearchMetadata | undefined) ?? {};
    this.sort = [metadata.sort ?? DEFAULT_SORT];
    this.contentRatings = ["safe", "suggestive"];
  }

  getSections(): FormSectionElement<unknown>[] {
    return [
      Section("sort", [
        SelectRow("sortOrder", {
          title: "Sort by",
          value: this.sort,
          minItemCount: 1,
          maxItemCount: 1,
          options: SORT_OPTIONS.map((option) => ({ id: option.id, title: option.title })),
          onValueChange: Application.Selector(this as ComixSearchForm, "setSort"),
        }),
      ]),
      Section("filters", [
        SelectRow("contentRating", {
          title: "Content rating",
          value: this.contentRatings,
          minItemCount: 1,
          maxItemCount: CONTENT_RATING_ITEMS.length,
          options: CONTENT_RATING_ITEMS,
          onValueChange: Application.Selector(this as ComixSearchForm, "setContentRatings"),
        }),
      ]),
    ];
  }

  async setSort(value: string[]): Promise<void> {
    this.sort = value;
  }

  async setContentRatings(value: string[]): Promise<void> {
    this.contentRatings = value;
  }

  // Metadata crosses the Swift bridge, where `undefined` inside the object is a
  // crash rather than an omission — every field here is always populated.
  getSearchQueryMetadata(): Metadata {
    return {
      sort: this.sort[0] ?? DEFAULT_SORT,
      contentRatings: this.contentRatings.length > 0 ? this.contentRatings : ["safe"],
      page: 1,
    };
  }
}
