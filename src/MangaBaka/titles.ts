/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** `titles[]` carries every language at once, so choosing one is a decision, not a read. */

// Extension-ful imports: the unit tests load these under Node's own resolver.
import { isText, str } from "./decode.ts";
import type { Series, SeriesTitle } from "./types.ts";

export type TitlePreference = "english" | "romanized" | "native";

export const DEFAULT_TITLE_PREFERENCE: TitlePreference = "english";

/** Ids must match {@link TitlePreference}. */
export const TITLE_PREFERENCES = [
  { id: "english", title: "English" },
  { id: "romanized", title: "Romanized" },
  { id: "native", title: "Original language" },
] as const;

function isEnglish(entry: SeriesTitle): boolean {
  return typeof entry.language === "string" && entry.language.toLowerCase().startsWith("en");
}

// Romanizations are tagged with a script subtag, e.g. `ja-Latn`, `ko-Latn`.
function isRomanized(entry: SeriesTitle): boolean {
  return typeof entry.language === "string" && /-latn$/i.test(entry.language);
}

/**
 * **`is_primary` is per-language, not per-series** — one series flags it on its Korean,
 * English and Japanese entries at once, so the language filter has to come first and the
 * flag only breaks ties within it.
 */
function titleIn(series: Series, matches: (entry: SeriesTitle) => boolean): string | undefined {
  const candidates = (series.titles ?? []).filter((entry) => isText(entry.title) && matches(entry));

  const primary = candidates.find((entry) => entry.is_primary === true);
  if (primary?.title) return primary.title;

  const official = candidates.find((entry) => entry.traits?.includes("official") === true);
  if (official?.title) return official.title;

  return candidates[0]?.title ?? undefined;
}

/** `series.title` is MangaBaka's own choice, in practice the official English one. */
export function primaryTitle(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): string {
  const english = (): string | undefined => titleIn(series, isEnglish) ?? str(series.title);

  const romanized = (): string | undefined =>
    titleIn(series, isRomanized) ?? str(series.romanized_title);

  const native = (): string | undefined =>
    str(series.native_title) ??
    titleIn(series, (entry) => entry.traits?.includes("native") === true && !isRomanized(entry));

  const order =
    preference === "native"
      ? [native, romanized, english]
      : preference === "romanized"
        ? [romanized, english, native]
        : [english, romanized, native];

  for (const resolve of order) {
    const title = resolve();
    if (title !== undefined) return title;
  }

  const anyTitle = (series.titles ?? []).find((entry) => isText(entry.title));
  return anyTitle?.title ?? `MangaBaka #${series.id}`;
}

export function secondaryTitles(
  series: Series,
  preference: TitlePreference = DEFAULT_TITLE_PREFERENCE,
): string[] {
  const primary = primaryTitle(series, preference);
  const seen = new Set<string>([primary]);
  const result: string[] = [];

  for (const candidate of [
    series.native_title,
    series.romanized_title,
    series.title,
    ...(series.titles ?? []).map((entry) => entry.title),
  ]) {
    if (!isText(candidate) || seen.has(candidate)) continue;
    seen.add(candidate);
    result.push(candidate);
  }

  return result;
}
