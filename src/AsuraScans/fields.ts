/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Reading typed values out of an Astro island's props. */

import { readBoolean, readNumber, readString, readStringArray, type Island } from "./astro.ts";

const ASURA_RATING_MAX = 10;

// Paperback renders `rating` as a percentage, so it expects a 0-1 fraction
export function ratingFraction(source: Island, key: string): number | undefined {
  const rating = readNumber(source, key);
  if (rating === undefined) return undefined;
  return Math.min(Math.max(rating / ASURA_RATING_MAX, 0), 1);
}

// Asura serves novels from the same payloads as comics, under /novels/
export function isNovel(entry: Island): boolean {
  const path = readString(entry, "public_url") ?? readString(entry, "comic_public_url");
  return path !== undefined && path.startsWith("/novels/");
}

// Free chapters carry the epoch as their early-access deadline; a future one is still locked
export function isFutureDate(value: string | undefined): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getTime() > Date.now();
}

// Both markers agree on every chapter sampled; ORing them keeps one field's absence from hiding a
// lock. Series pages and the updates feed spell them identically.
export function isEarlyAccess(entry: Island): boolean {
  return readBoolean(entry, "is_premium") || isFutureDate(readString(entry, "early_access_until"));
}

// A raw genre name is not a legal id, and throws when the value is used. See forms.md.
export function tagId(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._\-@()[\]%?#+=/&:]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");

  return sanitized.length > 0 ? sanitized : "unknown";
}

// The series page joins alternative titles with a bullet; browse returns them as an array
export function alternativeTitles(source: Island, key: string): string[] {
  const joined = readString(source, key);
  const titles = joined ? joined.split("•") : readStringArray(source, key);
  return titles.map((title) => title.trim()).filter((title) => title.length > 0);
}
