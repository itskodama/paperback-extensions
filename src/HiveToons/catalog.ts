/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Pure transforms of what the catalog says about a series: the archive JSON behind search, browse
 * and discover, plus the series record behind the details screen. Nothing here performs I/O or
 * reads persisted state.
 */

import {
  ContentRating,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

import { toPlainText } from "./html.ts";
import {
  ADULT_GENRE_NAMES,
  MATURE_GENRE_NAMES,
  type ApiGenre,
  type ApiPost,
  type ApiQueryResponse,
  type GenreOption,
} from "./models.ts";
import { asRecord, readNumber, readRecords, readString, type Rec } from "./records.ts";
import { seriesUrl } from "./urls.ts";

const STATUS_LABELS: Record<string, string> = {
  ONGOING: "Ongoing",
  COMPLETED: "Completed",
  HIATUS: "Hiatus",
  DROPPED: "Dropped",
};

/** The site rates out of ten; the app renders `rating` as a 0-1 fraction. */
const RATING_SCALE = 10;

function toGenre(record: Rec): ApiGenre[] {
  const id = readNumber(record, "id");
  const name = readString(record, "name");
  return id !== undefined && name !== undefined ? [{ id, name: name.trim() }] : [];
}

function toPost(record: Rec): ApiPost[] {
  const id = readNumber(record, "id");
  const slug = readString(record, "slug");
  const postTitle = readString(record, "postTitle");
  if (id === undefined || slug === undefined || postTitle === undefined) return [];

  return [
    {
      id,
      slug,
      postTitle,
      featuredImage: readString(record, "featuredImage"),
      genres: readRecords(record, "genres").flatMap(toGenre),
      latestChapterNumber: readNumber(readRecords(record, "chapters")[0] ?? {}, "number"),
    },
  ];
}

export function parseQueryResponse(payload: unknown): ApiQueryResponse {
  const root = asRecord(payload);
  if (!root) throw new Error("HiveToons returned an unreadable catalog response");

  return {
    posts: readRecords(root, "posts").flatMap(toPost),
    totalCount: readNumber(root, "totalCount") ?? 0,
  };
}

/**
 * The origin's search collapses on some terms — a stopword, or anything non-Latin — and answers
 * with the *entire catalog* in default order rather than with nothing. Handing that back shows
 * every title on the site as if it had matched.
 *
 * The echoed `searchTerm` cannot be used to detect it: across three consecutive probes of the same
 * query it came back absent, correct, and once as a *different* query's term, so it reflects some
 * shared state on the origin rather than what was applied.
 *
 * So the results are checked instead. A term is kept when every one of its words appears in the
 * title, which is what the origin itself would have matched — except that the origin also searches
 * alternative titles, which the catalog response does not include. Filtering everything away is
 * therefore the signature of a genuine alternative-title hit ("True Education" finds "Get
 * Schooled"), and the origin's own answer is left to stand in that case.
 *
 * See docs/HiveToons/site-recon.md#3-the-search-silently-falls-back-to-the-whole-catalog.
 */
export function applySearchTerm(posts: ApiPost[], requested: string): ApiPost[] {
  const words = requested.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return posts;

  const matched = posts.filter((post) => {
    const title = post.postTitle.toLowerCase();
    return words.every((word) => title.includes(word));
  });

  return matched.length > 0 ? matched : posts;
}

/**
 * The strictest rating any of the title's genres implies. Reported from what the source says about
 * itself: the site does mis-tag the odd title, but under-reporting shows flagged content to a
 * reader who asked not to see it, where over-reporting only costs a badge.
 */
export function contentRatingOf(genres: ApiGenre[]): ContentRating {
  const names = genres.map((genre) => genre.name.trim().toLowerCase());

  if (names.some((name) => ADULT_GENRE_NAMES.has(name))) return ContentRating.ADULT;
  if (names.some((name) => MATURE_GENRE_NAMES.has(name))) return ContentRating.MATURE;
  return ContentRating.EVERYONE;
}

/** A result cell and a carousel cell differ only by their discriminator. */
function toCard(post: ApiPost): Omit<SearchResultItem, "metadata"> {
  const card: Omit<SearchResultItem, "metadata"> = {
    mangaId: String(post.id),
    title: post.postTitle,
    imageUrl: post.featuredImage ?? "",
    contentRating: contentRatingOf(post.genres),
  };

  if (post.latestChapterNumber !== undefined) {
    card.subtitle = `Chapter ${post.latestChapterNumber}`;
  }
  return card;
}

export function toSearchResultItem(post: ApiPost): SearchResultItem {
  return toCard(post);
}

export function toDiscoverItem(post: ApiPost): DiscoverSectionItem {
  return { type: "simpleCarouselItem", ...toCard(post) };
}

// --- Series detail ---

function tagGroups(genres: ApiGenre[]): TagSection[] {
  if (genres.length === 0) return [];
  return [
    {
      id: "genres",
      title: "Genres",
      // The id is the numeric genre id, which is what the filter takes and is charset-safe;
      // the names are not (they carry spaces and hyphens the bridge rejects in an ID).
      tags: genres.map((genre) => ({ id: String(genre.id), title: genre.name })),
    },
  ];
}

/**
 * `/api/post` answers with the same series record the site's own page embeds, at about four
 * kilobytes against that page's ~1 MB — so nothing here needs HTML.
 */
export function parseSeriesDetail(payload: unknown, mangaId: string): SourceManga {
  const root = asRecord(payload);
  const post = root ? asRecord(root.post) : undefined;
  if (!post) throw new Error(`HiveToons: no series details found for ${mangaId}`);

  const genres = readRecords(post, "genres").flatMap(toGenre);
  const title = readString(post, "postTitle") ?? "";
  const alternative = readString(post, "alternativeTitles");
  const rating = readNumber(post, "averageRating");
  const status = readString(post, "seriesStatus");
  const artist = readString(post, "artist");
  const author = readString(post, "author") ?? readString(post, "studio");
  const banner = readString(post, "banner");
  const slug = readString(post, "slug");

  const mangaInfo: SourceManga["mangaInfo"] = {
    primaryTitle: title,
    // The site stores these as one free-text field, which is often just the primary title again.
    secondaryTitles:
      alternative && alternative !== title
        ? alternative
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean)
        : [],
    thumbnailUrl: readString(post, "featuredImage") ?? "",
    // The site stores this as markup; the app's field is plain text.
    synopsis: toPlainText(readString(post, "postContent") ?? "") || "No synopsis.",
    contentRating: contentRatingOf(genres),
    // The API says so outright, where the catalog only implies it through `seriesType`.
    contentType: post.isNovel === true ? "novel" : "comic",
  };

  if (status !== undefined) mangaInfo.status = STATUS_LABELS[status] ?? status;
  if (artist !== undefined) mangaInfo.artist = artist;
  if (author !== undefined) mangaInfo.author = author;
  if (banner !== undefined) mangaInfo.bannerUrl = banner;
  if (rating !== undefined) mangaInfo.rating = rating / RATING_SCALE;
  if (genres.length > 0) mangaInfo.tagGroups = tagGroups(genres);
  if (slug !== undefined) mangaInfo.shareUrl = seriesUrl(slug);

  return { mangaId, mangaInfo };
}

/**
 * The genre catalog, read from `/api/genres` rather than hardcoded — the ids are what every filter
 * sends, and a stale copy would silently drop whatever the site added since.
 */
export function parseGenres(payload: unknown): GenreOption[] {
  const list = Array.isArray(payload) ? payload : [];

  return list
    .flatMap((entry) => {
      const record = asRecord(entry);
      return record ? toGenre(record) : [];
    })
    .map((genre) => ({ id: String(genre.id), title: genre.name }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
