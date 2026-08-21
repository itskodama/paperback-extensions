/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Generic HTML string handling. Nothing here knows anything about FreeWebNovel —
 * site-specific reading lives in `parsers.ts`.
 *
 * There is no DOM and no HTML parser in this runtime, and bundling one would cost
 * roughly fourteen times the whole extension (`docs/paperback/runtime.md`), so
 * these are regex and index helpers.
 */

const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

export function decodeEntities(value: string): string {
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

const INNER_TAG = /<[^>]+>/g;

/** Visible text of a fragment, tags removed and entities resolved. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(INNER_TAG, "")).trim();
}

/** First capture group of `pattern`, decoded, or undefined when it does not match. */
export function capture(html: string, pattern: RegExp): string | undefined {
  const value = pattern.exec(html)?.[1];
  return value === undefined ? undefined : decodeEntities(value);
}

export function metaContent(html: string, property: string): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return capture(
    html,
    new RegExp(`<meta[^>]*(?:property|name)="${escaped}"[^>]*content="([^"]*)"`, "i"),
  );
}

/** The `<div>` starting at `start`, through its own close, counting nested divs. */
function divAt(html: string, start: number): string | undefined {
  const boundaries = /<div\b[^>]*>|<\/div\s*>/gi;
  boundaries.lastIndex = start;

  let depth = 0;
  let boundary: RegExpExecArray | null;
  while ((boundary = boundaries.exec(html)) !== null) {
    depth += boundary[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, boundary.index + boundary[0].length);
  }
  return undefined;
}

function globalised(pattern: RegExp): RegExp {
  return pattern.flags.includes("g")
    ? new RegExp(pattern.source, pattern.flags)
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

/** The `[start, end)` range of every `<div>` whose opening tag matches. */
function divRanges(html: string, openPattern: RegExp): [number, number][] {
  const scanner = globalised(openPattern);
  const ranges: [number, number][] = [];

  let cursor = 0;
  let opening: RegExpExecArray | null;
  while ((opening = scanner.exec(html)) !== null) {
    // A match nested inside a range already taken is behind the cursor.
    if (opening.index < cursor) continue;
    const block = divAt(html, opening.index);
    if (!block) continue;
    cursor = opening.index + block.length;
    ranges.push([opening.index, cursor]);
    scanner.lastIndex = cursor;
  }
  return ranges;
}

/**
 * The element whose opening tag matches `openPattern`, through its balanced close.
 *
 * A non-greedy `<div id="x">([\s\S]*?)</div>` stops at the first *nested* close,
 * which on this site truncates a chapter at its first inlined ad block.
 */
export function balancedDiv(html: string, openPattern: RegExp): string | undefined {
  const first = divRanges(html, openPattern)[0];
  return first ? html.slice(first[0], first[1]) : undefined;
}

/** Every matching `<div>`, each through its own balanced close. */
export function balancedDivs(html: string, openPattern: RegExp): string[] {
  return divRanges(html, openPattern).map(([start, end]) => html.slice(start, end));
}

/** Drops every `<div>` whose opening tag matches, including its whole subtree. */
export function removeDivs(html: string, openPattern: RegExp): string {
  let kept = "";
  let cursor = 0;
  for (const [start, end] of divRanges(html, openPattern)) {
    kept += html.slice(cursor, start);
    cursor = end;
  }
  return kept + html.slice(cursor);
}

const SCRIPT_OR_STYLE = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const COMMENT = /<!--[\s\S]*?-->/g;

export function removeScripts(html: string): string {
  return html.replace(SCRIPT_OR_STYLE, "").replace(COMMENT, "");
}

const VOID_TAG =
  /<(img|br|hr|source|wbr|area|col|embed|input|link|meta|track|param|base)(\b[^>]*?)\s*\/?>/gi;
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const BARE_AMPERSAND = /&(?!#\d+;|#[xX][0-9a-fA-F]+;|[a-zA-Z][a-zA-Z0-9]*;)/g;

/** XML predefines only these five; every other named entity is fatal to the reader. */
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

/** Code points for the named entities prose actually uses. */
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

/**
 * A complete XHTML document, which is what the reader needs — not a fragment.
 * Without the namespace the XML parses but every element is anonymous, so a whole
 * chapter renders as one run-together line. See `docs/paperback/html-chapters.md`.
 */
export function toXhtmlDocument(body: string): string {
  const content = body
    .replace(VOID_TAG, "<$1$2/>")
    // A bare `&` — "AT&T", "R&D" — is as fatal to the XML parser as a bad entity.
    .replace(BARE_AMPERSAND, "&amp;")
    .replace(NAMED_REF, (match, name: string) => {
      if (XML_ENTITIES.has(name)) return match;
      const codePoint = ENTITY_CODEPOINTS[name];
      // An unmapped entity degrades to visible text instead of a fatal parse error
      return codePoint === undefined ? `&amp;${name};` : `&#${codePoint};`;
    });

  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${content}</body></html>`;
}

const ID_UNSAFE = /[^a-z0-9._\-@()[\]%?#+=/&:]+/g;

/**
 * A bridge-safe id. Any `ID` crossing to Swift must be alphanumeric or contain
 * only ``._-@()[]%?#+=/&:`` — a raw genre such as "Slice of Life" throws the
 * moment the value is decoded, which has shipped as a crash here twice.
 */
export function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(ID_UNSAFE, "-")
    .replace(/^-+|-+$/g, "");
}
