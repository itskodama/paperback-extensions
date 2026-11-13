/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { authorizedFetch } from "./auth.ts";
import { ASURA_API, ASURA_DOMAIN } from "./models.ts";

const MAX_REDIRECTS = 5;

// Clears a cf_clearance stored by dev builds that tried a Cloudflare bypass. Remove after a release.
const STALE_COOKIE_STATE = "cookie_store_cookies";

export function forgetStoredClearance(): void {
  Application.setState([], STALE_COOKIE_STATE);
}

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    return {
      ...request,
      headers: {
        ...request.headers,
        "user-agent": await Application.getDefaultUserAgent(),
      },
    };
  }

  // Required: interceptResponse is abstract on PaperbackInterceptor, so this cannot be dropped.
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

function isChallenge(response: Response, html: string): boolean {
  const mitigated = headerValue(response.headers ?? {}, "cf-mitigated");
  if (mitigated?.toLowerCase().includes("challenge") === true) return true;
  return response.status >= 400 && html.includes("_cf_chl_opt");
}

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function resolveLocation(location: string, base: string): string {
  if (location.startsWith("http://") || location.startsWith("https://")) return location;
  if (location.startsWith("/")) {
    // The redirecting host, which after an absolute redirect off-site is no longer ours.
    const origin = /^https?:\/\/[^/]+/.exec(base)?.[0] ?? ASURA_DOMAIN;
    return `${origin}${location}`;
  }
  return `${base.slice(0, base.lastIndexOf("/") + 1)}${location}`;
}

export type FetchedPage = {
  url: string;
  html: string;
};

type CachedPage = {
  fetchedAt: number;
  page: FetchedPage;
};

const PAGE_CACHE_TTL = 15_000;
const PAGE_CACHE_LIMIT = 6;

const pageCache = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<FetchedPage>>();

function cachedPage(url: string): FetchedPage | undefined {
  const entry = pageCache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > PAGE_CACHE_TTL) {
    pageCache.delete(url);
    return undefined;
  }

  return entry.page;
}

function rememberPage(url: string, page: FetchedPage): void {
  if (pageCache.size >= PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) pageCache.delete(oldest);
  }

  pageCache.set(url, { fetchedAt: Date.now(), page });
}

export async function fetchPage(url: string): Promise<FetchedPage> {
  const cached = cachedPage(url);
  if (cached) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = requestPage(url);
  inFlight.set(url, request);

  try {
    const page = await request;
    rememberPage(url, page);
    return page;
  } finally {
    inFlight.delete(url);
  }
}

function rateLimited(): Error {
  return new Error("Asura Scans is rate limiting requests. Wait a minute, then try again.");
}

async function requestPage(url: string): Promise<FetchedPage> {
  let target = url;

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const [response, data] = await Application.scheduleRequest({ url: target, method: "GET" });

    if (response.status >= 300 && response.status < 400) {
      const location = headerValue(response.headers, "location");
      if (!location) {
        throw new Error(`Asura Scans redirected ${target} without a location header`);
      }
      target = resolveLocation(location, target);
      continue;
    }

    const html = Application.arrayBufferToUTF8String(data);

    // No bypass is offered: none of three attempts got past this one. See site-architecture.md.
    if (isChallenge(response, html)) {
      throw new Error("Asura Scans' web pages are behind a Cloudflare check.");
    }

    if (response.status === 429) throw rateLimited();

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Asura Scans returned HTTP ${response.status} for ${target}`);
    }

    return {
      url: response.url.length > 0 ? response.url : target,
      html,
    };
  }

  throw new Error(`Asura Scans redirected ${url} too many times`);
}

// On device Cloudflare challenges the HTML pages but not the API, which Asura's own site calls from
// the browser. See site-architecture.md#cloudflare-challenge.
async function fetchApiJson(path: string): Promise<unknown> {
  const [response, data] = await Application.scheduleRequest({
    url: `${ASURA_API}${path}`,
    method: "GET",
  });
  if (response.status === 429) throw rateLimited();
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Asura Scans returned HTTP ${response.status} for ${path}`);
  }
  return JSON.parse(Application.arrayBufferToUTF8String(data));
}

export function fetchSeriesJson(seriesSlug: string): Promise<unknown> {
  return fetchApiJson(`/api/series/${seriesSlug}`);
}

export function fetchSeriesChaptersJson(seriesSlug: string): Promise<unknown> {
  return fetchApiJson(`/api/series/${seriesSlug}/chapters`);
}

export async function fetchPublicChapterJson(
  seriesSlug: string,
  chapterNumber: string,
): Promise<unknown> {
  const parsed = (await fetchApiJson(`/api/series/${seriesSlug}/chapters/${chapterNumber}`)) as {
    data?: unknown;
  };
  return parsed.data ?? parsed;
}

export type Creators = { authors: string[]; artists: string[] };

let creatorsCache: Creators | undefined;

// The advanced search author/artist filters draw from this list, on the API host
export async function fetchCreators(): Promise<Creators> {
  if (creatorsCache) return creatorsCache;

  const [response, data] = await Application.scheduleRequest({
    url: `${ASURA_API}/api/creators`,
    method: "GET",
  });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Asura Scans returned HTTP ${response.status} for the creators list`);
  }

  const parsed = JSON.parse(Application.arrayBufferToUTF8String(data)) as {
    data?: Partial<Creators>;
  } & Partial<Creators>;
  const source = parsed.data ?? parsed;

  creatorsCache = {
    authors: Array.isArray(source.authors) ? source.authors : [],
    artists: Array.isArray(source.artists) ? source.artists : [],
  };
  return creatorsCache;
}

// Same endpoint as fetchPublicChapterJson, with the login, which is what unlocks early access
export async function fetchChapterJson(
  seriesSlug: string,
  chapterNumber: string,
): Promise<unknown> {
  const result = await authorizedFetch(`/api/series/${seriesSlug}/chapters/${chapterNumber}`);
  if (!result) return undefined;

  const [response, data] = result;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Asura Scans returned HTTP ${response.status} for the authenticated chapter endpoint`,
    );
  }

  const parsed = JSON.parse(Application.arrayBufferToUTF8String(data)) as {
    data?: unknown;
  };
  return parsed.data ?? parsed;
}

// Mirrors fetchChapterJson above, but novels use a singular /chapter/ path and their API
// response is flat (no "data" envelope) — the parsed.data ?? parsed fallback handles both
export async function fetchNovelChapterJson(
  mangaId: string,
  chapterNumber: string,
): Promise<unknown> {
  const result = await authorizedFetch(`/api/novel-series/${mangaId}/chapter/${chapterNumber}`);
  if (!result) return undefined;

  const [response, data] = result;
  if (response.status < 200 || response.status >= 300) {
    throw new Error(
      `Asura Scans returned HTTP ${response.status} for the authenticated novel chapter endpoint`,
    );
  }

  const parsed = JSON.parse(Application.arrayBufferToUTF8String(data)) as {
    data?: unknown;
  };
  return parsed.data ?? parsed;
}

// Fully public — confirmed identical results with and without a token — so unlike
// fetchChapterJson/fetchNovelChapterJson this never goes through authorizedFetch
export async function fetchNovelSearch(url: string): Promise<unknown> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Asura Scans returned HTTP ${response.status} for the novel search API`);
  }
  return JSON.parse(Application.arrayBufferToUTF8String(data));
}
