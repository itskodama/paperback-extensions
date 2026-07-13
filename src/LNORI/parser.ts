/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ContentRating,
  type Chapter,
  type ChapterDetails,
  type SearchResultItem,
  type SourceManga,
  type TagSection,
} from "@paperback/types";

export const LNORI_DOMAIN = "https://lnori.com";

export function libraryUrl(): string {
  return `${LNORI_DOMAIN}/library`;
}

// `mangaId` is the `<id>/<slug>` path pair: bare numeric ids 404, the site never redirects
export function seriesUrl(mangaId: string): string {
  return `${LNORI_DOMAIN}/series/${mangaId}`;
}

export function bookUrl(chapterId: string): string {
  return `${LNORI_DOMAIN}/book/${chapterId}`;
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

    const entry: LibraryEntry = {
      mangaId,
      title,
      imageUrl: CARD_COVER.exec(card)?.[1] ?? "",
    };
    const author = attribute(card, "data-a");
    if (author) entry.author = author;

    entries.push(entry);
  }

  return entries;
}

export function searchLibrary(entries: LibraryEntry[], title: string | undefined): LibraryEntry[] {
  const needle = title?.trim().toLowerCase();
  if (!needle) return entries;

  return entries.filter(
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

// One Paperback chapter is one volume: the volume's whole text arrives in a single
// page, and listing finer-grained chapters would need a fetch per volume upfront
export function parseChapterList(html: string, sourceManga: SourceManga): Chapter[] {
  const book = findBookLd(html);
  const chapters: Chapter[] = [];

  for (const [index, part] of (book.hasPart ?? []).entries()) {
    const path = part.url?.split("/book/")[1];
    if (!path) continue;

    const position = Number(part.position);
    const chapNum = Number.isFinite(position) && position > 0 ? position : index + 1;

    chapters.push({
      chapterId: path,
      sourceManga,
      langCode: "en",
      chapNum,
      volume: 0,
      title: part.name,
      sortingIndex: chapNum,
    });
  }

  return chapters;
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
  /<(img|br|hr|source|wbr|area|col|embed|input|link|meta|track|param|base)(\b[^>]*?)\s*\/?>/g;
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

export function parseChapterDetails(html: string, chapter: Chapter): ChapterDetails {
  const start = html.indexOf(CONTENT_START);
  const end = html.lastIndexOf(CONTENT_END);
  if (start < 0 || end <= start) {
    throw new Error(`LNORI served no readable content for ${chapter.title ?? chapter.chapterId}`);
  }

  return {
    id: chapter.chapterId,
    mangaId: chapter.sourceManga.mangaId,
    type: "html",
    html: toXhtml(html.slice(start, end + CONTENT_END.length)),
  };
}
