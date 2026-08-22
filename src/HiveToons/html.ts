/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Generic HTML string handling. Nothing here knows anything about HiveToons.
 *
 * The API returns markup in two places that need opposite treatment: a series' `postContent` is
 * HTML but `MangaInfo.synopsis` is a plain-text field, while a novel chapter's `content` stays
 * markup and has to become a well-formed XHTML document.
 *
 * There is no DOM and no HTML parser in this runtime, so these are regex helpers.
 */

const VOID_TAG =
  /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)\/?>/gi;
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;
const NUMERIC_REF = /&#(x[0-9a-fA-F]+|\d+);/g;
const ANY_TAG = /<[^>]*>/g;
const LINE_BREAK = /<br\b[^>]*\/?>/gi;
const BLOCK_END = /<\/(?:p|div|li|h[1-6]|blockquote)\s*>/gi;

/** The only five an XML parser knows without a declaration. */
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

const ENTITY_CHARACTERS: Record<string, string> = {
  amp: "&",
  apos: "'",
  bull: "•",
  copy: "©",
  deg: "°",
  frac12: "½",
  gt: ">",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  lt: "<",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  quot: '"',
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  shy: "­",
  times: "×",
  trade: "™",
};

function decodeNumeric(html: string): string {
  return html.replace(NUMERIC_REF, (match, reference: string) => {
    const code =
      reference.startsWith("x") || reference.startsWith("X")
        ? Number.parseInt(reference.slice(1), 16)
        : Number.parseInt(reference, 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : match;
  });
}

/**
 * Visible text of a fragment. The site stores synopses as full markup — paragraphs, styled spans
 * pasted out of Discord, the occasional `<strong>` — where the app's synopsis is plain text and
 * would print the tags verbatim.
 */
export function toPlainText(html: string): string {
  const spaced = html.replace(LINE_BREAK, "\n").replace(BLOCK_END, "\n\n");
  const decoded = decodeNumeric(
    spaced
      .replace(ANY_TAG, "")
      .replace(NAMED_REF, (match, name: string) => ENTITY_CHARACTERS[name] ?? match),
  );

  return decoded
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * An unknown entity becomes visible text rather than a fatal parse error — losing one glyph is a
 * blemish, where refusing to open the chapter is not.
 */
function resolveEntities(html: string): string {
  return html.replace(NAMED_REF, (match, name: string) => {
    if (XML_ENTITIES.has(name)) return match;
    return ENTITY_CHARACTERS[name] ?? `&amp;${name};`;
  });
}

/**
 * The novel reader parses `html` chapters with an **XML** parser and only applies HTML semantics
 * inside the XHTML namespace, so ordinary markup fails in two different ways — a fatal parse
 * error, or a document that parses and then renders as one run-together line. See
 * docs/paperback/html-chapters.md; both failures are device-only.
 */
export function toXhtml(fragment: string): string {
  const body = resolveEntities(
    fragment.replace(
      VOID_TAG,
      (_match, tag: string, attrs: string) => `<${tag}${attrs.trimEnd()}/>`,
    ),
  );

  // Without the namespace the XML parses but every element is anonymous, so the whole chapter
  // renders as a single wrapped line.
  return `<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>${body}</body></html>`;
}
