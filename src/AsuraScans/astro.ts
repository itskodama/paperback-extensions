/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

const ISLAND_PROPS = /<astro-island\b[^>]*\bprops="([^"]*)"/g;
const ENTITY = /&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;
const TAG = /<[^>]*>/g;
const BLOCK_END = /<\/(?:p|div|li|h[1-6])\s*>/gi;
const LINE_BREAK = /<br\s*\/?>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

const PROP_VALUE = 0;
const PROP_ARRAY = 1;
const PROP_DATE = 3;

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

export function htmlToPlainText(html: string): string {
  const spaced = html.replace(LINE_BREAK, "\n").replace(BLOCK_END, "\n\n");
  return decodeEntities(spaced.replace(TAG, ""))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(decodeProp);
  }
  if (typeof value === "object" && value !== null) {
    const decoded: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      decoded[key] = decodeProp(nested);
    }
    return decoded;
  }
  return value;
}

export function decodeProp(encoded: unknown): unknown {
  if (!Array.isArray(encoded) || typeof encoded[0] !== "number") {
    return decodeValue(encoded);
  }

  if (encoded.length < 2) {
    return undefined;
  }

  const payload: unknown = encoded[1];
  switch (encoded[0]) {
    case PROP_ARRAY:
      return Array.isArray(payload) ? payload.map(decodeProp) : [];
    case PROP_DATE:
      return typeof payload === "string" ? new Date(payload) : undefined;
    case PROP_VALUE:
      return decodeValue(payload);
    default:
      return payload;
  }
}

export type Island = Record<string, unknown>;

// One page yields several lookups — two islands per series page, three discover sections off
// the homepage — and the response cache hands back the identical string each time, so the sweep
// and JSON.parse ran once per lookup. Callers only read islands, never mutate them.
let lastHtml: string | undefined;
let lastIslands: Island[] | undefined;

export function extractIslands(html: string): Island[] {
  if (html === lastHtml && lastIslands) return lastIslands;

  const islands: Island[] = [];

  for (const match of html.matchAll(ISLAND_PROPS)) {
    const escaped = match[1];
    if (!escaped) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(decodeEntities(escaped));
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;

    const island: Island = {};
    for (const [key, value] of Object.entries(parsed)) {
      island[key] = decodeProp(value);
    }
    islands.push(island);
  }

  lastHtml = html;
  lastIslands = islands;
  return islands;
}

export function findIsland(html: string, keys: string[]): Island {
  for (const island of extractIslands(html)) {
    if (keys.every((key) => key in island)) return island;
  }
  throw new Error(`No Astro island carries the properties: ${keys.join(", ")}`);
}

export function readString(source: Island, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(source: Island, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readBoolean(source: Island, key: string): boolean {
  return source[key] === true;
}

export function readArray(source: Island, key: string): Island[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is Island =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

export function readStringArray(source: Island, key: string): string[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export function readNumberArray(source: Island, key: string): number[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is number => typeof entry === "number");
}
