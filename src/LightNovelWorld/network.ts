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

type CachedText = {
  fetchedAt: number;
  text: string;
};

// Covers a burst without ever serving meaningfully stale data: a title open reads
// its novel page once for details and once (indirectly, via getChapters) for the
// chapter list's own pages, and discover fires several list endpoints on load
const TEXT_CACHE_TTL = 60_000;
const TEXT_CACHE_LIMIT = 12;

const textCache = new Map<string, CachedText>();
const inFlight = new Map<string, Promise<string>>();

function cachedText(url: string): string | undefined {
  const entry = textCache.get(url);
  if (!entry) return undefined;

  if (Date.now() - entry.fetchedAt > TEXT_CACHE_TTL) {
    textCache.delete(url);
    return undefined;
  }
  return entry.text;
}

function rememberText(url: string, text: string): void {
  if (textCache.size >= TEXT_CACHE_LIMIT) {
    const oldest = textCache.keys().next().value;
    if (oldest !== undefined) textCache.delete(oldest);
  }
  textCache.set(url, { fetchedAt: Date.now(), text });
}

// Both the HTML pages and the JSON API return 200 with no Cloudflare challenge for
// a plain GET (verified during recon), so one fetch path covers both
async function fetchText(url: string): Promise<string> {
  const cached = cachedText(url);
  if (cached !== undefined) return cached;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = requestText(url);
  inFlight.set(url, request);

  try {
    const text = await request;
    rememberText(url, text);
    return text;
  } finally {
    inFlight.delete(url);
  }
}

async function requestText(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`LightNovelWorld returned HTTP ${response.status} for ${url}`);
  }

  return Application.arrayBufferToUTF8String(data);
}

export async function fetchPage(url: string): Promise<string> {
  return fetchText(url);
}

export async function fetchJson<T>(url: string): Promise<T> {
  return JSON.parse(await fetchText(url)) as T;
}
