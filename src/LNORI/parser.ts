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

export const LNORI_DOMAIN = "https://lnori.com";

export const DISCOVER_FEATURED = "featured";
export const DISCOVER_SEASONAL = "seasonal";
export const DISCOVER_POPULAR = "popular";
export const DISCOVER_GENRES = "genres";

// The genre chips launch a filtered search through this; keys are always assigned,
// never set to undefined (the Metadata JSValue rule)
export type LNORISearchMetadata = { genre?: string };

export function homeUrl(): string {
  return `${LNORI_DOMAIN}/`;
}

export function libraryUrl(): string {
  return `${LNORI_DOMAIN}/library`;
}

// `mangaId` is the `<id>/<slug>` path pair: bare numeric ids 404, the site never redirects
export function seriesUrl(mangaId: string): string {
  return `${LNORI_DOMAIN}/series/${mangaId}`;
}

// A split chapter's id is `<bookPath>#<anchor>`; the request drops the fragment
export function bookUrl(chapterId: string): string {
  const path = chapterId.split("#")[0]!;
  return `${LNORI_DOMAIN}/book/${path}`;
}

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

// Attribute values are HTML-escaped, so they can never contain a raw double quote
function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  const value = match?.[1];
  return value ? decodeEntities(value) : undefined;
}

// --- Library (browse + search) ---

// The library page embeds the whole catalog as cards; the site's own search is
// client-side over it, so the extension filters the same data locally
export type LibraryEntry = {
  mangaId: string;
  title: string;
  author?: string;
  imageUrl: string;
  tags: string[];
  popularity: number;
};

const LIBRARY_CARD = /<article class="card"[\s\S]*?<\/article>/g;
const SERIES_HREF = /href="\/series\/(\d+\/[^"]+)"/;
const CARD_COVER = /<img src="([^"]*)"/;

export function parseLibrary(html: string): LibraryEntry[] {
  const entries: LibraryEntry[] = [];

  for (const match of html.matchAll(LIBRARY_CARD)) {
    const card = match[0];
    const mangaId = SERIES_HREF.exec(card)?.[1];
    const title = attribute(card, "data-t");
    if (!mangaId || !title) continue;

    const tags = (attribute(card, "data-tags") ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    const entry: LibraryEntry = {
      mangaId,
      title,
      imageUrl: CARD_COVER.exec(card)?.[1] ?? "",
      tags,
      popularity: Number(attribute(card, "data-rel")) || 0,
    };
    const author = attribute(card, "data-a");
    if (author) entry.author = author;

    entries.push(entry);
  }

  return entries;
}

// Genre slugs hyphenate what the card tags write with spaces ("anime-tie-in" vs
// "anime tie-in"), so both sides are normalised before comparing
function normalizeTag(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim();
}

export function searchLibrary(
  entries: LibraryEntry[],
  title: string | undefined,
  genre?: string,
): LibraryEntry[] {
  let matches = entries;

  if (genre) {
    const wanted = normalizeTag(genre);
    matches = matches.filter((entry) => entry.tags.some((tag) => normalizeTag(tag) === wanted));
  }

  const needle = title?.trim().toLowerCase();
  if (!needle) return matches;

  return matches.filter(
    (entry) =>
      entry.title.toLowerCase().includes(needle) ||
      (entry.author?.toLowerCase().includes(needle) ?? false),
  );
}

export function toSearchResultItem(entry: LibraryEntry): SearchResultItem {
  return {
    mangaId: entry.mangaId,
    title: entry.title,
    subtitle: entry.author,
    imageUrl: entry.imageUrl,
    contentRating: ContentRating.MATURE,
  };
}

// --- Homepage (discover sections) ---

const SERIES_PATH = /^\/series\/(\d+\/.+)$/;

function seriesPath(link: string | undefined): string | undefined {
  return link ? SERIES_PATH.exec(link)?.[1] : undefined;
}

// The hero rotates cards that carry everything as data attributes
const HERO_CARD = /<div class="hero-carousel-card[^>]*>/g;

export function parseFeaturedItems(html: string): DiscoverSectionItem[] {
  const items: DiscoverSectionItem[] = [];

  for (const match of html.matchAll(HERO_CARD)) {
    const card = match[0];
    const mangaId = seriesPath(attribute(card, "data-link"));
    const title = attribute(card, "data-title");
    if (!mangaId || !title) continue;

    items.push({
      type: "featuredCarouselItem",
      mangaId,
      title,
      supertitle: attribute(card, "data-author"),
      summary: attribute(card, "data-desc"),
      imageUrl: attribute(card, "data-image") ?? "",
      contentRating: ContentRating.MATURE,
    });
  }

  return items;
}

// The seasonal block is anchored by its "Seasonal Preview" kicker; its heading names
// the season ("SUMMER 2026 ANIME"), so the section title comes from the page
const SEASONAL_HEADING = /Seasonal Preview<\/span><h2[^>]*>([^<]+)<\/h2>/;
const SEASONAL_END = 'id="library-heading"';
const SEASONAL_ENTRY = /<a href="(\/series\/[^"]+)"[\s\S]*?<img src="([^"]*)" alt="([^"]*)"/g;

export function parseSeasonalTitle(html: string): string | undefined {
  const heading = SEASONAL_HEADING.exec(html)?.[1];
  if (!heading) return undefined;
  return decodeEntities(heading)
    .trim()
    .toLowerCase()
    .replace(/(?:^|\s)\S/g, (letter) => letter.toUpperCase());
}

export function parseSeasonalItems(html: string): DiscoverSectionItem[] {
  const start = SEASONAL_HEADING.exec(html)?.index ?? -1;
  if (start < 0) return [];
  const end = html.indexOf(SEASONAL_END, start);
  const block = html.slice(start, end > start ? end : undefined);

  const items: DiscoverSectionItem[] = [];
  for (const match of block.matchAll(SEASONAL_ENTRY)) {
    const mangaId = seriesPath(match[1]);
    if (!mangaId) continue;

    items.push({
      type: "simpleCarouselItem",
      mangaId,
      title: decodeEntities(match[3] ?? "").trim() || "Unknown Title",
      imageUrl: match[2] ?? "",
      contentRating: ContentRating.MATURE,
    });
  }
  return items;
}

// Popularity is the library's own relevance rank, so this costs no extra request
export function popularItems(entries: LibraryEntry[], limit = 30): DiscoverSectionItem[] {
  return entries
    .filter((entry) => entry.popularity > 0)
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, limit)
    .map((entry) => ({
      type: "simpleCarouselItem" as const,
      mangaId: entry.mangaId,
      title: entry.title,
      subtitle: entry.author,
      imageUrl: entry.imageUrl,
      contentRating: ContentRating.MATURE,
    }));
}

// One chip per genre, each launching a filtered search over the library
const GENRE_LINK = /<a href="\/genre\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/g;
const GENRE_END = 'id="footer-discovery"';

export function parseGenreItems(html: string): DiscoverSectionItem[] {
  const end = html.indexOf(GENRE_END);
  const block = end > 0 ? html.slice(0, end) : html;

  const seen = new Set<string>();
  const items: DiscoverSectionItem[] = [];

  for (const match of block.matchAll(GENRE_LINK)) {
    const slug = match[1]!;
    if (seen.has(slug)) continue;
    seen.add(slug);

    // The site's link text is lowercase behind an emoji ("🎓 academy"); the chip
    // keeps just the words, title-cased
    const text = decodeEntities(match[2]!.replace(INNER_TAG, ""))
      .replace(/^[^a-zA-Z0-9]+/, "")
      .trim();
    const name = (text || slug.replace(/-/g, " ")).replace(/(?:^|\s)\S/g, (letter) =>
      letter.toUpperCase(),
    );

    items.push({
      type: "genresCarouselItem",
      name,
      searchQuery: { title: "", metadata: { genre: slug } },
      contentRating: ContentRating.MATURE,
    });
  }

  return items;
}

// --- Series page (details + volume list) ---

// Series and book pages describe themselves in schema.org Book JSON-LD; the series
// entry's `hasPart` lists every volume, so no HTML is parsed at all
type LdPerson = { name?: string };

type LdBook = {
  "@type"?: string;
  name?: string;
  description?: string;
  genre?: string;
  image?: string;
  url?: string;
  datePublished?: string;
  author?: LdPerson | LdPerson[];
  hasPart?: { name?: string; position?: string; url?: string }[];
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
  throw new Error("No Book JSON-LD found on the LNORI page");
}

function authorNames(author: LdBook["author"]): string | undefined {
  const people = Array.isArray(author) ? author : author ? [author] : [];
  const names = people.map((person) => person.name).filter((name) => !!name);
  return names.length > 0 ? names.join(", ") : undefined;
}

export function parseSeriesDetails(html: string, mangaId: string): SourceManga {
  const book = findBookLd(html);

  const genres = (book.genre ?? "")
    .split(",")
    .map((genre) => genre.trim())
    .filter((genre) => genre.length > 0);
  const tagGroups: TagSection[] =
    genres.length > 0
      ? [
          {
            id: "genres",
            title: "Genres",
            tags: genres.map((genre) => ({ id: genre.replaceAll(" ", "-"), title: genre })),
          },
        ]
      : [];

  const thumbnailUrl = book.image ?? "";

  return {
    mangaId,
    mangaInfo: {
      thumbnailUrl,
      synopsis: book.description ?? "No synopsis.",
      primaryTitle: book.name ?? "Unknown Title",
      secondaryTitles: [],
      contentRating: ContentRating.MATURE,
      contentType: "novel",
      author: authorNames(book.author),
      tagGroups,
      artworkUrls: thumbnailUrl ? [thumbnailUrl] : [],
      shareUrl: book.url ?? seriesUrl(mangaId),
    },
  };
}

export type VolumeRef = { path: string; position: number; name?: string };

export function parseVolumeList(html: string): VolumeRef[] {
  const book = findBookLd(html);
  const volumes: VolumeRef[] = [];

  for (const [index, part] of (book.hasPart ?? []).entries()) {
    const path = part.url?.split("/book/")[1];
    if (!path) continue;

    const position = Number(part.position);
    const volume: VolumeRef = {
      path,
      position: Number.isFinite(position) && position > 0 ? position : index + 1,
    };
    if (part.name) volume.name = part.name;

    volumes.push(volume);
  }

  return volumes;
}

// --- Book page TOC (the volume's own chapters) ---

export type TocEntry = { anchor: string; title: string };

const TOC_START = "toc-sidebar";
const TOC_END = "content-wrapper";
const TOC_LINK = /<a[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
const INNER_TAG = /<[^>]+>/g;

// Every book page opens with a sidebar TOC whose anchors (#pageNN) match the
// content's own section ids, and whose text carries the real chapter titles
export function parseVolumeToc(html: string): TocEntry[] {
  const start = html.indexOf(TOC_START);
  // From `start`, not 0: "content-wrapper" also appears above the sidebar on some pages.
  const end = html.indexOf(TOC_END, start);
  if (start < 0 || end <= start) return [];

  const entries: TocEntry[] = [];
  for (const match of html.matchAll(TOC_LINK)) {
    const at = match.index ?? -1;
    if (at < start || at > end) continue;
    const title = decodeEntities(match[2]!.replace(INNER_TAG, "")).trim();
    if (title) entries.push({ anchor: match[1]!, title });
  }
  return entries;
}

export function parseBookPublishDate(html: string): Date | undefined {
  const published = findBookLd(html).datePublished;
  if (!published) return undefined;
  const date = new Date(published);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Novels disagree on numbering: some prefix titles with "Chapter N", some (like
// Bookworm) never number at all. Titled chapters keep their own number, front and
// back matter interpolate as decimals around them (Prologue 0.1, Epilogue N.1),
// and a fully unnumbered TOC falls back to plain ordinals.
const EXPLICIT_CHAPTER = /^Chapter\s+(\d+(?:\.\d+)?)\s*[:.—-]?\s*(.*)$/i;

const INTERPOLATION_STEP = 0.1;

type NumberedEntry = { chapNum: number; title: string; anchor: string };

export function numberTocEntries(entries: TocEntry[]): NumberedEntry[] {
  const explicit = entries.map((entry) => EXPLICIT_CHAPTER.exec(entry.title));
  if (explicit.every((match) => match === null)) {
    return entries.map((entry, index) => ({
      chapNum: index + 1,
      title: entry.title,
      anchor: entry.anchor,
    }));
  }

  // How many unnumbered entries run from `index`, so a run can be sized to fit in its own gap
  const runLength = (index: number): number => {
    let length = 0;
    while (index + length < entries.length && explicit[index + length] === null) length++;
    return length;
  };

  let previous = 0;
  let step = INTERPOLATION_STEP;
  let position = 0;

  return entries.map((entry, index) => {
    const match = explicit[index];
    if (match) {
      previous = Number(match[1]);
      position = 0;
      // Keep the subtitle if there is one; "Chapter 2" alone stays as-is
      return { chapNum: previous, title: match[2] || entry.title, anchor: entry.anchor };
    }

    // Ten entries at 0.1 would land on `previous + 1` and collide with that real chapter, which
    // the app then collapses as two versions of one. Long runs step smaller; nine or fewer don't.
    if (position === 0) step = Math.min(INTERPOLATION_STEP, 1 / (runLength(index) + 1));
    position++;

    return {
      chapNum: Math.round((previous + position * step) * 10_000) / 10_000,
      title: entry.title,
      anchor: entry.anchor,
    };
  });
}

// One volume's TOC becomes its chapters; a volume whose TOC cannot be read
// degrades to a single whole-volume chapter
export function volumeChapters(
  volume: VolumeRef,
  toc: TocEntry[],
  publishDate: Date | undefined,
  sourceManga: SourceManga,
): Chapter[] {
  if (toc.length === 0) {
    const fallback: Chapter = {
      chapterId: volume.path,
      sourceManga,
      langCode: "en",
      chapNum: 1,
      volume: volume.position,
      title: volume.name,
    };
    if (publishDate) fallback.publishDate = publishDate;
    return [fallback];
  }

  return numberTocEntries(toc).map((entry, index) => {
    const additionalInfo: Record<string, string> = { anchor: entry.anchor };
    const next = toc[index + 1];
    if (next) additionalInfo.nextAnchor = next.anchor;

    const chapter: Chapter = {
      chapterId: `${volume.path}#${entry.anchor}`,
      sourceManga,
      langCode: "en",
      chapNum: entry.chapNum,
      volume: volume.position,
      title: entry.title,
      additionalInfo,
    };
    if (publishDate) chapter.publishDate = publishDate;
    return chapter;
  });
}

// --- Book page (the volume's text) ---

const CONTENT_START = '<article class="content-body';
const CONTENT_END = "</article>";

// The site wraps each illustration in <picture> with jxl/avif <source> fallbacks
const PICTURE = /<picture>([\s\S]*?)<\/picture>/g;
const IMG_SRC = /<img\b[^>]*\bsrc="([^"]*)"/;
const IMG_ALT = /<img\b[^>]*\balt="([^"]*)"/;
// HTML5 void elements, which the site serializes unclosed
const VOID_TAG =
  /<(img|br|hr|source|wbr|area|col|embed|input|link|meta|track|param|base)(\b[^>]*?)\s*\/?>/gi;
const EPUB_ATTR = /\s+epub:type="[^"]*"/g;
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;

// XML predefines only these five; every other named entity is fatal to the reader
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

// Code points for the named entities HTML books actually use
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

// The app parses an html chapter as XML, so well-formedness is fatal on every
// count: unclosed void tags, the undeclared epub: namespace prefix, and any named
// entity beyond XML's five (`&nbsp;` broke real volumes). Elements also only get
// their HTML semantics inside an XHTML-namespaced document — served as a bare
// fragment, <p> and <img> are anonymous XML elements, the whole book renders as
// one run-together line, and images are ignored.
function toXhtml(content: string): string {
  const body = content
    .replace(PICTURE, (wrapper: string) => {
      const src = IMG_SRC.exec(wrapper)?.[1];
      if (!src) return "";
      const alt = IMG_ALT.exec(wrapper)?.[1] ?? "";
      return `<img src="${src}" alt="${alt}"/>`;
    })
    .replace(EPUB_ATTR, "")
    .replace(VOID_TAG, "<$1$2/>")
    .replace(NAMED_REF, (match: string, name: string) => {
      if (XML_ENTITIES.has(name)) return match;
      const codePoint = ENTITY_CODEPOINTS[name];
      // An unmapped entity degrades to visible text instead of a fatal parse error
      return codePoint === undefined ? `&amp;${name};` : `&#${codePoint};`;
    });

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}

// TOC anchors name the content's own page-section wrappers, so a chapter runs from
// its section to the next TOC entry's section (spanning untitled sections between)
function sectionStart(html: string, anchor: string): number {
  return html.indexOf(`<section class="chapter" id="${anchor}">`);
}

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const articleStart = html.indexOf(CONTENT_START);
  const articleEnd = html.lastIndexOf(CONTENT_END);
  if (articleStart < 0 || articleEnd <= articleStart) {
    throw new Error(`LNORI served no readable content for ${chapter.title ?? chapter.chapterId}`);
  }

  let start = articleStart;
  let end = articleEnd + CONTENT_END.length;

  // A whole-volume fallback chapter carries no anchor and keeps the full article;
  // an unlocatable anchor also degrades to the full volume rather than failing
  const anchor = chapter.additionalInfo?.anchor;
  if (anchor) {
    const from = sectionStart(html, anchor);
    if (from >= 0) {
      start = from;
      end = articleEnd;
      const nextAnchor = chapter.additionalInfo?.nextAnchor;
      if (nextAnchor) {
        const to = sectionStart(html, nextAnchor);
        if (to > from) end = to;
      }
    }
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(html.slice(start, end)),
  };
}
