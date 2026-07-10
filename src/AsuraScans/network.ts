/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import { PaperbackInterceptor, type Request, type Response } from "@paperback/types";

import { ASURA_DOMAIN } from "./models";

const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MAX_REDIRECTS = 5;

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

function headerValue(headers: Record<string, string>, name: string): string | undefined {
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return value;
  }
  return undefined;
}

function resolveLocation(location: string, base: string): string {
  if (location.startsWith("http://") || location.startsWith("https://")) return location;
  if (location.startsWith("/")) return `${ASURA_DOMAIN}${location}`;
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

    if (response.status === 403 || response.status === 503) {
      throw new Error(
        `Asura Scans is challenging requests (HTTP ${response.status}). Open the site in a browser, then try again.`,
      );
    }

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`Asura Scans returned HTTP ${response.status} for ${target}`);
    }

    return {
      url: response.url.length > 0 ? response.url : target,
      html: Application.arrayBufferToUTF8String(data),
    };
  }

  throw new Error(`Asura Scans redirected ${url} too many times`);
}
