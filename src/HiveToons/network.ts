/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * The impure boundary: everything that actually talks to the site.
 *
 * The site does not challenge and does not protect its image host, so there is no Cloudflare
 * handling and no referer games here — just a browser user-agent, a modest rate limit, and the
 * caching that keeps a burst of discover sections from making the same request several times.
 */

import {
  BasicRateLimiter,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { DOMAIN } from "./models.ts";

/** The origin is fast and unthrottled; this is politeness, not a measured limit. */
export const rateLimiter = new BasicRateLimiter("hivetoons", {
  numberOfRequests: 10,
  bufferInterval: 1,
  ignoreImages: true,
});

class MainInterceptor extends PaperbackInterceptor {
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

export const mainInterceptor = new MainInterceptor("hivetoons-main");

// --- Response cache ---

type CachedBody = {
  fetchedAt: number;
  body: string;
};

/**
 * Long enough to cover a burst — the discover sections arrive together, and a title reopened from
 * the library re-reads the same detail and chapter calls — while short enough that a listing never
 * goes meaningfully stale.
 */
const CACHE_TTL = 60_000;
const CACHE_LIMIT = 8;

const cache = new Map<string, CachedBody>();
const inFlight = new Map<string, Promise<string>>();

function cached(url: string): string | undefined {
  const entry = cache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > CACHE_TTL) {
    cache.delete(url);
    return undefined;
  }
  return entry.body;
}

function remember(url: string, body: string): void {
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { fetchedAt: Date.now(), body });
}

async function request(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HiveToons returned HTTP ${response.status} for ${url}`);
  }
  return Application.arrayBufferToUTF8String(data);
}

/**
 * De-duplicating in flight is what stops a burst of discover sections requesting the same URL
 * concurrently; there is no fetch cache in this runtime.
 */
async function fetchBody(url: string): Promise<string> {
  const hit = cached(url);
  if (hit !== undefined) return hit;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const started = request(url);
  inFlight.set(url, started);

  try {
    const body = await started;
    remember(url, body);
    return body;
  } finally {
    inFlight.delete(url);
  }
}

/** Every read this extension makes is JSON; nothing fetches the site's own HTML. */
export async function fetchJson(url: string): Promise<unknown> {
  const body = await fetchBody(url);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`HiveToons returned unreadable JSON for ${url}`);
  }
}
