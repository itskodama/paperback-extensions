/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import {
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { authorizedFetch } from "./auth.ts";
import { ASURA_API, ASURA_DOMAIN } from "./models.ts";

const MAX_REDIRECTS = 5;

const BYPASS_STATE = "asurascans.lastBypass";
const BYPASS_GRACE_MS = 90_000;

type BypassRecord = { completedAtMs: number; capturedClearance: boolean };

export function recordBypass(capturedClearance: boolean): void {
  const record: BypassRecord = { completedAtMs: Date.now(), capturedClearance };
  Application.setState(record, BYPASS_STATE);
}

function recentBypass(): BypassRecord | undefined {
  const stored = Application.getState(BYPASS_STATE) as Partial<BypassRecord> | undefined;
  if (typeof stored?.completedAtMs !== "number") return undefined;
  if (Date.now() - stored.completedAtMs > BYPASS_GRACE_MS) return undefined;
  return {
    completedAtMs: stored.completedAtMs,
    capturedClearance: stored.capturedClearance === true,
  };
}

// Throwing a CloudflareError is what raises the app's bypass banner. It must open the URL that was
// challenged: Asura's homepage is edge-cached and never challenged, so a WebView sent there has
// nothing to solve. cf_clearance is bound to the UA that solved it, hence the default UA here and
// on every request. A challenge straight after a bypass is reported as text instead, or the
// banner returns forever. See site-architecture.md#cloudflare-challenge.
async function cloudflareChallenge(url: string): Promise<Error> {
  const bypass = recentBypass();
  if (bypass?.capturedClearance) {
    return new Error(
      "Asura Scans still blocks requests after the Cloudflare check passed. Please report this.",
    );
  }
  if (bypass) {
    return new Error(
      "The Cloudflare check closed before Asura Scans issued a clearance. Wait for the page " +
        "to finish loading before tapping Done, then try again.",
    );
  }

  return new CloudflareError({
    url,
    method: "GET",
    headers: { "user-agent": await Application.getDefaultUserAgent() },
  });
}

function isChallenge(response: Response): boolean {
  const mitigated = headerValue(response.headers ?? {}, "cf-mitigated");
  return mitigated?.toLowerCase().includes("challenge") === true;
}

// Backstop for a challenge served without the cf-mitigated header
function isChallengePage(status: number, html: string): boolean {
  return status >= 400 && (html.includes("_cf_chl_opt") || html.includes("<title>Just a moment"));
}

function isSitePage(url: string): boolean {
  return (
    url === ASURA_DOMAIN || url.startsWith(`${ASURA_DOMAIN}/`) || url.startsWith(`${ASURA_DOMAIN}?`)
  );
}

function isApiUrl(url: string): boolean {
  return url.startsWith(`${ASURA_API}/`);
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

  // Images only: site pages and the API each have a fallback in their caller, which a throw here
  // would pre-empt
  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (!isSitePage(request.url) && !isApiUrl(request.url) && isChallenge(response)) {
      throw await cloudflareChallenge(request.url);
    }
    return data;
  }
}

// Holds only the cf_clearance handed over by cloudflareBypassCompleted. The stock interceptor
// also stores every Set-Cookie, which would replay Asura's rotating auth cookies beside the
// bearer token — do not "simplify" this back to it.
export class ClearanceCookieInterceptor extends CookieStorageInterceptor {
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

type WebViewFetcher = (url: string) => Promise<{ status: number; url: string; html: string }>;

let webViewFetcher: WebViewFetcher | undefined;

// Injected from main.ts: webview.ts needs the cookie store main owns, and this layer sits below it
export function setChallengeFallback(fetcher: WebViewFetcher): void {
  webViewFetcher = fetcher;
}

// While challenged, every plain request is a wasted 403 before the WebView retry
const PREFER_WEBVIEW_MS = 10 * 60_000;
let preferWebViewUntilMs = 0;

function rateLimited(): Error {
  return new Error("Asura Scans is rate limiting requests. Wait a minute, then try again.");
}

// A clearance the WebView holds is not honoured on scheduleRequest, so a challenged page is fetched
// from inside it; the banner is raised only when that fails too.
// See site-architecture.md#cloudflare-challenge.
async function pageViaWebView(url: string): Promise<FetchedPage> {
  preferWebViewUntilMs = Date.now() + PREFER_WEBVIEW_MS;

  const page = await webViewFetcher?.(url).catch(() => undefined);
  if (page?.status === 429) throw rateLimited();
  if (page && page.status >= 200 && page.status < 300 && !isChallengePage(page.status, page.html)) {
    return { url: page.url, html: page.html };
  }

  throw await cloudflareChallenge(url);
}

async function requestPage(url: string): Promise<FetchedPage> {
  if (Date.now() < preferWebViewUntilMs) return pageViaWebView(url);

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

    if (isChallenge(response) || isChallengePage(response.status, html)) {
      return pageViaWebView(target);
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

// The chapter reader's early-access unlock is a separate, uncached JSON endpoint — the HTML page
// fetched by fetchPage above is a shared Cloudflare edge cache and never varies by auth
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
