/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

// Extension-ful imports: the unit tests load these under Node's own resolver.
import type { Chapter, SourceManga, TrackedMangaChapterReadAction } from "@paperback/types";

import { num, positive } from "./decode.ts";
import type { LibraryEntry } from "./types.ts";

/** MangaBaka accepts a bare `YYYY-MM-DD` and echoes back a full timestamp. */
export function today(now: Date = new Date()): string {
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

/** Trackers have no real chapters, so one is synthesised from the stored progress. */
export function progressChapter(entry: LibraryEntry, sourceManga: SourceManga): Chapter {
  const chapNum = num(entry.progress_chapter) ?? 0;

  const chapter: Chapter = {
    chapterId: String(chapNum),
    sourceManga,
    langCode: "unknown",
    chapNum,
  };

  const volume = positive(entry.progress_volume);
  if (volume !== undefined) chapter.volume = volume;

  return chapter;
}

export type CollapsedAction = {
  /** The action that actually needs a network call. */
  action: TrackedMangaChapterReadAction;
  /** Queue ids that are superseded by it and can be acknowledged for free. */
  supersededIds: string[];
};

/** Writing each in turn would burn the rate limit setting values the last one overwrites. */
export function collapseReadActions(actions: TrackedMangaChapterReadAction[]): CollapsedAction[] {
  const best = new Map<string, TrackedMangaChapterReadAction>();

  for (const action of actions) {
    const mangaId = action.sourceManga.mangaId;
    const current = best.get(mangaId);
    if (!current || action.chapterNum > current.chapterNum) best.set(mangaId, action);
  }

  const collapsed = new Map<string, CollapsedAction>();
  for (const [mangaId, action] of best) {
    collapsed.set(mangaId, { action, supersededIds: [] });
  }

  for (const action of actions) {
    const entry = collapsed.get(action.sourceManga.mangaId);
    if (entry && entry.action.id !== action.id) entry.supersededIds.push(action.id);
  }

  return [...collapsed.values()];
}
