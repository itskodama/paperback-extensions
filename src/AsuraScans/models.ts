/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import type { SortingOption, Tag } from "@paperback/types";

export const ASURA_DOMAIN = "https://asurascans.com";

export type AsuraScansSearchMetadata = {
  genres?: string[];
  status?: string;
  type?: string;
  direction?: string;
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
];

export const SORT_DIRECTIONS: Tag[] = [
  { id: "desc", title: "Descending" },
  { id: "asc", title: "Ascending" },
];

export const SORT_FIELDS: SortingOption[] = [
  { id: "update", label: "Latest Update" },
  { id: "popular", label: "Popularity" },
  { id: "rating", label: "Rating" },
  { id: "newest", label: "Newest" },
  { id: "name", label: "Title" },
];

export function statusLabel(status: string | undefined): string {
  const match = STATUS_OPTIONS.find((option) => option.id === status && option.id !== "all");
  return match ? match.title : "Unknown";
}
