/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

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

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LNORI returned HTTP ${response.status} for ${url}`);
  }

  return Application.arrayBufferToUTF8String(data);
}
