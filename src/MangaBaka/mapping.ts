/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Turning a MangaBaka {@link Series} into the types Paperback renders. */

// Extension-ful imports: the unit tests load these under Node's own resolver.
import { ContentRating } from "@paperback/types";
import type {
  MangaInfo,
  SearchResultItem,
  SimpleCarouselItem,
  SourceManga,
  Tag,
  TagSection,
} from "@paperback/types";

import { count, isText, positive, str } from "./decode.ts";
import { DEFAULT_TITLE_PREFERENCE, primaryTitle, secondaryTitles } from "./titles.ts";
import type { TitlePreference } from "./titles.ts";
import {
  CONTENT_RATINGS,
  SERIES_STATUS_LABELS,
  SERIES_TYPE_LABELS,
  SITE_BASE,
  type CoverField,
  type CoverVariantField,
  type GenreOption,
  type GenresResponse,
  type Series,
  type SeriesContentRating,
} from "./types.ts";

/** A brand-new entry's cover is all nulls, and "" is not a valid URL on the Swift side. */
export const PLACEHOLDER_COVER = "https://mangabaka.org/images/logo.png";

// Formatting

/** An id outside the bridge's charset throws on device. See docs/paperback/forms.md. */
export function toId(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");

  return sanitized.length > 0 ? sanitized : "unknown";
}

/** `boys_love` → `Boys Love`. Avoids a genre-catalog fetch just to render a chip. */
export function humanizeSlug(slug: string): string {
  return slug
    .split(/[_\s-]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Off-grid scores are unreachable again once the stepper snaps back. */
export function snapRating(value: number, steps: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;

  const increment = Number.isFinite(steps) && steps > 0 ? steps : 1;
  const snapped = Math.round(value / increment) * increment;

  return Math.min(Math.max(snapped, 0), 100);
}

function label(value: unknown, labels: Record<string, string>): string | undefined {
  const slug = str(value);
  return slug === undefined ? undefined : (labels[slug] ?? humanizeSlug(slug));
}

// Series

/** Retired ids point at their survivor. A tracker stores ids long-term, so follow it. */
export function mergedTargetId(series: Series): string | undefined {
  if (series.state !== "merged") return undefined;
  const target = positive(series.merged_with);
  return target === undefined ? undefined : String(target);
}

export function contentRatingOf(series: Series): ContentRating {
  const rating = series.content_rating;
  if (isText(rating) && rating in CONTENT_RATINGS) {
    return CONTENT_RATINGS[rating as SeriesContentRating];
  }
  // The catalog reaches pornographic, so guessing low is the dangerous direction.
  return ContentRating.MATURE;
}

/** Only `novel` maps to Paperback's novel reader. */
export function contentTypeOf(series: Series): "comic" | "novel" {
  return series.type === "novel" ? "novel" : "comic";
}

export function seriesUrl(series: Series): string {
  return `${SITE_BASE}/${series.id}`;
}

// Covers

function rawCoverUrl(field: CoverField | undefined): string | undefined {
  if (typeof field === "string") return str(field);
  if (field && typeof field === "object") return str(field.url);
  return undefined;
}

function variantCoverUrl(field: CoverVariantField | undefined): string | undefined {
  if (typeof field === "string") return str(field);
  if (field && typeof field === "object") return str(field.x2) ?? str(field.x1) ?? str(field.x3);
  return undefined;
}

/** Thumbnails use a sized proxy variant, detail art the original. */
export function coverUrl(series: Series, size: "thumbnail" | "full"): string | undefined {
  const cover = series.cover;
  if (!cover) return undefined;

  const sized =
    variantCoverUrl(cover.x250) ?? variantCoverUrl(cover.x350) ?? variantCoverUrl(cover.x150);
  const raw = rawCoverUrl(cover.raw);

  return size === "full" ? (raw ?? sized) : (sized ?? raw);
}

/** As {@link coverUrl}, but always a usable URL. */
export function coverUrlOrPlaceholder(series: Series, size: "thumbnail" | "full"): string {
  return coverUrl(series, size) ?? PLACEHOLDER_COVER;
}

// Paperback types

export function tagSections(series: Series): TagSection[] {
  const sections: TagSection[] = [];

  const genres = (series.genres ?? []).filter(isText);
  if (genres.length > 0) {
    sections.push({
      id: "genres",
      title: "Genres",
      tags: genres.map((genre): Tag => ({ id: toId(genre), title: humanizeSlug(genre) })),
    });
  }

  const tags = (series.tags ?? []).filter(isText);
  if (tags.length > 0) {
    sections.push({
      id: "tags",
      title: "Tags",
      tags: tags.map((tag): Tag => ({ id: toId(tag), title: tag })),
    });
  }

  return sections;
}

export function toMangaInfo(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): MangaInfo {
  const info: MangaInfo = {
    primaryTitle: primaryTitle(series, preference),
    secondaryTitles: secondaryTitles(series, preference),
    thumbnailUrl: coverUrlOrPlaceholder(series, "full"),
    synopsis: str(series.description) ?? "",
    contentRating: contentRatingOf(series),
    contentType: contentTypeOf(series),
    shareUrl: seriesUrl(series),
  };

  const status = label(series.status, SERIES_STATUS_LABELS);
  if (status) info.status = status;

  const author = (series.authors ?? []).filter(isText).join(", ");
  if (author.length > 0) info.author = author;

  const artist = (series.artists ?? []).filter(isText).join(", ");
  if (artist.length > 0) info.artist = artist;

  // Paperback expects a 0-1 fraction; MangaBaka's scale is 0-100.
  const rating = positive(series.rating);
  if (rating !== undefined) info.rating = Math.min(rating / 100, 1);

  const tags = tagSections(series);
  if (tags.length > 0) info.tagGroups = tags;

  const additionalInfo = buildAdditionalInfo(series);
  if (Object.keys(additionalInfo).length > 0) info.additionalInfo = additionalInfo;

  return info;
}

function buildAdditionalInfo(series: Series): Record<string, string> {
  const info: Record<string, string> = {};

  const type = label(series.type, SERIES_TYPE_LABELS);
  if (type) info.Type = type;

  const year = positive(series.year);
  if (year !== undefined) info.Year = String(year);

  const chapters = count(series.total_chapters);
  if (chapters !== undefined) info.Chapters = String(chapters);

  const volumes = count(series.final_volume);
  if (volumes !== undefined) info.Volumes = String(volumes);

  return info;
}

export function toSourceManga(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): SourceManga {
  return { mangaId: String(series.id), mangaInfo: toMangaInfo(series, preference) };
}

export function toSearchResultItem(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): SearchResultItem {
  const item: SearchResultItem = {
    mangaId: String(series.id),
    title: primaryTitle(series, preference),
    imageUrl: coverUrlOrPlaceholder(series, "thumbnail"),
    contentRating: contentRatingOf(series),
  };

  const subtitle = resultSubtitle(series);
  if (subtitle) item.subtitle = subtitle;

  return item;
}

export function toSimpleCarouselItem(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): SimpleCarouselItem {
  const item: SimpleCarouselItem = {
    type: "simpleCarouselItem",
    mangaId: String(series.id),
    title: primaryTitle(series, preference),
    imageUrl: coverUrlOrPlaceholder(series, "thumbnail"),
    contentRating: contentRatingOf(series),
  };

  const subtitle = resultSubtitle(series);
  if (subtitle) item.subtitle = subtitle;

  return item;
}

/** A manga, its novel and its spin-offs share a title; type and year separate them. */
export function resultSubtitle(series: Series): string | undefined {
  const parts: string[] = [];

  const type = label(series.type, SERIES_TYPE_LABELS);
  if (type) parts.push(type);

  const year = positive(series.year);
  if (year !== undefined) parts.push(String(year));

  return parts.length > 0 ? parts.join(" • ") : undefined;
}

export function toGenreOptions(response: GenresResponse): GenreOption[] {
  const options: GenreOption[] = [];

  for (const genre of response) {
    const value = str(genre.value);
    if (value === undefined) continue;
    options.push({ id: value, title: str(genre.label) ?? humanizeSlug(value) });
  }

  return options;
}
