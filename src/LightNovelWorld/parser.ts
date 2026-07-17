/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type DiscoverSectionItem,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

export const DOMAIN = "https://lightnovelworld.org";
export const API_BASE = `${DOMAIN}/api`;

export function novelUrl(slug: string): string {
  return `${DOMAIN}/novel/${slug}/`;
}

export function chapterListUrl(slug: string, page: number): string {
  return `${DOMAIN}/novel/${slug}/chapters/?page=${page}`;
}

export function chapterUrl(slug: string, chapterNumber: string): string {
  return `${DOMAIN}/novel/${slug}/chapter/${chapterNumber}/`;
}

export function searchUrl(query: string): string {
  return `${API_BASE}/search/?q=${encodeURIComponent(query)}`;
}

export function recommendationsUrl(): string {
  return `${API_BASE}/recommendations/`;
}

export function rankingUrl(): string {
  return `${DOMAIN}/ranking/`;
}

export function updatesUrl(): string {
  return `${DOMAIN}/updates/`;
}

function absoluteUrl(path: string): string {
  return path.startsWith("http") ? path : `${DOMAIN}${path}`;
}

// --- Entity decoding (HTML pages only; JSON responses are already decoded) ---

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(ENTITY, (match, reference: string) => {
    if (reference.startsWith("#x") || reference.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(reference.slice(2), 16));
    }
    if (reference.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(reference.slice(1), 10));
    }
    return NAMED_ENTITIES[reference] ?? match;
  });
}

// --- Genre catalog ---
// Enumerated from /advanced-search/'s checkbox list (2026-07-16); values are
// already row-id-safe (hyphenated, no spaces), unlike NovelArchive's genre values
export const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Eastern",
  "Ecchi",
  "Fan-Fiction",
  "Fantasy",
  "Game",
  "Gender-Bender",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Josei",
  "LGBT+",
  "Magic",
  "Magical-Realism",
  "Martial-Arts",
  "Mature",
  "Mecha",
  "Mystery",
  "Psychological",
  "Romance",
  "School-Life",
  "Sci-Fi",
  "Seinen",
  "Shoujo",
  "Shounen",
  "Slice-of-Life",
  "Sports",
  "Supernatural",
  "Thriller",
  "Tragedy",
  "Wuxia",
  "Xianxia",
  "Xuanhuan",
  "Yaoi",
  "Yuri",
] as const;

// A curated subset for the discover chip row, matching NovelArchive's precedent
// of not dumping the whole vocabulary into a horizontal row
const DISCOVER_GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Fantasy",
  "Harem",
  "Historical",
  "Horror",
  "Isekai",
  "Martial-Arts",
  "Mystery",
  "Psychological",
  "Romance",
  "School-Life",
  "Sci-Fi",
  "Slice-of-Life",
  "Supernatural",
  "Tragedy",
  "Wuxia",
  "Xianxia",
] as const;

// Only "Adult" is an unambiguous explicit-content signal in this site's own
// vocabulary; orientation tags (Yaoi, Yuri, LGBT+, Gender-Bender) and
// violence/suggestive-only tags (Ecchi, Horror, Tragedy) don't imply it on their
// own, same reasoning NovelArchive's ADULT_GENRES applied
function contentRatingFor(genres: string[]): ContentRating {
  return genres.some((genre) => genre.toLowerCase() === "adult")
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

export function genreChipItems(): DiscoverSectionItem[] {
  return DISCOVER_GENRES.map((name) => ({
    type: "genresCarouselItem",
    name: name.replace("-", " "),
    searchQuery: { title: "", metadata: { genresInclude: [name] } },
    contentRating: ContentRating.MATURE,
  }));
}

// --- Novel details (schema.org Book JSON-LD) ---

type LdPerson = { name?: string };

type LdBook = {
  "@type"?: string;
  name?: string;
  author?: LdPerson;
  genre?: string[];
  description?: string;
  image?: string;
  status?: string;
};

const LD_JSON = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g;

function findBookLd(html: string): LdBook {
  for (const match of html.matchAll(LD_JSON)) {
    const payload = match[1];
    if (!payload) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;

    const book = parsed as LdBook;
    if (book["@type"] === "Book") return book;
  }
  throw new Error("No Book JSON-LD found on the LightNovelWorld page");
}

// JSON-LD genres are spaced ("Slice of Life"); Tag.id can't contain spaces (forms.md)
function genreId(value: string): string {
  return value.replace(/\s+/g, "-");
}

export function parseNovelDetails(html: string, mangaId: string): SourceManga {
  const book = findBookLd(html);
  const genres = book.genre ?? [];

  const tagGroups: TagSection[] =
    genres.length > 0
      ? [
          {
            id: "genres",
            title: "Genres",
            tags: genres.map((genre) => ({ id: genreId(genre), title: genre })),
          },
        ]
      : [];

  const thumbnailUrl = book.image ? absoluteUrl(book.image) : "";

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: book.description ?? "No synopsis.",
      primaryTitle: book.name ?? "Unknown Title",
      secondaryTitles: [],
      contentRating: contentRatingFor(genres),
      contentType: "novel",
      status: book.status,
      author: book.author?.name,
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: novelUrl(mangaId),
    },
  };
}

// --- Chapter list pages (/novel/<slug>/chapters/?page=N) ---
// Chapter titles read "Chapter <n> - <raw> - <title>"; <n> (this card's own URL
// number) is a clean, gapless 1..total sequence and is used as chapNum, but the
// embedded <raw> segment drifts from <n> after book-boundary chapters and is
// missing entirely on bonus chapters ("Chapter 150 - Surprise chapter drop!") —
// verified against a 160-chapter series (docs/LightNovelWorld/site-recon.md).
// Only <n> is trusted; <raw> is discarded along with the "Chapter <n> - " prefix.

export const CHAPTER_LIST_PAGE_SIZE = 50;

export type ChapterCard = { number: number; title?: string; timeText?: string };

const CARD_START =
  /<div class="chapter-card" onclick="location\.href='\/novel\/[^/]+\/chapter\/(\d+)\/'">/g;
const TITLE_IN_CARD = /<h3 class="chapter-title">\s*([\s\S]*?)\s*<\/h3>/;
const TIME_IN_CARD = /<p class="chapter-time">\s*([^<]*?)\s*<\/p>/;
const CHAPTER_PREFIX = /^Chapter\s+\d+\s*-\s*/i;
// Strips a further bare leading number (the drifting/absent <raw> segment)
// regardless of whether it agrees with chapNum — a correct duplicate number is
// exactly as confusing to read as a wrong one (docs/paperback/chapters.md)
const NUMBER_PREFIX = /^\d+(?:\.\d+)?\s*-\s*(.*)$/;

function extractCardTitle(raw: string): string | undefined {
  const stripped = decodeEntities(raw.replace(/\s+/g, " ").trim()).replace(CHAPTER_PREFIX, "");
  const inner = NUMBER_PREFIX.exec(stripped);
  const title = (inner ? inner[1] : stripped)?.trim();
  return title && title.length > 0 ? title : undefined;
}

export function parseChapterCards(html: string): ChapterCard[] {
  const starts = [...html.matchAll(CARD_START)];

  return starts.map((match, index) => {
    const from = match.index;
    const to = starts[index + 1]?.index ?? html.length;
    const block = html.slice(from, to);

    const card: ChapterCard = { number: Number(match[1]) };
    const rawTitle = TITLE_IN_CARD.exec(block)?.[1];
    if (rawTitle) {
      const title = extractCardTitle(rawTitle);
      if (title) card.title = title;
    }
    const timeText = TIME_IN_CARD.exec(block)?.[1];
    if (timeText) card.timeText = decodeEntities(timeText.trim());

    return card;
  });
}

// The "Go to Chapter" input's max attribute is the novel's true total chapter
// count, cheaper than paging through "of N" pagination text
const CHAPTER_TOTAL = /id="chapterInput"[^>]*\bmax="(\d+)"/;

export function parseChapterListTotal(html: string): number | undefined {
  const total = Number(CHAPTER_TOTAL.exec(html)?.[1]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

// Relative timestamps ("11 months, 2 weeks ago", "2 minutes ago") are the only
// per-chapter date signal available; summed into an approximate absolute date
const TIME_UNIT = /(\d+)\s*(second|minute|hour|day|week|month|year)s?/gi;
const UNIT_MS: Record<string, number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 604_800_000,
  month: 2_629_800_000,
  year: 31_557_600_000,
};

export function parseRelativeTime(text: string): Date | undefined {
  let totalMs = 0;
  let matched = false;

  for (const match of text.matchAll(TIME_UNIT)) {
    matched = true;
    totalMs += Number(match[1]) * (UNIT_MS[match[2]!.toLowerCase()] ?? 0);
  }

  return matched ? new Date(Date.now() - totalMs) : undefined;
}

export function chapterCardToChapter(card: ChapterCard, sourceManga: SourceManga): Chapter {
  const chapter: Chapter = {
    chapterId: String(card.number),
    sourceManga,
    langCode: "en",
    chapNum: card.number,
    volume: 0,
  };
  if (card.title) chapter.title = card.title;
  const publishDate = card.timeText ? parseRelativeTime(card.timeText) : undefined;
  if (publishDate) chapter.publishDate = publishDate;
  return chapter;
}

// --- Chapter content ---
// The reader text lives in #chapterText as a flat run of <p> tags, preceded by
// one ad container + <style> block; matching only <p>...</p> discards those
// (and the trailing comment/TTS UI, bounded by .bottom-nav) without needing to
// special-case the ad markup itself
const CONTENT_START = 'id="chapterText"';
const CONTENT_END = '<div class="bottom-nav">';
const PARAGRAPH = /<p>[\s\S]*?<\/p>/g;

// The app parses an html chapter as XML: unclosed void elements and named
// entities beyond XML's five predefined ones are fatal (docs/paperback/html-chapters.md).
// Observed chapters only carried &quot;/&#x27;, but this defends the rest of the
// site's catalog the same way LNORI/NovelArchive do.
const VOID_TAG =
  /<(img|br|hr|source|wbr|area|col|embed|input|link|meta|track|param|base)(\b[^>]*?)\s*\/?>/gi;
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);
const ENTITY_CODEPOINTS: Record<string, number> = {
  copy: 0xa9,
  deg: 0xb0,
  eacute: 0xe9,
  hellip: 0x2026,
  laquo: 0xab,
  ldquo: 0x201c,
  lsquo: 0x2018,
  mdash: 0x2014,
  middot: 0xb7,
  nbsp: 0xa0,
  ndash: 0x2013,
  raquo: 0xbb,
  rdquo: 0x201d,
  rsquo: 0x2019,
  shy: 0xad,
  times: 0xd7,
  trade: 0x2122,
};

function toXhtml(content: string): string {
  const body = content
    .replace(VOID_TAG, (_match, tag: string, attrs: string) => `<${tag}${attrs}/>`)
    .replace(NAMED_REF, (match: string, name: string) => {
      if (XML_ENTITIES.has(name)) return match;
      const codePoint = ENTITY_CODEPOINTS[name];
      return codePoint === undefined ? `&amp;${name};` : `&#${codePoint};`;
    });

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

export function parseChapterContent(html: string, chapter: Chapter): ChapterDetails {
  const start = html.indexOf(CONTENT_START);
  const end = start >= 0 ? html.indexOf(CONTENT_END, start) : -1;
  const region = start >= 0 && end > start ? html.slice(start, end) : "";
  const paragraphs = region.match(PARAGRAPH) ?? [];

  if (paragraphs.length === 0) {
    throw new Error(
      `LightNovelWorld served no readable content for ${chapter.title ?? chapter.chapterId}`,
    );
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(paragraphs.join("")),
  };
}

// --- Search API (/api/search/, /api/recommendations/) ---
// Both endpoints share the same shape; recommendations just omits the query

export type SearchNovelJson = {
  id: number;
  title: string;
  author: string;
  slug: string;
  status: string;
  genres: string[];
  cover_path: string;
  latest_chapter_number: number;
};

export type SearchApiResponse = { novels: SearchNovelJson[] };

export function toSearchResultItem(novel: SearchNovelJson): SearchResultItem {
  return {
    mangaId: novel.slug,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteUrl(novel.cover_path),
    contentRating: contentRatingFor(novel.genres),
  };
}

export function toFeaturedItem(novel: SearchNovelJson): DiscoverSectionItem {
  return {
    type: "featuredCarouselItem",
    mangaId: novel.slug,
    title: novel.title,
    imageUrl: absoluteUrl(novel.cover_path),
    supertitle: novel.author,
    contentRating: contentRatingFor(novel.genres),
  };
}

// --- Advanced search (/advanced-search/) ---
// Genre include/exclude/AND-OR logic and most sort values are verified real
// (each changes the actual result set, not just the count); `status` is a
// confirmed no-op and `sort=rating` looks broken (reads as alphabetical, not
// rating order) — neither is exposed. See docs/LightNovelWorld/site-recon.md.

export type LightNovelWorldSearchMetadata = {
  genresInclude?: string[];
  genresExclude?: string[];
  genreLogic?: "AND" | "OR";
};

const VERIFIED_SORTS = new Set(["rank", "views", "bookmarks", "updates", "new"]);

export function advancedSearchUrl(
  filters: LightNovelWorldSearchMetadata | undefined,
  sortId: string | undefined,
  page: number,
): string {
  const params = new Map<string, string[]>();

  for (const genre of filters?.genresInclude ?? []) {
    params.set("genres_include", [...(params.get("genres_include") ?? []), genre]);
  }
  for (const genre of filters?.genresExclude ?? []) {
    params.set("genres_exclude", [...(params.get("genres_exclude") ?? []), genre]);
  }
  if (filters?.genreLogic === "OR") params.set("genre_logic", ["OR"]);
  if (sortId && sortId !== "rank" && VERIFIED_SORTS.has(sortId)) params.set("sort", [sortId]);
  if (page > 1) params.set("page", [String(page)]);

  const pairs: string[] = [];
  for (const [key, values] of params) {
    for (const value of values)
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  }

  return pairs.length > 0
    ? `${DOMAIN}/advanced-search/?${pairs.join("&")}`
    : `${DOMAIN}/advanced-search/`;
}

export type AdvancedSearchCard = {
  slug: string;
  title: string;
  imageUrl: string;
  chapterCount?: number;
};

const RECOMMENDATION_CARD_START = /<div class="recommendation-card"/g;
const CARD_HREF = /<a href="\/novel\/([^/]+)\/" class="card-cover-link">/;
const CARD_IMG = /<img src="([^"]*)"/;
const CARD_TITLE = /<h3 class="card-title">([^<]*)<\/h3>/;
const CARD_CHAPTERS = /<span class="chapters">(\d+)\s*chapters?<\/span>/;

export function parseAdvancedSearchResults(html: string): AdvancedSearchCard[] {
  const starts = [...html.matchAll(RECOMMENDATION_CARD_START)];

  return starts
    .map((match, index) => {
      const from = match.index;
      const to = starts[index + 1]?.index ?? html.length;
      const block = html.slice(from, to);

      const slug = CARD_HREF.exec(block)?.[1];
      const title = CARD_TITLE.exec(block)?.[1];
      if (!slug || !title) return undefined;

      const card: AdvancedSearchCard = {
        slug,
        title: decodeEntities(title.trim()),
        imageUrl: absoluteUrl(CARD_IMG.exec(block)?.[1] ?? ""),
      };
      const chapterCount = CARD_CHAPTERS.exec(block)?.[1];
      if (chapterCount) card.chapterCount = Number(chapterCount);
      return card;
    })
    .filter((card): card is AdvancedSearchCard => card !== undefined);
}

export function toAdvancedSearchResultItem(card: AdvancedSearchCard): SearchResultItem {
  return {
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
}

// Whether a page has a next page: the same "recommendation-card" listing always
// renders a fixed page size, so a short page (or a page whose cards don't change
// the count) signals the end without needing to parse the pagination links
export function hasNextAdvancedSearchPage(cardCount: number, pageSize = 24): boolean {
  return cardCount >= pageSize;
}

// --- Discover: Popular (/ranking/) ---

export type RankingCard = { slug: string; title: string; imageUrl: string };

const RANKING_CARD_START = /<div class="ranking-card">/g;
const RANKING_HREF = /<a href="\/novel\/([^/]+)\/" class="card-link">/;
const RANKING_COVER = /<div class="card-cover" data-bg-image="([^"]*)">/;
const RANKING_TITLE = /<h3 class="card-title">([^<]*)<\/h3>/;

export function parseRankingCards(html: string): RankingCard[] {
  const starts = [...html.matchAll(RANKING_CARD_START)];

  return starts
    .map((match, index) => {
      const from = match.index;
      const to = starts[index + 1]?.index ?? html.length;
      const block = html.slice(from, to);

      const slug = RANKING_HREF.exec(block)?.[1];
      const title = RANKING_TITLE.exec(block)?.[1];
      if (!slug || !title) return undefined;

      return {
        slug,
        title: decodeEntities(title.trim()),
        imageUrl: absoluteUrl(RANKING_COVER.exec(block)?.[1] ?? ""),
      };
    })
    .filter((card): card is RankingCard => card !== undefined);
}

export function toRankingItem(card: RankingCard): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
}

// --- Discover: Latest Updates (/updates/) ---
// Each entry names a specific chapter ("Chapter 381: Bad Omen") but links to the
// novel page, not the chapter page — the chapter number is parsed out of the
// label text and used to build a chapterId consistent with getChapters'/
// getChapterDetails' own scheme (plain URL position, see above)

export type UpdateCard = {
  slug: string;
  title: string;
  imageUrl: string;
  chapterNumber: number;
  timeText?: string;
};

const UPDATE_CARD_START = /<a href="\/novel\/([^/]+)\/" class="ranking-item chapter-item">/g;
const UPDATE_IMG = /<img src="([^"]*)"/;
const UPDATE_TITLE = /<h4 class="ranking-item-title">([^<]*)<\/h4>/;
const UPDATE_CHAPTER = /<span class="chapter-link">\s*Chapter\s+(\d+)/;
const UPDATE_TIME = /<span class="chapter-timestamp">\s*([^<]*?)\s*<\/span>/;

export function parseUpdateCards(html: string): UpdateCard[] {
  const starts = [...html.matchAll(UPDATE_CARD_START)];

  return starts
    .map((match, index) => {
      const from = match.index;
      const to = starts[index + 1]?.index ?? html.length;
      const block = html.slice(from, to);

      const slug = match[1]!;
      const title = UPDATE_TITLE.exec(block)?.[1];
      const chapterNumber = UPDATE_CHAPTER.exec(block)?.[1];
      if (!title || !chapterNumber) return undefined;

      const card: UpdateCard = {
        slug,
        title: decodeEntities(title.trim()),
        imageUrl: absoluteUrl(UPDATE_IMG.exec(block)?.[1] ?? ""),
        chapterNumber: Number(chapterNumber),
      };
      const timeText = UPDATE_TIME.exec(block)?.[1];
      if (timeText) card.timeText = decodeEntities(timeText.trim());
      return card;
    })
    .filter((card): card is UpdateCard => card !== undefined);
}

export function toUpdateItem(card: UpdateCard): DiscoverSectionItem {
  const item: DiscoverSectionItem = {
    type: "chapterUpdatesCarouselItem",
    mangaId: card.slug,
    chapterId: String(card.chapterNumber),
    title: card.title,
    subtitle: `Chapter ${card.chapterNumber}`,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
  const publishDate = card.timeText ? parseRelativeTime(card.timeText) : undefined;
  if (publishDate) item.publishDate = publishDate;
  return item;
}
