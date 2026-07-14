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

// For a novel where "Chapter N" is clearly the numbering scheme (most entries
// parse) but not consistently offset from position — multiple sources
// concatenated (ghost-story), or genuine source-side renumbering drift (TBATE)
// — each entry's own literal number (decimals included, e.g. 165.2) is used
// directly rather than discarded, since it's real information from the site
// and doesn't collide with anything: reading *order* is guaranteed separately
// by `sortingIndex`, so chapNum no longer needs to be monotonic to display
// correctly, only unique. A sparse entry with no parseable number (or whose
// number was already claimed) gets a small step past the previous chapNum,
// the same way LNORI orders unnumbered front matter between real chapters.
function literalNumbersWithGapFill(names: string[]): number[] {
  const candidates = names.map(parseChapterNumber);
  const used = new Set<number>();
  const result: (number | undefined)[] = Array.from({ length: names.length });

  // Pass 1: claim each literal number for its first occurrence only, before
  // any gap-filling happens — otherwise an earlier unmatched entry's fallback
  // guess can claim a value that a later entry's *real* number needed (an
  // early "no candidate" gap defaulting to plain position 1 would otherwise
  // permanently displace a genuine "Chapter 1" a few entries later)
  candidates.forEach((candidate, index) => {
    if (candidate !== undefined && !used.has(candidate)) {
      used.add(candidate);
      result[index] = candidate;
    }
  });

  function freeStep(base: number, step: number): number {
    let value = Math.round((base + step) * 1000) / 1000;
    while (used.has(value)) value = Math.round((value + step) * 1000) / 1000;
    return value;
  }

  // Pass 2: fill every remaining gap (no candidate, or a duplicate of an
  // already-claimed number) with a small step past the previous *resolved*
  // chapNum — or, before any chapNum has resolved yet, a small step before
  // the next one that will
  let previous: number | undefined;
  for (let i = 0; i < result.length; i++) {
    if (result[i] === undefined) {
      let value: number;
      if (previous !== undefined) {
        value = freeStep(previous, 0.001);
      } else {
        let forward = i + 1;
        while (forward < result.length && result[forward] === undefined) forward++;
        value = forward < result.length ? freeStep(result[forward]!, -0.001) : freeStep(i, 1);
      }
      used.add(value);
      result[i] = value;
    }
    previous = result[i];
  }

  return result as number[];
}

export function chaptersFromDetail(detail: NovelJson, sourceManga: SourceManga): Chapter[] {
  const { offset, trusted } = detectNumberingOffset(detail.chapter_names);
  const matched = detail.chapter_names.filter(
    (name) => parseChapterNumber(name) !== undefined,
  ).length;
  const matchRatio = detail.chapter_names.length > 0 ? matched / detail.chapter_names.length : 0;

  let chapNums: number[];
  if (trusted) {
    // One clean, whole-array relationship to position — Archdemon's Dilemma,
    // Miss Fairy, Shadow Slave, Reverend Insanity, PTSD Chaplain, House of the
    // Wolf all land here at 100% consensus
    chapNums = detail.chapter_names.map((_, index) => index + 1 + offset);
  } else if (matchRatio >= MIN_MATCH_RATIO) {
    // "Chapter N" is real but not offset-consistent — ghost-story, TBATE
    chapNums = literalNumbersWithGapFill(detail.chapter_names);
  } else {
    // No real "Chapter N" scheme at all (Re:Zero's Arc/Volume text) — plain
    // sequential is the only safe default
    chapNums = detail.chapter_names.map((_, index) => index + 1);
  }

  return detail.chapter_names.map((name, index) => {
    const title = extractTitle(name);

    const chapter: Chapter = {
      chapterId: String(index + 1),
      sourceManga,
      langCode: "en",
      chapNum: chapNums[index]!,
      volume: 0,
      // chapNum is no longer guaranteed monotonic with position (the literal-
      // number tier can legitimately go "backward" in value, e.g. 374 then
      // 165.2), so the app needs this to keep the list in true reading order
      sortingIndex: index,
    };
    if (title) chapter.title = title;
    // getChapterDetails' fallback candidate when position-based fetch 404s —
    // only ever set (and only ever tried) for the trusted, non-zero-offset case
    if (offset !== 0) chapter.additionalInfo = { offset: String(offset) };
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

// --- Genre catalog (search form + resolving filter chip ids back to API values) ---

export type GenreOption = { id: string; label: string; value: string };

export function toGenreOptions(response: GenresResponse): GenreOption[] {
  return response.genres.map((genre) => ({
    id: genreId(genre.value),
    label: genre.label,
    value: genre.value,
  }));
}
