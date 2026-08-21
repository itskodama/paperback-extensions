/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { DOMAIN } from "./models.ts";

/**
 * The impure boundary: everything that actually talks to the site.
 *
 * The site does not challenge, so there is no Cloudflare handling here — but it
 * does require a browser user-agent. Without one, a listing page returns a 5 KB
 * stub with no rows rather than an error, which would look like "no results".
 */

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        "user-agent": await Application.getDefaultUserAgent(),
        referer: `${DOMAIN}/`,
      },
    };
  }

  // Required: interceptResponse is abstract on PaperbackInterceptor.
  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    void request;
    void response;
    return data;
  }
}

type CachedPage = {
  fetchedAt: number;
  body: string;
};

/**
 * Long enough to cover a burst — the discover sections arrive together and two of
 * them read the homepage, and opening a title reads its novel page for details and
 * again for the update check — while short enough that a page never goes
 * meaningfully stale.
 */
const PAGE_CACHE_TTL = 60_000;
const PAGE_CACHE_LIMIT = 8;

const pageCache = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<string>>();

function cachedPage(url: string): string | undefined {
  const entry = pageCache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > PAGE_CACHE_TTL) {
    pageCache.delete(url);
    return undefined;
  }
  return entry.body;
}

function rememberPage(url: string, body: string): void {
  if (pageCache.size >= PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) pageCache.delete(oldest);
  }
  pageCache.set(url, { fetchedAt: Date.now(), body });
}

/**
 * De-duplicating in flight is what keeps a burst of discover sections from
 * fetching the same page concurrently; there is no fetch cache in this runtime.
 *
 * `remember` is separate because not everything is worth keeping. A chapter walk
 * is up to 37 one-shot JSON payloads that are never requested twice, and letting
 * them into an eight-entry cache evicts every page that *is* — the homepage two
 * discover sections share, and the novel page details and the update sweep read.
 */
async function fetchShared(url: string, remember: boolean): Promise<string> {
  if (remember) {
    const cached = cachedPage(url);
    if (cached !== undefined) return cached;
  }

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = requestPage(url);
  inFlight.set(url, request);

  try {
    const body = await request;
    if (remember) rememberPage(url, body);
    return body;
  } finally {
    inFlight.delete(url);
  }
}

export function fetchPage(url: string): Promise<string> {
  return fetchShared(url, true);
}

/** The chapter-list endpoint is the only JSON on the site, and the only one-shot. */
export async function fetchJson(url: string): Promise<unknown> {
  const body = await fetchShared(url, false);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("FreeWebNovel returned an unreadable chapter list");
  }
}

async function requestPage(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FreeWebNovel returned HTTP ${response.status} for ${url}`);
  }
  return Application.arrayBufferToUTF8String(data);
}
