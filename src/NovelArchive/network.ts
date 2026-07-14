/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export const API_BASE = "https://novelarchive.cc/api";

// URLSearchParams is not available in this runtime (confirmed by paperback-cli test,
// which mirrors the device's constrained globals — see runtime.md), so query strings
// are built by hand
export function buildQuery(params: Record<string, string | undefined>): string {
  const pairs = Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  return pairs.length > 0 ? `?${pairs.join("&")}` : "";
}

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": USER_AGENT,
    };
    return request;
  }

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

type CachedResponse = {
  fetchedAt: number;
  payload: unknown;
};

// getMangaDetails and getChapters both read the same /novels/<id> payload (it already
// carries chapter_names), and the discover sections fire several list endpoints
// concurrently on load — a short cache with in-flight dedupe covers both bursts
// without ever serving meaningfully stale data
const RESPONSE_CACHE_TTL = 60_000;
const RESPONSE_CACHE_LIMIT = 8;

const responseCache = new Map<string, CachedResponse>();
const inFlight = new Map<string, Promise<unknown>>();

function cachedResponse(path: string): unknown {
  const entry = responseCache.get(path);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > RESPONSE_CACHE_TTL) {
    responseCache.delete(path);
    return undefined;
  }
  return entry.payload;
}

function rememberResponse(path: string, payload: unknown): void {
  if (responseCache.size >= RESPONSE_CACHE_LIMIT) {
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(path, { fetchedAt: Date.now(), payload });
}

type ApiErrorBody = { error?: string };

// Callers that need to distinguish "this specific id doesn't exist" (404, safe
// to retry with an alternate id) from any other failure (network error, rate
// limit, etc. — never safe to retry) check `status` rather than the message
// text, since the API's wording isn't a stable contract
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// novelarchive.cc's API returns clean JSON with correct status codes and a
// {"error": "..."} body on failure, so there is no markup to scrape here at all
export async function apiRequest<T>(path: string): Promise<T> {
  const cached = cachedResponse(path);
  if (cached !== undefined) return cached as T;

  const pending = inFlight.get(path);
  if (pending) return pending as Promise<T>;

  const request = requestJson<T>(path);
  inFlight.set(path, request);

  try {
    const payload = await request;
    rememberResponse(path, payload);
    return payload;
  } finally {
    inFlight.delete(path);
  }
}

async function requestJson<T>(path: string): Promise<T> {
  const [response, data] = await Application.scheduleRequest({
    url: `${API_BASE}${path}`,
    method: "GET",
  });

  const text = Application.arrayBufferToUTF8String(data);

  if (response.status < 200 || response.status >= 300) {
    let message = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(text) as ApiErrorBody;
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; fall back to the plain status message
    }
    throw new ApiError(response.status, `NovelArchive returned ${message} for ${path}`);
  }

  return JSON.parse(text) as T;
}
