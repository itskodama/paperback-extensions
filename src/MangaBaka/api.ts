/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { mergedTargetId, toGenreOptions } from "./mapping";
import {
  apiRequest,
  authedRequest,
  authedRequestOrThrow,
  failureText,
  seedCache,
  CATALOG_CACHE_TTL,
  DISCOVER_CACHE_TTL,
  type Envelope,
  type Pagination,
} from "./network";
import type { GenreOption, GenresResponse, LibraryEntry, Series } from "./types";
import { buildQuery } from "./urls";

/** Guards against a merge chain pointing back at itself. */
const MAX_MERGE_HOPS = 3;

function seriesPath(id: string): string {
  return `/v1/series/${encodeURIComponent(id)}`;
}

/** Returns the id it resolved to, so a stored tracker link can heal itself. */
export async function fetchSeries(id: string): Promise<{ series: Series; id: string }> {
  let currentId = id;

  for (let hop = 0; hop <= MAX_MERGE_HOPS; hop++) {
    const envelope = await apiRequest<Series>(seriesPath(currentId));
    const series = envelope.data;

    const target = mergedTargetId(series);
    if (target === undefined || target === currentId) return { series, id: currentId };

    currentId = target;
  }

  throw new Error(`MangaBaka returned a merge loop starting at series ${id}`);
}

/** Search returns full series objects, so linking a title costs one request, not two. */
export function cacheSeries(series: Series[]): void {
  for (const entry of series) {
    if (typeof entry.id !== "number") continue;
    const envelope: Envelope<Series> = { status: 200, data: entry };
    seedCache(seriesPath(String(entry.id)), envelope);
  }
}

export async function fetchSeriesList(
  path: string,
  ttl?: number,
): Promise<{ series: Series[]; pagination?: Pagination }> {
  const envelope = await apiRequest<Series[]>(path, ttl ?? DISCOVER_CACHE_TTL);
  const series = Array.isArray(envelope.data) ? envelope.data : [];

  cacheSeries(series);

  return envelope.pagination ? { series, pagination: envelope.pagination } : { series };
}

export async function fetchGenres(): Promise<GenreOption[]> {
  const envelope = await apiRequest<GenresResponse>("/v1/genres", CATALOG_CACHE_TTL);
  return toGenreOptions(Array.isArray(envelope.data) ? envelope.data : []);
}

// Library

function libraryPath(seriesId: string): string {
  return `/v1/my/library/${encodeURIComponent(seriesId)}`;
}

/** 404 means "not on this user's list" — an answer, hence `undefined` over a throw. */
export async function fetchLibraryEntry(seriesId: string): Promise<LibraryEntry | undefined> {
  const [status, envelope] = await authedRequest<LibraryEntry>("GET", libraryPath(seriesId));

  if (status === 404) return undefined;
  if (status < 200 || status >= 300) {
    throw new Error(`MangaBaka returned ${failureText(status, envelope)} for your library`);
  }

  return envelope?.data;
}

export type LibraryUpdate = {
  state?: string;
  rating?: number | null;
  progress_chapter?: number | null;
  progress_volume?: number | null;
  number_of_rereads?: number | null;
  start_date?: string | null;
  finish_date?: string | null;
  is_private?: boolean;
  priority?: number;
  note?: string | null;
};

/** PATCH updates an existing entry; POST creates one. */
export async function saveLibraryEntry(
  seriesId: string,
  update: LibraryUpdate,
  exists: boolean,
): Promise<void> {
  await authedRequestOrThrow(exists ? "PATCH" : "POST", libraryPath(seriesId), update);
}

export async function deleteLibraryEntry(seriesId: string): Promise<void> {
  const [status, envelope] = await authedRequest("DELETE", libraryPath(seriesId));

  if (status === 404) return; // Already gone is the outcome the caller wanted.
  if (status < 200 || status >= 300) {
    throw new Error(`MangaBaka returned ${failureText(status, envelope)} deleting the entry`);
  }
}

// Collections

/** v2 embeds the series object, so listing a collection is one call per page, not N. */
type LibraryListItem = { entry?: LibraryEntry; series?: Series };

const COLLECTION_PAGE_SIZE = 100;
const MAX_COLLECTION_PAGES = 20;

export async function fetchLibrarySeries(state: string): Promise<Series[]> {
  const collected: Series[] = [];

  for (let page = 1; page <= MAX_COLLECTION_PAGES; page++) {
    const path = `/v2/my/library${buildQuery({ state, page, limit: COLLECTION_PAGE_SIZE })}`;
    const envelope = await authedRequestOrThrow<LibraryListItem[]>("GET", path);

    const items = Array.isArray(envelope?.data) ? envelope.data : [];
    for (const item of items) {
      if (item.series && typeof item.series.id === "number") collected.push(item.series);
    }

    if (items.length < COLLECTION_PAGE_SIZE) break;
  }

  cacheSeries(collected);
  return collected;
}

/** The batch upsert is atomic and capped at 100 entries per call. */
const BATCH_LIMIT = 100;

export async function batchUpsert(seriesIds: string[], update: LibraryUpdate): Promise<void> {
  for (let offset = 0; offset < seriesIds.length; offset += BATCH_LIMIT) {
    const chunk = seriesIds.slice(offset, offset + BATCH_LIMIT).map((seriesId) => ({
      series_id: Number(seriesId),
      ...update,
    }));

    await authedRequestOrThrow("POST", "/v1/my/library/batch", chunk);
  }
}
