/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { authHeaders, renewTokens } from "./auth.ts";
import { API_BASE } from "./types.ts";

// Politeness, not evasion: the API challenges nothing and its ToS invites clients.
const USER_AGENT = "Paperback-MangaBaka (https://github.com/itskodama/paperback-extensions)";

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
    };
    return request;
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

// Errors

/** Branch on `status`, never on message text — the wording is not a stable contract. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// Envelope

export type Pagination = {
  count: number;
  next: string | null;
  previous: string | null;
  page: number;
  limit: number;
};

/** The API's own wording when it gives one; the bare status when it does not. */
export function failureText(status: number, envelope?: { message?: string }): string {
  return envelope?.message ?? `HTTP ${status}`;
}

/** Every response, success or error, carries a root `status` mirroring the HTTP code. */
export type Envelope<T> = {
  status: number;
  data: T;
  message?: string;
  pagination?: Pagination;
};

// Rate limiting

// /series/search has its own 30/min bucket, and BasicRateLimiter cannot route by URL, so
// main.ts covers the 180/min default and search is spaced here. No X-RateLimit-* headers
// exist, so this is blind by necessity.
const SEARCH_MIN_INTERVAL_MS = 2_100;

let searchChain: Promise<void> = Promise.resolve();
let lastSearchAt = 0;

// Chained, so concurrent searches queue instead of both reading the same stale timestamp.
function throttleSearch(): Promise<void> {
  const next = searchChain.then(async () => {
    const wait = SEARCH_MIN_INTERVAL_MS - (Date.now() - lastSearchAt);
    if (wait > 0) await Application.sleep(wait / 1000);
    lastSearchAt = Date.now();
  });

  searchChain = next.catch(() => undefined);
  return next;
}

// Cache

// Only *uncached* requests count against the rate limit, so this buys quota, not latency.
// /my/* is never cached: the server sends no-store and stale progress is a correctness bug.
export const SERIES_CACHE_TTL = 3_600_000;
export const CATALOG_CACHE_TTL = 3_600_000;
export const DISCOVER_CACHE_TTL = 300_000;

const CACHE_LIMIT = 200;

type CacheEntry = { fetchedAt: number; payload: unknown };

const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<unknown>>();

function cached(key: string, ttl: number): unknown {
  const entry = responseCache.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > ttl) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.payload;
}

function remember(key: string, payload: unknown): void {
  if (responseCache.size >= CACHE_LIMIT) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(key, { fetchedAt: Date.now(), payload });
}

/** `/series/search` returns full series objects, so it can pay for `getMangaDetails`. */
export function seedCache(path: string, payload: unknown): void {
  remember(path, payload);
}

export function clearCache(): void {
  responseCache.clear();
}

// Requests

async function requestJson<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  headers: Record<string, string>,
  body?: unknown,
): Promise<[number, Envelope<T> | undefined]> {
  const request: Request = { url, method, headers };
  if (body !== undefined) {
    request.headers = { ...headers, "content-type": "application/json" };
    request.body = body as Request["body"];
  }

  const [response, data] = await Application.scheduleRequest(request);
  const text = Application.arrayBufferToUTF8String(data);

  if (text.length === 0) return [response.status, undefined];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(response.status, `MangaBaka returned an unreadable response for ${url}`);
  }

  return [response.status, parsed as Envelope<T>];
}

/** Throws {@link ApiError} on any non-2xx. */
export async function apiRequest<T>(path: string, ttl = SERIES_CACHE_TTL): Promise<Envelope<T>> {
  const hit = cached(path, ttl);
  if (hit !== undefined) return hit as Envelope<T>;

  const pending = inFlight.get(path);
  if (pending) return pending as Promise<Envelope<T>>;

  const fetching = (async (): Promise<Envelope<T>> => {
    if (path.startsWith("/v1/series/search") || path.startsWith("/v2/series/search")) {
      await throttleSearch();
    }

    const [status, envelope] = await requestJson<T>("GET", `${API_BASE}${path}`, {});

    if (status < 200 || status >= 300 || envelope === undefined) {
      throw new ApiError(status, `MangaBaka returned ${failureText(status, envelope)} for ${path}`);
    }
    return envelope;
  })();

  inFlight.set(path, fetching);

  try {
    const envelope = await fetching;
    remember(path, envelope);
    return envelope;
  } finally {
    inFlight.delete(path);
  }
}

/** Never throws on 404: "not in the library" is an answer, so the status is returned. */
export async function authedRequest<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<[number, Envelope<T> | undefined]> {
  const auth = await authHeaders();
  if (!auth) {
    throw new Error("You are not logged in to MangaBaka. Log in from the extension settings.");
  }

  let [status, envelope] = await requestJson<T>(method, `${API_BASE}${path}`, auth, body);

  // A token can be revoked or expire mid-flight; only a dead refresh token needs the user.
  if (status === 401 && (await renewTokens())) {
    const renewed = await authHeaders();
    if (renewed) {
      [status, envelope] = await requestJson<T>(method, `${API_BASE}${path}`, renewed, body);
    }
  }

  if (status === 401) {
    // The API's wording separates a bad bearer from one that never arrived. Keep it.
    throw new Error(
      "Your MangaBaka access has expired or been revoked. Log in again from the extension " +
        `settings. (${failureText(status, envelope)})`,
    );
  }

  return [status, envelope];
}

/** As {@link authedRequest}, but throws on anything that isn't a 2xx. */
export async function authedRequestOrThrow<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<Envelope<T> | undefined> {
  const [status, envelope] = await authedRequest<T>(method, path, body);

  if (status < 200 || status >= 300) {
    throw new ApiError(status, `MangaBaka returned ${failureText(status, envelope)} for ${path}`);
  }
  return envelope;
}
