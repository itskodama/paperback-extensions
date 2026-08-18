/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Text shown to the user: counts, ratings, summaries. */

export type InfoItem = { symbol: string; text: string };

export function titleCase(value: string): string {
  return value.length > 0 ? `${value[0]!.toUpperCase()}${value.slice(1)}` : value;
}

// 255678 -> "256K", 3965770 -> "4M", 1500000000 -> "1.5B"
const COUNT_UNITS = [
  { suffix: "B", scale: 1_000_000_000 },
  { suffix: "M", scale: 1_000_000 },
  { suffix: "K", scale: 1_000 },
];

// Each unit starts where the smaller one would round to four digits, so 999,500 is "1M".
export function formatCount(value: number): string {
  for (const { suffix, scale } of COUNT_UNITS) {
    if (value < scale - scale / 2_000) continue;

    const scaled = value / scale;
    // One decimal below ten (1.5M), none above (256K).
    const rounded = scaled < 9.95 ? Math.round(scaled * 10) / 10 : Math.round(scaled);
    return `${rounded}${suffix}`;
  }

  return String(value);
}

export function formatRating(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// A hero card shows a sentence or two on one line, not the whole synopsis
export function shortSummary(text: string, limit = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return stop > 60 ? cut.slice(0, stop + 1) : `${cut.trimEnd()}…`;
}
