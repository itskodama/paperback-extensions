/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  balancedDiv,
  capture,
  decodeEntities,
  metaContent,
  removeDivs,
  removeScripts,
  textOf,
  toXhtmlDocument,
} from "./html.ts";
import {
  type ChapterEntry,
  type ChapterListPage,
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
const ROW_COVER = /<img[^>]*\bsrc="([^"]*)"/;
const ROW_RATING = /<div class="core">\s*<span>\s*([\d.]+)/;
const ROW_LANGUAGE = /href="\/sort\/latest-release\/([a-z]+)-novel"/;
const ROW_GENRE = /href="\/genre\/[^"]*"[^>]*>([^<]+)<\/a>/g;
const ROW_CHAPTER_COUNT = /<span class="s1">\s*([\d,]+) Chapters<\/span>/;

const CONTAINER_BOUNDARY = /<div class="con">/gi;

/**
 * Every listing surface on this site — search, filtered search, `/sort`, `/genre`
 * and the homepage shelves — wraps a novel's fields in the same `div.con` block.
 * One reader covers all of them; callers narrow `html` to the region they mean.
 */
function parseRows(html: string): ListingRow[] {
  const rows: ListingRow[] = [];

  CONTAINER_BOUNDARY.lastIndex = 0;
  let opening: RegExpExecArray | null;
  while ((opening = CONTAINER_BOUNDARY.exec(html)) !== null) {
    const block = balancedDiv(html.slice(opening.index), /<div class="con">/i);
    if (!block) continue;
    CONTAINER_BOUNDARY.lastIndex = opening.index + block.length;

    const row = parseRow(block);
    if (row) rows.push(row);
  }
  return rows;
}

function parseRow(block: string): ListingRow | undefined {
  const slug = SLUG_HREF.exec(block)?.[1];
  const title = capture(block, ROW_TITLE);
  const cover = ROW_COVER.exec(block)?.[1];
  if (!slug || !title || !cover) return undefined;

  const genres: string[] = [];
  ROW_GENRE.lastIndex = 0;
  for (const match of block.matchAll(ROW_GENRE)) {
    const genre = decodeEntities(match[1]!).trim();
    if (genre) genres.push(genre);
  }

  const row: ListingRow = {
    slug,
    title,
    thumbnailUrl: absoluteUrl(cover),
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
const RELEASE_COVER = /<img[^>]*\bsrc="([^"]*)"/;
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
    const cover = RELEASE_COVER.exec(item)?.[1];
    const chapter = RELEASE_CHAPTER.exec(item);
    if (!slug || !title || !cover || !chapter) continue;

    const entry: ReleaseEntry = {
      slug,
      title,
      thumbnailUrl: absoluteUrl(fullSizeCover(cover)),
      chapterIndex: Number.parseInt(chapter[1]!, 10),
    };

    const label = RELEASE_CHAPTER_TITLE.exec(item)?.[1];
    const chapterTitle = label
      ? stripChapterNumber(decodeEntities(label), entry.chapterIndex)
      : undefined;
    if (chapterTitle) entry.chapterTitle = chapterTitle;

    const published = parseRelativeTime(RELEASE_TIME.exec(item)?.[1] ?? "", now);
    if (published) entry.publishDate = published;

    entries.push(entry);
  }
  return entries;
}

const RELATIVE_TIME = /^\s*(\d+)\s*(sec|min|hour|day|week|month|year)/i;

const RELATIVE_UNIT_MS: Record<string, number> = {
  sec: 1_000,
  min: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_592_000_000,
  year: 31_536_000_000,
};

/** The release feed dates chapters as "3 mins ago" and nothing more precise. */
export function parseRelativeTime(text: string, now: Date = new Date()): Date | undefined {
  const match = RELATIVE_TIME.exec(text);
  if (!match) return undefined;

  const unit = RELATIVE_UNIT_MS[match[2]!.toLowerCase()];
  if (unit === undefined) return undefined;

  return new Date(now.getTime() - Number.parseInt(match[1]!, 10) * unit);
}

const DETAIL_TITLE = /<h1 class="tit">([^<]*)<\/h1>/;
const DETAIL_SYNOPSIS = /<div class="m-desc">[\s\S]*?<div class="inner">([\s\S]*?)<\/div>/i;
const DETAIL_ALT_TITLES =
  /title="Alternative names"[\s\S]{0,200}?<span class="s1">([\s\S]*?)<\/span>/i;
const DETAIL_RATING = /<p class="vote">\s*([\d.]+)\s*\//;
const DETAIL_TOTAL_CHAPTERS = /data-total-chapters="(\d+)"/;

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

  const cover = metaContent(html, "og:image");

  const detail: NovelDetail = {
    slug,
    title,
    synopsis: synopsis || "No synopsis.",
    thumbnailUrl: cover ? absoluteUrl(cover) : "",
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

  const rating = Number.parseFloat(DETAIL_RATING.exec(html)?.[1] ?? "");
  if (Number.isFinite(rating) && rating > 0) detail.rating = rating;

  const total = Number.parseInt(DETAIL_TOTAL_CHAPTERS.exec(html)?.[1] ?? "", 10);
  if (Number.isFinite(total)) detail.totalChapters = total;

  return detail;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,、]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const CHAPTER_LINK = /href="\/novel\/[^"]*\/chapter-(\d+)"[^>]*title="([^"]*)"/g;

/**
 * The `?ajax=chapters` payload.
 *
 * The response reports `totalPage`, so page 1 both returns data and states how
 * many further requests the walk needs — no request is ever speculative.
 */
export function parseChapterList(payload: unknown): ChapterListPage {
  const body = payload as {
    code?: number;
    html?: string;
    page?: number;
    totalPage?: number;
    totalChapters?: number;
  } | null;

  if (!body || body.code !== 200 || typeof body.html !== "string") {
    throw new Error("FreeWebNovel returned an unreadable chapter list");
  }

  const entries: ChapterEntry[] = [];
  for (const match of body.html.matchAll(CHAPTER_LINK)) {
    const index = Number.parseInt(match[1]!, 10);
    if (!Number.isFinite(index)) continue;

    const entry: ChapterEntry = { index };
    const title = stripChapterNumber(decodeEntities(match[2]!), index);
    if (title) entry.title = title;
    entries.push(entry);
  }

  return {
    entries,
    page: body.page ?? 1,
    totalPage: body.totalPage ?? 1,
    totalChapters: body.totalChapters ?? entries.length,
  };
}

const CHAPTER_PREFIX = /^\s*(?:chapter|chap|ch|c)[\s.\-–—]*\d+(?:\.\d+)?\s*[:.\-–—]?\s*/i;
const LEADING_NUMBER = /^\s*(\d+(?:\.\d+)?)\s*[:.\-–—]?\s*/;

/**
 * The chapter title with its own numbering removed.
 *
 * The app renders the row as `"Chapter {chapNum} - {title}"`, so an un-stripped
 * title reads "Chapter 145 - Chapter 145: Accusation". A bare leading number is
 * only removed when it *equals* the index — otherwise it is the site's own
 * sub-numbering ("Chapter 2213 - 40 closeness") and part of the title.
 */
export function stripChapterNumber(title: string, index: number): string | undefined {
  const decoded = decodeEntities(title).trim();

  let stripped = decoded.replace(CHAPTER_PREFIX, "");
  if (stripped === decoded) {
    const leading = LEADING_NUMBER.exec(decoded);
    if (leading && Number.parseFloat(leading[1]!) === index) {
      stripped = decoded.slice(leading[0].length);
    }
  }

  const result = stripped.trim();
  return result.length > 0 ? result : undefined;
}

const ARTICLE = /<div\b[^>]*\bid="article"[^>]*>/i;
const AD_BLOCK = /<div\b[^>]*\bclass="[^"]*\breader-ad-skip\b[^"]*"[^>]*>/i;
const PARAGRAPH = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;

/**
 * A chapter's prose as a complete XHTML document.
 *
 * The ad blocks the site injects mid-article carry no `<p>` today, so collecting
 * paragraphs would skip them anyway — they are removed explicitly regardless,
 * because if that ever changes the failure is ad copy appearing mid-chapter.
 */
export function parseChapterBody(html: string, label: string): string {
  const article = balancedDiv(html, ARTICLE);
  if (!article) throw new Error(`FreeWebNovel served no readable content for ${label}`);

  const prose = removeScripts(removeDivs(article, AD_BLOCK));

  const paragraphs: string[] = [];
  for (const match of prose.matchAll(PARAGRAPH)) {
    const paragraph = match[1]!.trim();
    if (paragraph.length > 0) paragraphs.push(`<p>${paragraph}</p>`);
  }

  // A chapter with no content renders as a silently blank reader, so it has to raise.
  if (paragraphs.length === 0) {
    throw new Error(`FreeWebNovel served an empty chapter for ${label}`);
  }
  return toXhtmlDocument(paragraphs.join(""));
}
