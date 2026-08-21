/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { stripChapterPrefix } from "./chapters.ts";
import { balancedDiv, balancedDivs, capture, decodeEntities, metaContent, textOf } from "./html.ts";
import {
  type ListingPage,
  type ListingRow,
  type NovelDetail,
  type ReleaseEntry,
} from "./models.ts";
import { absoluteUrl } from "./urls.ts";

/**
 * FreeWebNovel-specific reading. Every export is a pure `(text) -> data` transform
 * with no `Application` calls, so `test/unit/FreeWebNovel.test.ts` drives all of it
 * offline. Mapping the results onto Paperback types happens in `mappers.ts`.
 */

const SLUG_HREF = /href="\/novel\/([^"/]+)"/;
const ROW_TITLE = /<h3 class="tit"><a href="\/novel\/[^"]*" title="([^"]*)"/;
const COVER_SRC = /<img[^>]*\bsrc="([^"]*)"/;
const COVER_WEBP = /<source[^>]*type="image\/webp"[^>]*srcset="([^"]*)"/i;
const ROW_RATING = /<div class="core">\s*<span>\s*([\d.]+)/;
const ROW_LANGUAGE = /href="\/sort\/latest-release\/([a-z]+)-novel"/;
const ROW_GENRE = /href="\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/g;
const ROW_CHAPTER_COUNT = /<span class="s1">\s*([\d,]+) Chapters<\/span>/;

const ROW_CONTAINER = /<div class="con">/i;

/**
 * Every listing surface on this site — search, filtered search, `/sort`, `/genre`
 * and the homepage shelves — wraps a novel's fields in the same `div.con` block.
 * One reader covers all of them; callers narrow `html` to the region they mean.
 */
function parseRows(html: string): ListingRow[] {
  const rows: ListingRow[] = [];
  for (const block of balancedDivs(html, ROW_CONTAINER)) {
    const row = parseRow(block);
    if (row) rows.push(row);
  }
  return rows;
}

/**
 * Covers exist as one full-size JPEG — the only thing the `<img>` src points at —
 * and as pre-scaled WebP derivatives offered in the sibling `<source>`. Across a
 * 14-cover sample the WebP set is **76% smaller** (183 KB against 760 KB), and the
 * largest one offered is already sized for where it is being shown.
 *
 * The runtime cannot *encode* WebP (`api-reference.md`), which is a different
 * thing from displaying it; Comix decodes WebP page images, and the rate limiter's
 * `ignoreImages` already matches the extension.
 */
function preferredCover(block: string, fallback: string): string {
  const srcset = COVER_WEBP.exec(block)?.[1];
  if (!srcset) return fallback;

  let best: string | undefined;
  let bestWidth = -1;
  for (const candidate of srcset.split(",")) {
    const [url, descriptor] = candidate.trim().split(/\s+/);
    if (!url) continue;
    const width = Number.parseInt(descriptor ?? "", 10);
    if (!(width <= bestWidth)) {
      bestWidth = Number.isFinite(width) ? width : bestWidth;
      best = url;
    }
  }
  return best ?? fallback;
}

function parseRow(block: string): ListingRow | undefined {
  const slug = SLUG_HREF.exec(block)?.[1];
  const title = capture(block, ROW_TITLE);
  const cover = COVER_SRC.exec(block)?.[1];
  if (!slug || !title || !cover) return undefined;

  const genres: string[] = [];
  for (const match of block.matchAll(ROW_GENRE)) {
    const genre = decodeEntities(match[1]!).trim();
    if (genre) genres.push(genre);
  }

  const row: ListingRow = {
    slug,
    title,
    thumbnailUrl: absoluteUrl(preferredCover(block, cover)),
    genres,
  };

  const language = ROW_LANGUAGE.exec(block)?.[1];
  if (language) row.language = `${language.charAt(0).toUpperCase()}${language.slice(1)}`;

  const rating = Number.parseFloat(ROW_RATING.exec(block)?.[1] ?? "");
  if (Number.isFinite(rating) && rating > 0) row.rating = rating;

  const chapters = Number.parseInt(
    (ROW_CHAPTER_COUNT.exec(block)?.[1] ?? "").replace(/,/g, ""),
    10,
  );
  if (Number.isFinite(chapters)) row.chapterCount = chapters;

  return row;
}

const RESULT_LIST = /<div class="[^"]*\brank-list\b[^"]*">/i;
// `/search-adv` styles its pager `pages advanced-pages`, so match the class loosely.
const PAGER = /<div class="[^"]*\bpages\b[^"]*">[\s\S]*?<\/div>/i;
const PAGE_NUMBER = /<(?:a[^>]*|strong)>(\d+)<\/(?:a|strong)>/g;

/**
 * A search, filtered-search, `/sort` or `/genre` page.
 *
 * `lastPage` comes off the site's own pager rather than being inferred, because
 * the two page limits differ by an order of magnitude: search stops at 5 pages
 * and browse runs to 50.
 */
export function parseListing(html: string): ListingPage {
  const container = balancedDiv(html, RESULT_LIST);
  const rows = container ? parseRows(container) : [];

  let lastPage = rows.length > 0 ? 1 : 0;
  const pager = PAGER.exec(html)?.[0];
  if (pager) {
    for (const match of pager.matchAll(PAGE_NUMBER)) {
      lastPage = Math.max(lastPage, Number.parseInt(match[1]!, 10));
    }
  }
  return { rows, lastPage };
}

const HOME_RECOMMENDATIONS = /<div class="[^"]*\bhome-recommendations\b[^"]*">/i;

/** The homepage's curated hero shelf. */
export function parseFeatured(html: string): ListingRow[] {
  const container = balancedDiv(html, HOME_RECOMMENDATIONS);
  return container ? parseRows(container) : [];
}

const RELEASE_LIST = /<ul class="home-release-list">[\s\S]*?<\/ul>/i;
const RELEASE_ITEM = /<li>[\s\S]*?<\/li>/g;
const RELEASE_TITLE = /class="home-release-title" title="([^"]*)"/;
const RELEASE_CHAPTER = /href="\/novel\/[^"]*\/chapter-(\d+)"/;
// The link's `title` is prefixed with the novel's name; this span is the bare label.
const RELEASE_CHAPTER_TITLE = /<span class="chapter-full">([^<]*)<\/span>/;
const RELEASE_TIME = /class="home-release-time">([^<]*)</;

/**
 * The release feed serves a 40px `<id>ss.jpg` thumbnail where every other surface
 * serves the full `<id>s.jpg` cover. Same file, one `s` apart — 1 KB against 160 KB.
 */
function fullSizeCover(path: string): string {
  return path.replace(/ss\.jpg$/i, "s.jpg");
}

/** The homepage "Latest Release" feed — the one place per-chapter timing exists. */
export function parseLatestReleases(html: string, now: Date = new Date()): ReleaseEntry[] {
  const list = RELEASE_LIST.exec(html)?.[0];
  if (!list) return [];

  const entries: ReleaseEntry[] = [];
  for (const match of list.matchAll(RELEASE_ITEM)) {
    const item = match[0];
    const slug = SLUG_HREF.exec(item)?.[1];
    const title = capture(item, RELEASE_TITLE);
    const cover = COVER_SRC.exec(item)?.[1];
    const chapter = RELEASE_CHAPTER.exec(item);
    if (!slug || !title || !cover || !chapter) continue;

    const entry: ReleaseEntry = {
      slug,
      title,
      thumbnailUrl: absoluteUrl(preferredCover(item, fullSizeCover(cover))),
      chapterIndex: Number.parseInt(chapter[1]!, 10),
    };

    // Prefix only: a feed item has no sibling chapters to judge a second number
    // against, so the carousel subtitle keeps one where the chapter list would not.
    const label = RELEASE_CHAPTER_TITLE.exec(item)?.[1];
    const chapterTitle = label ? stripChapterPrefix(label) : undefined;
    if (chapterTitle) entry.chapterTitle = chapterTitle;

    const published = parseRelativeTime(RELEASE_TIME.exec(item)?.[1] ?? "", now);
    if (published) entry.publishDate = published;

    entries.push(entry);
  }
  return entries;
}

const RELATIVE_TIME = /(\d+)\s*(sec|min|hour|day|week|month|year)/gi;

// Mean Gregorian lengths, not 30- and 365-day approximations: over a year-old
// chapter the difference is days.
const RELATIVE_UNIT_MS: Record<string, number> = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,
  year: 31_557_600_000,
};

/**
 * The release feed dates chapters relatively ("3 mins ago") and nothing more
 * precisely. Every unit present is summed, because these run compound — "11
 * months, 2 weeks ago" — and reading only the first would silently drop the rest.
 */
export function parseRelativeTime(text: string, now: Date = new Date()): Date | undefined {
  let elapsed = 0;
  let matched = false;

  for (const match of text.matchAll(RELATIVE_TIME)) {
    const unit = RELATIVE_UNIT_MS[match[2]!.toLowerCase()];
    if (unit === undefined) continue;
    elapsed += Number.parseInt(match[1]!, 10) * unit;
    matched = true;
  }

  return matched ? new Date(now.getTime() - elapsed) : undefined;
}

const DETAIL_TITLE = /<h1 class="tit">([^<]*)<\/h1>/;
const DETAIL_SYNOPSIS = /<div class="m-desc">[\s\S]*?<div class="inner">([\s\S]*?)<\/div>/i;
const DETAIL_ALT_TITLES =
  /title="Alternative names"[\s\S]{0,200}?<span class="s1">([\s\S]*?)<\/span>/i;
// Both halves of "4.6 / 5": the denominator is read, never assumed, so a page on
// a different scale normalises correctly instead of rendering ten times over.
const DETAIL_RATING = /<p class="vote">\s*([\d.]+)\s*\/\s*([\d.]+)/;
const DETAIL_TOTAL_CHAPTERS = /data-total-chapters="(\d+)"/;
const DETAIL_COVER = /<div class="pic">/i;
// The site states its own rating on the novel page, and nowhere else.
const DETAIL_CONTENT_RATING = /content-rating-(general|guidance|suggestive|adults-only)\b/i;

/**
 * The novel page.
 *
 * Read from `og:novel:*` meta tags wherever possible: they carry author, genres,
 * status, original language and update time on one escaped line each, and they
 * survive a restyle that would break the nested `div.txt` markup. Only the
 * synopsis, alternative titles and rating have no meta equivalent.
 */
export function parseNovelDetail(html: string, slug: string): NovelDetail {
  const title =
    metaContent(html, "og:novel:novel_name") ??
    metaContent(html, "og:title") ??
    capture(html, DETAIL_TITLE);
  if (!title) throw new Error(`FreeWebNovel served no readable novel page for ${slug}`);

  const paragraphs = DETAIL_SYNOPSIS.exec(html)?.[1];
  const synopsis = paragraphs
    ? textOf(paragraphs.replace(/<\/p>\s*<p[^>]*>/gi, "\n\n"))
    : (metaContent(html, "og:description") ?? "");

  // og:image is the full-size JPEG; the cover block offers scaled WebP alongside it.
  const cover = metaContent(html, "og:image");
  const picture = balancedDiv(html, DETAIL_COVER);

  const detail: NovelDetail = {
    slug,
    title,
    synopsis: synopsis || "No synopsis.",
    thumbnailUrl: cover ? absoluteUrl(picture ? preferredCover(picture, cover) : cover) : "",
    alternativeTitles: splitList(capture(html, DETAIL_ALT_TITLES)),
    genres: splitList(metaContent(html, "og:novel:genre")),
  };

  const author = metaContent(html, "og:novel:author");
  if (author) detail.author = author;

  // "Chinese Novel" — the site's own label for the original language.
  const language = metaContent(html, "og:novel:category")?.replace(/\s*Novels?$/i, "");
  if (language) detail.language = language;

  const status = metaContent(html, "og:novel:status");
  if (status) detail.status = status;

  const vote = DETAIL_RATING.exec(html);
  const rating = Number.parseFloat(vote?.[1] ?? "");
  const ratingMax = Number.parseFloat(vote?.[2] ?? "");
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(ratingMax) && ratingMax > 0) {
    detail.rating = rating;
    detail.ratingMax = ratingMax;
  }

  const total = Number.parseInt(DETAIL_TOTAL_CHAPTERS.exec(html)?.[1] ?? "", 10);
  if (Number.isFinite(total)) detail.totalChapters = total;

  const rated = DETAIL_CONTENT_RATING.exec(html)?.[1];
  if (rated) detail.contentRating = rated.toLowerCase();

  return detail;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,、]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}
