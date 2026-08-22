/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Turning a site's HTML fragment into the XHTML document the novel reader requires.
 *
 * Nothing here knows anything about HiveToons. The reader parses `html` chapters with an **XML**
 * parser and only applies HTML semantics inside the XHTML namespace, so ordinary markup fails in
 * two different ways — a fatal parse error, or a document that parses and then renders as one
 * run-together line. See docs/paperback/html-chapters.md; both failures are device-only and no
 * test runner can see them.
 */

const VOID_TAG =
  /<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b([^>]*?)\/?>/gi;
const NAMED_REF = /&([a-zA-Z][a-zA-Z0-9]*);/g;

/** The only five an XML parser knows without a declaration. */
const XML_ENTITIES = new Set(["amp", "lt", "gt", "quot", "apos"]);

/**
 * Resolved to literal characters rather than numeric references — the output is UTF-8, so the
 * character needs no escape at all and the markup stays readable.
 */
const ENTITY_CHARACTERS: Record<string, string> = {
  bull: "•",
  copy: "©",
  deg: "°",
  frac12: "½",
  hellip: "…",
  laquo: "«",
  ldquo: "“",
  lsquo: "‘",
  mdash: "—",
  middot: "·",
  nbsp: " ",
  ndash: "–",
  raquo: "»",
  rdquo: "”",
  reg: "®",
  rsquo: "’",
  shy: "­",
  times: "×",
  trade: "™",
};

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
