/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { CloudflareError } from "@paperback/types";

import { DOMAIN, MIRROR_DOMAIN } from "./models.ts";

/**
 * How the extension fetches a page: origin failover, a short cache, and in-flight
 * de-duplication. The Paperback-registered interceptors live in `network.ts`;
 * this layer is plain fetching and is testable without them.
 */

type CachedPage = { fetchedAt: number; html: string };

// getMangaDetails and the discover sections read the same pages, and discover
// fires several at once on load; a short cache with in-flight dedupe covers both
// bursts without serving stale data.
const CACHE_TTL = 60_000;
const CACHE_LIMIT = 8;

const cache = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<string>>();

// Whichever origin last answered is tried first, so a single outage costs one
// failed request rather than one per call for the rest of the session.
let preferredOrigin = DOMAIN;

/** The origin every request and WebView load should currently be built against. */
export function origin(): string {
  return preferredOrigin;
}

function onOrigin(url: string, target: string): string {
  return url.replace(DOMAIN, target).replace(MIRROR_DOMAIN, target);
}

/** An HTTP status the server actually returned, as opposed to a transport failure. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`Comix returned HTTP ${status} for ${url}`);
  }
}

/**
 * A CloudflareError thrown from an interceptor crosses the bridge on its way back
 * out of scheduleRequest and does not arrive as the same class, so `instanceof`
 * silently fails. The `type` tag it carries does survive.
 */
function isCloudflareError(error: unknown): boolean {
  if (error instanceof CloudflareError) return true;
  const tagged = error as { type?: unknown; message?: unknown } | null;
  if (tagged?.type === "cloudflareError") return true;
  return typeof tagged?.message === "string" && tagged.message.includes("Cloudflare check");
}

/**
 * The platform rejects with native errors that are not JS `Error`s and stringify
 * to "[object NSError]", so a message is dug out rather than interpolated.
 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === "string" && message) return message;

  const localized = (error as { localizedDescription?: unknown } | null)?.localizedDescription;
  if (typeof localized === "string" && localized) return localized;
  return "the network request failed";
}

async function attempt(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(response.status, url);
  }
  return Application.arrayBufferToUTF8String(data);
}

async function requestText(url: string): Promise<string> {
  try {
    return await attempt(onOrigin(url, preferredOrigin));
  } catch (error) {
    // Only an unreachable host is worth trying elsewhere. A challenge belongs to
    // the app, and a status the server chose to return says the same on either
    // domain — retrying those would replace a real diagnosis with the mirror's
    // unrelated failure.
    if (isCloudflareError(error) || error instanceof HttpError) throw error;

    const fallback = preferredOrigin === DOMAIN ? MIRROR_DOMAIN : DOMAIN;
    try {
      const text = await attempt(onOrigin(url, fallback));
      preferredOrigin = fallback;
      return text;
    } catch {
      throw new Error(`Comix could not reach ${preferredOrigin}: ${describe(error)}`);
    }
  }
}

export async function fetchText(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.fetchedAt <= CACHE_TTL) return cached.html;

  const pending = inFlight.get(url);
  if (pending) return pending;

  const request = requestText(url);
  inFlight.set(url, request);

  try {
    const html = await request;
    if (cache.size >= CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(url, { fetchedAt: Date.now(), html });
    return html;
  } finally {
    inFlight.delete(url);
  }
}
