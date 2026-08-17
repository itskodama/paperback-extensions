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

export function updatesUrl(): string {
  return `${DOMAIN}/updates/`;
}

export function homeUrl(): string {
  return `${DOMAIN}/`;
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
// From /advanced-search/'s checkbox list; already row-id-safe (hyphenated)
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

// Curated subset for the discover chip row, not the whole vocabulary
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

// "Adult" is the only unambiguous explicit-content tag; orientation/violence
// tags (Yaoi, Ecchi, Horror, ...) don't imply it on their own
function contentRatingFor(genres: string[]): ContentRating {
  return genres.some((genre) => genre.toLowerCase() === "adult")
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

export function genreChipItems(): DiscoverSectionItem[] {
  return DISCOVER_GENRES.map((name) => ({
    type: "genresCarouselItem",
    // replaceAll, not replace: "Slice-of-Life" has two hyphens and rendered "Slice of-Life"
    name: name.replaceAll("-", " "),
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

// The JSON-LD `description` is truncated by the site itself (ends in "…");
// the full synopsis lives in .summary-content as separate <p> paragraphs
const SUMMARY_START = 'class="summary-content"';
const SUMMARY_END = "show-more-btn";
const SUMMARY_PARAGRAPH = /<p>([\s\S]*?)<\/p>/g;

function parseSummary(html: string): string | undefined {
  const start = html.indexOf(SUMMARY_START);
  const end = start >= 0 ? html.indexOf(SUMMARY_END, start) : -1;
  if (start < 0 || end < 0) return undefined;

  const paragraphs = [...html.slice(start, end).matchAll(SUMMARY_PARAGRAPH)]
    .map((match) => decodeEntities(match[1]!.replace(/\s+/g, " ")).trim())
    .filter((paragraph) => paragraph.length > 0);

  return paragraphs.length > 0 ? paragraphs.join("\n\n") : undefined;
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
      synopsis: parseSummary(html) ?? book.description ?? "No synopsis.",
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
// Titles read "Chapter <n> - <raw> - <title>"; <raw> drifts from <n> after
// book-boundary chapters and is missing on bonus chapters, so only the URL's
// own <n> is trusted as chapNum (site-recon.md)

export const CHAPTER_LIST_PAGE_SIZE = 50;

export type ChapterCard = { number: number; title?: string; timeText?: string };

const CARD_START =
  /<div class="chapter-card" onclick="location\.href='\/novel\/[^/]+\/chapter\/(\d+)\/'">/g;
const TITLE_IN_CARD = /<h3 class="chapter-title">\s*([\s\S]*?)\s*<\/h3>/;
const TIME_IN_CARD = /<p class="chapter-time">\s*([^<]*?)\s*<\/p>/;
const CHAPTER_PREFIX = /^Chapter\s+\d+\s*-\s*/i;
// Strips a further bare leading number regardless of whether it agrees with
// chapNum (docs/paperback/chapters.md)
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
// #chapterText is a flat run of <p> tags plus an ad container + <style> block;
// matching only <p>...</p> discards the rest with no special-casing needed
const CONTENT_START = 'id="chapterText"';
const CONTENT_END = '<div class="bottom-nav">';
const PARAGRAPH = /<p>[\s\S]*?<\/p>/g;

// html chapters parse as XML: unclosed void elements and named entities beyond
// XML's five are fatal (docs/paperback/html-chapters.md)
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

// The JSON API spells genres with spaces ("Slice of Life") and the filter vocabulary with
// hyphens ("Slice-of-Life"); statuses are Title Case one side and lowercase ids the other.
// Confirmed against /api/search/ live, not assumed.
function sameTerm(a: string, b: string): boolean {
  const flatten = (value: string) =>
    value
      .toLowerCase()
      .replace(/[\s-]+/g, " ")
      .trim();
  return flatten(a) === flatten(b);
}

function inChapterRange(chapters: number, range: string): boolean {
  if (range.startsWith("<")) return chapters < Number(range.slice(1));
  if (range.startsWith(">")) return chapters > Number(range.slice(1));

  const [low, high] = range.split("-").map(Number);
  return low !== undefined && high !== undefined && chapters >= low && chapters <= high;
}

/**
 * /advanced-search/ has no free-text parameter, so a filtered search *with* a title cannot be
 * answered server-side. The API answers the title and these re-apply the filters over its
 * results, rather than the extension silently dropping one half of what the user asked for.
 */
export function matchesFilters(
  novel: SearchNovelJson,
  filters: LightNovelWorldSearchMetadata | undefined,
): boolean {
  if (!filters) return true;

  const genres = novel.genres ?? [];

  const include = filters.genresInclude ?? [];
  if (include.length > 0) {
    const matched = (wanted: string) => genres.some((genre) => sameTerm(genre, wanted));
    // The site's own default is AND; the form offers OR explicitly.
    const ok = filters.genreLogic === "OR" ? include.some(matched) : include.every(matched);
    if (!ok) return false;
  }

  for (const excluded of filters.genresExclude ?? []) {
    if (genres.some((genre) => sameTerm(genre, excluded))) return false;
  }

  if (filters.status && !sameTerm(novel.status ?? "", filters.status)) return false;

  if (filters.chapterRange !== undefined) {
    const chapters = novel.latest_chapter_number;
    if (typeof chapters !== "number" || !inChapterRange(chapters, filters.chapterRange)) {
      return false;
    }
  }

  return true;
}

export function toSearchResultItem(novel: SearchNovelJson): SearchResultItem {
  return {
    mangaId: novel.slug,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteUrl(novel.cover_path),
    contentRating: contentRatingFor(novel.genres),
  };
}

type InfoItem = { symbol: string; text: string };

// TODO: fetch each novel's own page for a real synopsis + rating (like
// AsuraScans/NovelArchive) — costs one extra request per recommended item,
// so left as free/status-only data for now
export function toFeaturedItem(novel: SearchNovelJson): DiscoverSectionItem {
  const infoItems: [InfoItem, InfoItem] = [
    { symbol: "book.fill", text: `${novel.latest_chapter_number} ch` },
    {
      symbol: novel.status === "Completed" ? "checkmark.circle.fill" : "clock.fill",
      text: novel.status,
    },
  ];

  return {
    type: "featuredCarouselItem",
    mangaId: novel.slug,
    title: novel.title,
    imageUrl: absoluteUrl(novel.cover_path),
    supertitle: novel.author,
    infoItems,
    contentRating: contentRatingFor(novel.genres),
  };
}

// --- Advanced search (/advanced-search/) ---
// sort=rating looks broken (reads alphabetical, not rating order) — excluded

export type LightNovelWorldSearchMetadata = {
  genresInclude?: string[];
  genresExclude?: string[];
  genreLogic?: "AND" | "OR";
  status?: string;
  chapterRange?: string;
};

// Real API values for chapter_range; "<50"/">1000" aren't row-id-safe, so
// forms.ts maps its own ids (lt50/gt1000) to these
export const CHAPTER_RANGES = [
  { id: "lt50", value: "<50", label: "Less than 50" },
  { id: "50-100", value: "50-100", label: "50-100" },
  { id: "100-500", value: "100-500", label: "100-500" },
  { id: "500-1000", value: "500-1000", label: "500-1000" },
  { id: "gt1000", value: ">1000", label: "More than 1000" },
] as const;

export const STATUSES = [
  { id: "ongoing", label: "Ongoing" },
  { id: "completed", label: "Completed" },
  { id: "hiatus", label: "Hiatus" },
] as const;

export type SortOption = { id: string; label: string; sort?: string; order?: "asc" | "desc" };

export const SORT_OPTIONS: SortOption[] = [
  { id: "rank", label: "Relevance" },
  { id: "views-desc", label: "Most Viewed", sort: "views", order: "desc" },
  { id: "views-asc", label: "Least Viewed", sort: "views", order: "asc" },
  { id: "bookmarks-desc", label: "Most Bookmarked", sort: "bookmarks", order: "desc" },
  { id: "bookmarks-asc", label: "Least Bookmarked", sort: "bookmarks", order: "asc" },
  { id: "updates-desc", label: "Recently Updated", sort: "updates", order: "desc" },
  { id: "updates-asc", label: "Least Recently Updated", sort: "updates", order: "asc" },
  { id: "new-desc", label: "Newest", sort: "new", order: "desc" },
  { id: "new-asc", label: "Oldest", sort: "new", order: "asc" },
];

export const DEFAULT_SORT: SortOption = SORT_OPTIONS[0]!;

export function findSortOption(id: string | undefined): SortOption {
  return SORT_OPTIONS.find((option) => option.id === id) ?? DEFAULT_SORT;
}

export function advancedSearchUrl(
  filters: LightNovelWorldSearchMetadata | undefined,
  sort: SortOption,
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
  if (filters?.status) params.set("status", [filters.status]);
  if (filters?.chapterRange) params.set("chapter_range", [filters.chapterRange]);
  if (sort.sort) params.set("sort", [sort.sort]);
  if (sort.order) params.set("order", [sort.order]);
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

// Same card shape backs "Latest Novels" (advancedSearchUrl(undefined, "new", 1))
export function toLatestNovelItem(card: AdvancedSearchCard): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
}

// A short page signals the end without needing to parse pagination links
export function hasNextAdvancedSearchPage(cardCount: number, pageSize = 24): boolean {
  return cardCount >= pageSize;
}

// --- Discover: Most Read (homepage ranking column + /ranking/ for more) ---

export type MostReadCard = { slug: string; title: string; imageUrl: string; viewsText?: string };

const MOST_READ_START = 'ranking-column-title">Most Read';
const MOST_READ_END = 'ranking-column-title">New Trend';
const MOST_READ_ITEM_START = /<a href="\/novel\/([^/]+)\/" class="ranking-item">/g;
const MOST_READ_TITLE = /<h4 class="ranking-item-title">([^<]*)<\/h4>/;
const MOST_READ_IMG = /<img src="([^"]*)"/;
const MOST_READ_VIEWS = /<span class="stat-item">[\s\S]*?<span>\s*([^<]*?)\s*<\/span>/;

export function parseMostReadCards(html: string): MostReadCard[] {
  const columnStart = html.indexOf(MOST_READ_START);
  const columnEnd = columnStart >= 0 ? html.indexOf(MOST_READ_END, columnStart) : -1;
  const column =
    columnStart >= 0 && columnEnd > columnStart ? html.slice(columnStart, columnEnd) : "";

  const starts = [...column.matchAll(MOST_READ_ITEM_START)];

  return starts
    .map((match, index) => {
      const from = match.index;
      const to = starts[index + 1]?.index ?? column.length;
      const block = column.slice(from, to);

      const title = MOST_READ_TITLE.exec(block)?.[1];
      if (!title) return undefined;

      const card: MostReadCard = {
        slug: match[1]!,
        title: decodeEntities(title.trim()),
        imageUrl: absoluteUrl(MOST_READ_IMG.exec(block)?.[1] ?? ""),
      };
      const viewsText = MOST_READ_VIEWS.exec(block)?.[1];
      if (viewsText) card.viewsText = viewsText;
      return card;
    })
    .filter((card): card is MostReadCard => card !== undefined);
}

export function toMostReadItem(card: MostReadCard): DiscoverSectionItem {
  const item: DiscoverSectionItem = {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
  if (card.viewsText) item.subtitle = `${card.viewsText} views`;
  return item;
}

// /ranking/?sort=rank extends past the homepage's top 10; no view count on its cards
export const RANKING_PAGE_SIZE = 100;

export type RankingCard = { slug: string; title: string; imageUrl: string };

const RANKING_CARD_START = /<div class="ranking-card">/g;
const RANKING_HREF = /<a href="\/novel\/([^/]+)\/" class="card-link">/;
const RANKING_COVER = /<div class="card-cover" data-bg-image="([^"]*)">/;
const RANKING_TITLE = /<h3 class="card-title">([^<]*)<\/h3>/;

export function rankingUrl(page: number): string {
  return `${DOMAIN}/ranking/?sort=rank&page=${page}`;
}

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

// --- Discover: Trending This Week (homepage boost-shelf) ---

export type BoostShelfCard = { slug: string; title: string; imageUrl: string; boostCount?: number };

const BOOST_CARD_START = /<a href="\/novel\/([^/]+)\/" class="boost-shelf-card">/g;
const BOOST_IMG = /<img src="([^"]*)"/;
const BOOST_TITLE = /<span class="boost-shelf-title">([^<]*)<\/span>/;
const BOOST_COUNT = /<span class="boost-shelf-count">\s*<svg[\s\S]*?<\/svg>\s*([\d,]+)/;

export function parseBoostShelfCards(html: string): BoostShelfCard[] {
  const starts = [...html.matchAll(BOOST_CARD_START)];

  return starts
    .map((match, index) => {
      const from = match.index;
      const to = starts[index + 1]?.index ?? html.length;
      const block = html.slice(from, to);

      const title = BOOST_TITLE.exec(block)?.[1];
      if (!title) return undefined;

      const card: BoostShelfCard = {
        slug: match[1]!,
        title: decodeEntities(title.trim()),
        imageUrl: absoluteUrl(BOOST_IMG.exec(block)?.[1] ?? ""),
      };
      const boostCount = BOOST_COUNT.exec(block)?.[1];
      if (boostCount) card.boostCount = Number(boostCount.replace(/,/g, ""));
      return card;
    })
    .filter((card): card is BoostShelfCard => card !== undefined);
}

export function toTrendingItem(card: BoostShelfCard): DiscoverSectionItem {
  const item: DiscoverSectionItem = {
    type: "simpleCarouselItem",
    mangaId: card.slug,
    title: card.title,
    imageUrl: card.imageUrl,
    contentRating: ContentRating.MATURE,
  };
  if (card.boostCount) item.subtitle = `${card.boostCount} boosts`;
  return item;
}

// --- Discover: Latest Updates (/updates/) ---
// Links to the novel page, not the chapter; chapter number is parsed from the
// "Chapter N: Title" label text instead

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
