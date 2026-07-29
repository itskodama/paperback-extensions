/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import type { Tag } from "@paperback/types";

export const ASURA_DOMAIN = "https://asurascans.com";
export const ASURA_API = "https://api.asurascans.com";

export type AsuraScansSearchMetadata = {
  genres?: string[];
  status?: string;
  type?: string;
  minChapters?: number;
  author?: string;
  artist?: string;
};

export const GENRES: Tag[] = [
  { id: "action", title: "Action" },
  { id: "adventure", title: "Adventure" },
  { id: "comedy", title: "Comedy" },
  { id: "crazy-mc", title: "Crazy MC" },
  { id: "demon", title: "Demon" },
  { id: "drama", title: "Drama" },
  { id: "dungeons", title: "Dungeons" },
  { id: "fantasy", title: "Fantasy" },
  { id: "game", title: "Game" },
  { id: "genius-mc", title: "Genius MC" },
  { id: "isekai", title: "Isekai" },
  { id: "kuchikuchi", title: "Kuchikuchi" },
  { id: "magic", title: "Magic" },
  { id: "martial-arts", title: "Martial Arts" },
  { id: "murim", title: "Murim" },
  { id: "mystery", title: "Mystery" },
  { id: "necromancer", title: "Necromancer" },
  { id: "overpowered", title: "Overpowered" },
  { id: "psychological", title: "Psychological" },
  { id: "regression", title: "Regression" },
  { id: "reincarnation", title: "Reincarnation" },
  { id: "revenge", title: "Revenge" },
  { id: "romance", title: "Romance" },
  { id: "school-life", title: "School Life" },
  { id: "sci-fi", title: "Sci-fi" },
  { id: "shoujo", title: "Shoujo" },
  { id: "shounen", title: "Shounen" },
  { id: "system", title: "System" },
  { id: "tower", title: "Tower" },
  { id: "tragedy", title: "Tragedy" },
  { id: "villain", title: "Villain" },
  { id: "violence", title: "Violence" },
];

export const STATUS_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "ongoing", title: "Ongoing" },
  { id: "completed", title: "Completed" },
  { id: "hiatus", title: "Hiatus" },
  { id: "dropped", title: "Dropped" },
  { id: "axed", title: "Axed" },
];

export const TYPE_OPTIONS: Tag[] = [
  { id: "all", title: "All" },
  { id: "manhwa", title: "Manhwa" },
  { id: "manhua", title: "Manhua" },
  { id: "manga", title: "Manga" },
  { id: "novel", title: "Novel" },
];

// Asura's browse needs a field (`sort`) and a direction (`order`); Paperback's sort control models
// one flat list, so field and direction are combined into a single option each
export type SortOption = { id: string; label: string; sort: string; direction: string };

const TITLE_ASC: SortOption = {
  id: "title-asc",
  label: "Title — A to Z",
  sort: "name",
  direction: "asc",
};

export const SORT_OPTIONS: SortOption[] = [
  TITLE_ASC,
  { id: "title-desc", label: "Title — Z to A", sort: "name", direction: "desc" },
  { id: "update", label: "Latest Update", sort: "update", direction: "desc" },
  { id: "popular", label: "Popularity", sort: "popular", direction: "desc" },
  { id: "rating-desc", label: "Rating — High to Low", sort: "rating", direction: "desc" },
  { id: "rating-asc", label: "Rating — Low to High", sort: "rating", direction: "asc" },
  { id: "newest", label: "Newest", sort: "newest", direction: "desc" },
  { id: "oldest", label: "Oldest", sort: "newest", direction: "asc" },
];

// The default when the user has not chosen a sort
export const DEFAULT_SORT = TITLE_ASC;

// The novel search API's sort keywords differ from comics' own SORT_OPTIONS[].sort values —
// confirmed via Asura's own BrowseFilters.js; order/direction is shared as-is
export const NOVEL_SORT_MAP: Record<string, string> = {
  name: "title",
  update: "latest",
  popular: "popular",
  rating: "rating",
  newest: "newest",
};

export function statusLabel(status: string | undefined): string {
  const match = STATUS_OPTIONS.find((option) => option.id === status && option.id !== "all");
  return match ? match.title : "Unknown";
}
