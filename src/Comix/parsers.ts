/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type SearchResultItem,
  type SourceManga,
} from "@paperback/types";

import {
  DOMAIN,
  SAFE_CONTENT_RATING,
  type ChapterItem,
  type ChapterPayload,
  type Hid,
  type MangaDetail,
  type MangaSummary,
  type PagesPayload,
  type Taxon,
} from "./models.ts";

const INITIAL_DATA = /<script[^>]*id="initial-data"[^>]*>([\s\S]*?)<\/script>/;

export type InitialData = Record<string, unknown>;

/**
 * Bundling an HTML parser costs ~280 KB against a ~20 KB budget (see
 * docs/paperback/runtime.md), so the single script tag is cut out by regex and
 * everything downstream works on the JSON.
 */
export function extractInitialData(html: string): InitialData {
  const match = INITIAL_DATA.exec(html);
  if (!match?.[1]) throw new Error("Comix: page carried no initial-data payload");

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    throw new Error("Comix: initial-data was not valid JSON");
  }

  const queries = (parsed as { queries?: unknown } | null)?.queries;
  if (!queries || typeof queries !== "object") {
    throw new Error("Comix: initial-data carried no queries");
  }
  return queries as InitialData;
}

/**
 * Query keys are JSON arrays serialised as strings, so a caller matches on the
 * decoded array rather than substring-matching the raw key.
 */
export function findQuery(queries: InitialData, matches: (key: unknown[]) => boolean): unknown {
  for (const [rawKey, value] of Object.entries(queries)) {
    let key: unknown;
    try {
      key = JSON.parse(rawKey);
    } catch {
      continue;
    }
    if (Array.isArray(key) && matches(key)) return value;
  }
  return undefined;
}

/**
 * `["manga","top",…]` yields a bare array while `["manga","list",…]` yields
 * `{items}` — assuming either one alone silently drops whole discover sections.
 */
export function queryItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const items = (value as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? items : [];
}

function isSummary(value: unknown): value is MangaSummary {
  const candidate = value as MangaSummary | null;
  return typeof candidate?.hid === "string" && typeof candidate.title === "string";
}

export function mangaSummaries(value: unknown): MangaSummary[] {
  return queryItems(value).filter(isSummary);
}

export function posterUrl(manga: MangaSummary): string {
  return manga.poster?.large ?? manga.poster?.medium ?? "";
}

export function contentRatingOf(manga: MangaSummary): ContentRating {
  return manga.contentRating === SAFE_CONTENT_RATING
    ? ContentRating.EVERYONE
    : ContentRating.MATURE;
}

export function toSearchResultItem(manga: MangaSummary): SearchResultItem {
  return {
    mangaId: manga.hid,
    title: manga.title,
    subtitle: manga.latestChapter ? `Chapter ${manga.latestChapter}` : undefined,
    imageUrl: posterUrl(manga),
    contentRating: contentRatingOf(manga),
  };
}

function titles(taxa: Taxon[] | undefined): string[] {
  return (taxa ?? []).map((taxon) => taxon.title).filter((title) => title.length > 0);
}

export function toSourceManga(detail: MangaDetail): SourceManga {
  const tagGroups = [
    { id: "genres", title: "Genres", taxa: detail.genres },
    { id: "tags", title: "Tags", taxa: detail.tags },
    { id: "demographics", title: "Demographics", taxa: detail.demographics },
    { id: "formats", title: "Formats", taxa: detail.formats },
  ]
    .filter((group) => (group.taxa?.length ?? 0) > 0)
    .map((group) => ({
      id: group.id,
      title: group.title,
      tags: (group.taxa ?? []).map((taxon) => ({ id: taxon.slug, title: taxon.title })),
    }));

  return {
    mangaId: detail.hid,
    mangaInfo: {
      thumbnailUrl: posterUrl(detail),
      synopsis: detail.synopsis ?? "",
      primaryTitle: detail.title,
      secondaryTitles: detail.altTitles ?? [],
      contentRating: contentRatingOf(detail),
      status: detail.status,
      author: titles(detail.authors).join(", ") || undefined,
      artist: titles(detail.artists).join(", ") || undefined,
      // ratedAvg is out of 10 and the app renders `rating` as a fraction, so an
      // unscaled 5.5 displays as 550%.
      rating: typeof detail.ratedAvg === "number" ? detail.ratedAvg / 10 : undefined,
      tagGroups: tagGroups.length > 0 ? tagGroups : undefined,
      shareUrl: detail.url ? `${DOMAIN}${detail.url}` : undefined,
    },
  };
}

/**
 * `name` is usually empty, so a readable title is synthesised. Several groups may
 * translate one series, which makes `number` non-unique — the group goes in
 * `version`, which is what the app uses to keep them apart.
 */
export function toChapter(item: ChapterItem, sourceManga: SourceManga): Chapter {
  const chapNum = typeof item.number === "string" ? Number.parseFloat(item.number) : item.number;
  const name = item.name?.trim();

  const chapter: Chapter = {
    chapterId: String(item.id),
    sourceManga,
    langCode: item.language ?? "en",
    chapNum: Number.isFinite(chapNum) ? chapNum : 0,
  };

  if (name && name.length > 0) chapter.title = name;
  if (item.group?.name) chapter.version = item.group.name;

  // An unvolumed chapter must say so with an explicit 0. Leaving the field out
  // is what makes the app label the chapter "Vol. TBA" — the same trap
  // src/AsuraScans/comics.ts records.
  chapter.volume = item.volume && item.volume > 0 ? item.volume : 0;

  // The reader needs the chapter's canonical path, which carries the slug and
  // number (`/title/<hid>-<slug>/<id>-chapter-<n>`) and cannot be rebuilt from
  // the id alone.
  if (item.url) chapter.additionalInfo = { url: item.url };

  const published = ageToDate(item.createdAtFormatted);
  if (published) chapter.publishDate = published;

  return chapter;
}

export function parseChapterPayload(payload: ChapterPayload, sourceManga: SourceManga): Chapter[] {
  return (payload.result?.items ?? []).map((item) => toChapter(item, sourceManga));
}

export function chapterPagesRemain(payload: ChapterPayload): boolean {
  const meta = payload.result?.meta;
  if (!meta) return false;
  return meta.hasNext || meta.page < meta.lastPage;
}

/**
 * `baseUrl` was empty with absolute `url`s in every sample, but the field exists,
 * so relative entries are resolved rather than assumed away.
 */
export function parsePagesPayload(payload: PagesPayload): string[] {
  const pages = payload.result?.pages;
  const base = pages?.baseUrl ?? "";

  return (pages?.items ?? [])
    .map((item) => item.url)
    .filter((url): url is string => typeof url === "string" && url.length > 0)
    .map((url) => (/^https?:\/\//.test(url) ? url : `${base}${url}`));
}

const RELATIVE_AGE = /^(\d+)\s*(s|m|h|d|w|mos|mo|y)\b/i;

const AGE_UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
  mo: 2_629_800_000,
  mos: 2_629_800_000,
  y: 31_557_600_000,
};

/**
 * The API only ever gives a rendered age ("1h ago", "6mos ago"), never a
 * timestamp, so a publish date can only be approximate. Note `m` is minutes
 * while `mos` is months — reading one as the other is off by five orders of
 * magnitude and sorts the whole list wrongly.
 */
export function ageToDate(
  formatted: string | undefined,
  now: number = Date.now(),
): Date | undefined {
  const match = RELATIVE_AGE.exec(formatted?.trim() ?? "");
  if (!match?.[1] || !match[2]) return undefined;

  const unit = AGE_UNIT_MS[match[2].toLowerCase()];
  if (unit === undefined) return undefined;

  return new Date(now - Number.parseInt(match[1], 10) * unit);
}

export function seriesUrl(hid: Hid): string {
  return `${DOMAIN}/title/${hid}`;
}
