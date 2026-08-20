/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  CloudflareError,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { LNORI_DOMAIN } from "./parser.ts";

// Throwing this is what raises the app's bypass banner; the app opens a WebView at
// the request below, and cf_clearance is bound to the user-agent it solves with — so
// the same default UA has to go out on every request too
async function cloudflareChallenge(): Promise<CloudflareError> {
  return new CloudflareError({
    url: `${LNORI_DOMAIN}/`,
    method: "GET",
    headers: { "user-agent": await Application.getDefaultUserAgent() },
  });
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

  // Covers images too — covers and inline illustrations sit on challenged subdomains
  // and never pass through fetchPage
  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    void request;

    for (const [name, value] of Object.entries(response.headers ?? {})) {
      if (name.toLowerCase() === "cf-mitigated" && value.toLowerCase().includes("challenge")) {
        throw await cloudflareChallenge();
      }
    }
    return data;
  }
}

type CachedPage = {
  fetchedAt: number;
  html: string;
};

// Long enough to cover a burst — the discover sections all read the homepage, and a
// title open reads its series page twice (details, then chapters) — while short
// enough that a page never goes meaningfully stale
const PAGE_CACHE_TTL = 60_000;
const PAGE_CACHE_LIMIT = 4;

const pageCache = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<string>>();

function cachedPage(url: string): string | undefined {
  const entry = pageCache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > PAGE_CACHE_TTL) {
    pageCache.delete(url);
    return undefined;
  }
  return entry.html;
}

function rememberPage(url: string, html: string): void {
  if (pageCache.size >= PAGE_CACHE_LIMIT) {
    const oldest = pageCache.keys().next().value;
    if (oldest !== undefined) pageCache.delete(oldest);
  }
  pageCache.set(url, { fetchedAt: Date.now(), html });
}

// LNORI serves everything as long-cached static pages and never redirects within the read path
export async function fetchPage(url: string): Promise<string> {
  const cached = cachedPage(url);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = requestPage(url);
  inFlight.set(url, request);

  try {
    const html = await request;
    rememberPage(url, html);
    return html;
  } finally {
    inFlight.delete(url);
  }
}

async function requestPage(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  const body = Application.arrayBufferToUTF8String(data);

  // Backstop for a challenge served without the cf-mitigated header, which the
  // interceptor keys off
  if (response.status >= 400 && body.includes("_cf_chl_opt")) {
    throw await cloudflareChallenge();
  }

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LNORI returned HTTP ${response.status} for ${url}`);
  }

  return body;
}
