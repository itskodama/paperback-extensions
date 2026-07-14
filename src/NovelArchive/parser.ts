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

export const NOVELARCHIVE_DOMAIN = "https://novelarchive.cc";

// --- API JSON shapes ---
// The API is first-party JSON (no HTML parsing anywhere in this extension); shapes
// verified by hand against the live endpoints during recon (docs/NovelArchive/site-recon.md)

export type NovelJson = {
  id: string;
  author: string;
  chapter_names: string[];
  genres: string;
  cover_url: string;
  title: string;
  associated_names: string[];
  description: string;
  total_chapters: string;
  release_status: string;
  views_number: number;
  rating: number;
  rating_count: number;
};

export type NovelsListResponse = {
  novels: NovelJson[];
  pagination?: { has_next: boolean };
};

export type NovelDetailResponse = { novel: NovelJson };

export type ChapterJson = { chapter: { number: number; name: string; content: string } };

export type GenreEntry = { value: string; label: string };
export type GenresResponse = { genres: GenreEntry[] };

// --- Shared helpers ---

export function novelUrl(mangaId: string): string {
  return `${NOVELARCHIVE_DOMAIN}/novel?id=${encodeURIComponent(mangaId)}`;
}

function absoluteCoverUrl(coverUrl: string): string {
  return coverUrl.startsWith("http") ? coverUrl : `${NOVELARCHIVE_DOMAIN}${coverUrl}`;
}

function splitGenres(genres: string): string[] {
  return genres
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => genre.length > 0);
}

// A form row id (and, defensively, a tag id) must be alphanumeric or only
// `._-@()[]%?#+=/&:` — genre values from the API are lowercase and space-separated
// ("academy setting"), which is not row-id-safe on its own
function genreId(value: string): string {
  return value.replace(/\s+/g, "_");
}

// Sexual-content genre tags only — deliberately excludes orientation tags (yaoi,
// yuri, boys love, shounen ai, shoujo ai, lgbt+) and violence-only tags (gore,
// torture, gangs), neither of which signal explicit content on their own
const ADULT_GENRES = new Set([
  "adult",
  "erotica",
  "explicit sex",
  "sex slavery",
  "sex work",
  "prostitution",
  "bdsm",
  "rape",
  "mind break",
  "hypnosis",
  "smut",
]);

function contentRatingFor(genres: string[]): ContentRating {
  const lower = genres.map((genre) => genre.toLowerCase());
  return lower.some((genre) => ADULT_GENRES.has(genre))
    ? ContentRating.ADULT
    : ContentRating.MATURE;
}

// --- Search results / discover items ---

export function toSearchResultItem(novel: NovelJson): SearchResultItem {
  return {
    mangaId: novel.id,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteCoverUrl(novel.cover_url),
    contentRating: contentRatingFor(splitGenres(novel.genres)),
  };
}

export function toDiscoverItem(novel: NovelJson): DiscoverSectionItem {
  return {
    type: "simpleCarouselItem",
    mangaId: novel.id,
    title: novel.title,
    subtitle: novel.author,
    imageUrl: absoluteCoverUrl(novel.cover_url),
    contentRating: contentRatingFor(splitGenres(novel.genres)),
  };
}

type InfoItem = { symbol: string; text: string };

function titleCase(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

// 255678 -> "256K", 3965770 -> "4M"
function formatCount(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// A hero card shows a sentence or two on one line, not the whole synopsis
function shortSummary(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}

export function toFeaturedItem(novel: NovelJson): DiscoverSectionItem {
  const infoItems: InfoItem[] = [];
  if (novel.rating > 0) infoItems.push({ symbol: "star.fill", text: formatRating(novel.rating) });
  if (novel.views_number > 0) {
    infoItems.push({ symbol: "eye.fill", text: formatCount(novel.views_number) });
  }

  return {
    type: "featuredCarouselItem",
    mangaId: novel.id,
    title: novel.title,
    imageUrl: absoluteCoverUrl(novel.cover_url),
    supertitle: novel.release_status ? titleCase(novel.release_status) : undefined,
    infoItems: infoItems.length > 0 ? (infoItems as [InfoItem] | [InfoItem, InfoItem]) : undefined,
    summary: novel.description ? shortSummary(novel.description) : undefined,
    contentRating: contentRatingFor(splitGenres(novel.genres)),
  };
}

// One curated chip per broad genre; the full ~200-tag vocabulary belongs in the
// search form's exhaustive multi-select, not a horizontal chip row
const DISCOVER_GENRES = [
  "Fantasy",
  "Action",
  "Romance",
  "Isekai",
  "System",
  "Cultivation",
  "Xianxia",
  "Comedy",
  "Drama",
  "Horror",
  "Mystery",
  "Sci-Fi",
  "Slice of Life",
  "Adventure",
  "Harem",
  "School",
  "Reincarnation",
  "Martial Arts",
  "Supernatural",
  "Tragedy",
];

export function genreChipItems(): DiscoverSectionItem[] {
  return DISCOVER_GENRES.map((name) => ({
    type: "genresCarouselItem",
    name,
    searchQuery: { title: "", metadata: { genresInclude: [name.toLowerCase()] } },
    contentRating: ContentRating.MATURE,
  }));
}

// --- Manga details ---

export function toSourceManga(detail: NovelJson, mangaId: string): SourceManga {
  const genres = splitGenres(detail.genres);
  const tagGroups: TagSection[] =
    genres.length > 0
      ? [
          {
            id: "genres",
            title: "Genres",
            tags: genres.map((genre) => ({ id: genreId(genre.toLowerCase()), title: genre })),
          },
        ]
      : [];

  const thumbnailUrl = absoluteCoverUrl(detail.cover_url);

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: detail.description || "No synopsis.",
      primaryTitle: detail.title,
      secondaryTitles: detail.associated_names ?? [],
      contentRating: contentRatingFor(genres),
      contentType: "novel",
      author: detail.author,
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: novelUrl(mangaId),
    },
  };
}

// --- Chapters ---
// The novel-detail response's chapter_names is already the complete, ordered
// chapter list, so getChapters needs no extra request at all

// The `/chapters/<n>` endpoint is keyed by each novel's own internal chapter
// number. For fetching, that is verified to be **array position** for every
// novel sampled except one: "Archdemon's Dilemma: Volume 15", whose catalog
// genuinely starts at "Chapter 2" (chapter 1 was never imported), where
// position-based `/chapters/1` 404s and only `/chapters/2` (position + 1)
// works. Critically, the reverse mistake is worse than a 404: "Omniscient
// Reader's Viewpoint" opens with "Chapter 0" at position 1, so its embedded
// numbers imply offset -1 throughout — but `/chapters/0` is rejected
// ("Invalid chapter number") and, worse, `/chapters/1` (what a naive offset-1
// scheme would skip past) silently returns position 1's own content under a
// *different* position's request. Trusting embedded numbers for the fetch key
// therefore isn't just occasionally wrong, it can silently fetch the wrong
// chapter with no error at all. `chapterId` is plain array position,
// unconditionally; `getChapterDetails` only falls back to an offset-adjusted
// id after array position specifically 404s.
//
// A constant offset is only trustworthy *for display* (`chapNum`) when
// embedded "Chapter N" numbers (a) appear on most entries and (b) agree on a
// single offset from position — otherwise the numbers aren't a reliable
// global numbering scheme. Verified on "The Beginning After The End": 99% of
// entries match "Chapter N", but the offsets implied are scattered across
// -1/-2/-3/-6 (human-entered titles drifting from source-side
// renumbering/splits) with no value above 54% agreement, while `/chapters/<n>`
// there is confirmed to be plain array position throughout (`/chapters/517`
// returns position 517's content — whose own title text says "Chapter 511").
const MIN_MATCH_RATIO = 0.5;
const MIN_OFFSET_CONSENSUS = 0.9;

// "Chapter 001 - Title", "Chapter 2", "chapter 3", "Chapter 1: Title",
// "Chapter 165.2" (a genuine decimal sub-chapter) all match
const CHAPTER_PREFIX = /^chapter\s+0*(\d+(?:\.\d+)?)\s*[-:.—]?\s*(.*)$/i;
// Same shape, without the leading "chapter" keyword — used to catch a redundant
// repeated number in the remainder ("Chapter 1 - 1: Nightmare Begins")
const NUMBER_PREFIX = /^0*(\d+(?:\.\d+)?)\s*[-:.—]?\s*(.*)$/;
const NUMERIC_ONLY = /^[\d.\s]*$/;

function parseChapterNumber(name: string): number | undefined {
  const match = CHAPTER_PREFIX.exec(name.trim());
  return match ? Number(match[1]) : undefined;
}

// Always strips a "Chapter N" prefix (and a redundant repeated inner number,
// e.g. Shadow Slave / Reverend Insanity's "Chapter 1 - 1: Nightmare Begins")
// when present, *regardless* of whether N is this novel's trustworthy real
// chapter number — Paperback shows its own chapNum natively, so any visible
// competing number in the title is confusing whether or not it happens to be
// correct (verified: Re:Zero's untrusted "CHAPTER 112: THE INSTINCT TO REJECT
// WEAKNESS" reads far better as "THE INSTINCT TO REJECT WEAKNESS"). Text that
// never claimed to be "Chapter N" in the first place — an Arc/Volume scheme,
// or a genuinely custom-titled chapter — is shown untouched. A remainder left
// with nothing but digits/punctuation after stripping (a bare secondary
// number with no real title, e.g. "The Beginning After The End"'s
// "Chapter 523 - 517") carries no information worth showing at all.
function extractTitle(name: string): string | undefined {
  const trimmed = name.trim();
  const outer = CHAPTER_PREFIX.exec(trimmed);
  if (!outer) return trimmed || undefined;

  let remainder = (outer[2] ?? "").trim();
  const inner = NUMBER_PREFIX.exec(remainder);
  if (inner && Number(inner[1]) === Number(outer[1])) {
    remainder = (inner[2] ?? "").trim();
  }

  return remainder && !NUMERIC_ONLY.test(remainder) ? remainder : undefined;
}

type OffsetConsensus = { offset: number; trusted: boolean };

function detectNumberingOffset(names: string[]): OffsetConsensus {
  const offsetCounts = new Map<number, number>();
  let matched = 0;

  names.forEach((name, index) => {
    const number = parseChapterNumber(name);
    if (number === undefined) return;
    matched++;
    const offset = number - (index + 1);
    offsetCounts.set(offset, (offsetCounts.get(offset) ?? 0) + 1);
  });

  if (names.length === 0 || matched / names.length < MIN_MATCH_RATIO) {
    return { offset: 0, trusted: false };
  }

  let bestOffset = 0;
  let bestCount = 0;
  for (const [offset, count] of offsetCounts) {
    if (count > bestCount) {
      bestOffset = offset;
      bestCount = count;
    }
  }

  return bestCount / matched >= MIN_OFFSET_CONSENSUS
    ? { offset: bestOffset, trusted: true }
    : { offset: 0, trusted: false };
}

// The site's own hosted/merged content (chapter_names on GET /novels/<id>) is
// its own legitimate reading option, not a fallback to discard once real
// alternate sources exist — always included as its own version alongside
// whatever GET /novels/<id>/sources lists, never replaced by them. What's
// left here is deliberately conservative: a single trusted global offset, or
// plain sequential position. No multi-segment or literal-decimal handling —
// every novel that actually needed that (ghost story, TBATE) also has real
// alternate-source data and gets those as additional versions on top of this.
export const NOVELARCHIVE_VERSION_LABEL = "Novel Archive";

export function chaptersFromDetail(detail: NovelJson, sourceManga: SourceManga): Chapter[] {
  const { offset } = detectNumberingOffset(detail.chapter_names);

  return detail.chapter_names.map((name, index) => {
    const title = extractTitle(name);

    const chapter: Chapter = {
      chapterId: String(index + 1),
      sourceManga,
      langCode: "en",
      chapNum: index + 1 + offset,
      volume: 0,
      version: NOVELARCHIVE_VERSION_LABEL,
    };
    if (title) chapter.title = title;
    // getChapterDetails' fallback candidate when position-based fetch 404s —
    // only ever set (and only ever tried) for the trusted, non-zero-offset case
    if (offset !== 0) chapter.additionalInfo = { offset: String(offset) };
    return chapter;
  });
}

// --- Per-source chapters (novels with real alternate sources) ---
// Each source's own chapter list gives a clean `number` field directly per
// entry — no consensus/offset guessing needed at all. Verified: fetching by
// that literal number is reliable per source (unlike the merged endpoint,
// where trusting an embedded text number can silently return the wrong
// chapter — see the getChapterDetails note above). Numbers can have gaps
// (ranobes' list is 620 entries long but its numbers run past 625) but are
// always usable directly as both chapterId and chapNum.

export type NovelSource = { id: string; label: string };
export type SourceListResponse = { sources: NovelSource[] };

export type SourceChapterListEntry = { number: number; title: string };
export type SourceChapterListResponse = { chapters: SourceChapterListEntry[] };

export type SourceChapterDetailResponse = { content_html: string };

// A source's own title text takes a few different shapes: a bare local/
// arc-relative number with no descriptive text at all (Ranobes: "1", "2",
// "3", resetting per arc — pure noise next to Paperback's own chapNum label);
// the usual "Chapter N ..." (fucknovelpia); or a bare "<number> Title" with
// no "Chapter" keyword at all (NovelFire: "1 Nightmare Begins") — verified
// directly against the API, not assumed. The bare-number case is only
// stripped when it equals this chapter's own real number, the same
// mismatch-guard extractTitle already applies to the "Chapter N" case.
function extractSourceTitle(title: string, number: number): string | undefined {
  const trimmed = title.trim();
  if (!trimmed || NUMERIC_ONLY.test(trimmed)) return undefined;

  const bare = NUMBER_PREFIX.exec(trimmed);
  if (bare && Number(bare[1]) === number) {
    const remainder = (bare[2] ?? "").trim();
    return remainder && !NUMERIC_ONLY.test(remainder) ? remainder : undefined;
  }

  return extractTitle(trimmed);
}

export function chaptersFromSource(
  source: NovelSource,
  list: SourceChapterListResponse,
  sourceManga: SourceManga,
): Chapter[] {
  return list.chapters.map((entry) => {
    const chapter: Chapter = {
      chapterId: `${source.id}:${entry.number}`,
      sourceManga,
      langCode: "en",
      chapNum: entry.number,
      volume: 0,
      version: source.label,
    };
    const title = extractSourceTitle(entry.title, entry.number);
    if (title) chapter.title = title;
    return chapter;
  });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Chapter content is plain text with paragraphs separated by one or more newlines
// (observed as a single \n on some novels, \n\n on others, depending on the
// upstream source) — split on one-or-more, never a fixed delimiter
function toXhtml(content: string): string {
  const body = content
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeXml(paragraph)}</p>`)
    .join("");

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

export function toChapterDetails(json: ChapterJson, chapter: Chapter): ChapterDetails {
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(json.chapter.content),
  };
}

// Per-source chapter content is real HTML (images, headings, <hr>), unlike
// the merged endpoint's plain text — the app parses html chapters as XML, so
// unclosed void elements and named entities beyond XML's five predefined ones
// are fatal. Same discipline as LNORI's transform, adapted for this site:
// close every void tag, map common named entities to numeric references, and
// degrade anything unmapped to visible text instead of a fatal parse error.
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

function toXhtmlFromHtml(html: string): string {
  const body = html
    .replace(VOID_TAG, (_match, tag: string, attrs: string) => `<${tag}${attrs}/>`)
    .replace(NAMED_REF, (match: string, name: string) => {
      if (XML_ENTITIES.has(name)) return match;
      const codePoint = ENTITY_CODEPOINTS[name];
      return codePoint === undefined ? `&amp;${name};` : `&#${codePoint};`;
    });

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

export function toChapterDetailsFromSource(
  json: SourceChapterDetailResponse,
  chapter: Chapter,
): ChapterDetails {
  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtmlFromHtml(json.content_html),
  };
}

// --- Genre catalog (search form + resolving filter chip ids back to API values) ---

export type GenreOption = { id: string; label: string; value: string };

export function toGenreOptions(response: GenresResponse): GenreOption[] {
  return response.genres.map((genre) => ({
    id: genreId(genre.value),
    label: genre.label,
    value: genre.value,
  }));
}
