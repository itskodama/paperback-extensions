/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { CloudflareError } from "@paperback/types";

import { DOMAIN, MIRROR_DOMAIN } from "./models.ts";
import { recordFetchIssue } from "./settings.ts";

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
  // Declared and assigned separately: a constructor parameter property is not
  // supported by Node's strip-only TypeScript mode, which runs the unit tests.
  readonly status: number;

  constructor(status: number, url: string) {
    super(`Comix returned HTTP ${status} for ${url}`);
    this.status = status;
  }
}

/**
 * A CloudflareError thrown from an interceptor crosses the bridge on its way back
 * out of scheduleRequest and does not arrive as the same class, so `instanceof`
 * silently fails. The `type` tag it carries does survive.
 */
export function isCloudflareError(error: unknown): boolean {
  if (error instanceof CloudflareError) return true;
  const tagged = error as { type?: unknown; message?: unknown } | null;
  if (tagged?.type === "cloudflareError") return true;
  return typeof tagged?.message === "string" && tagged.message.includes("Cloudflare check");
}

/**
 * Cloudflare can answer `200` with an interstitial instead of the page, which
 * parses as "no initial-data" several layers up and never reaches the mirror.
 *
 * Matched on markers unique to the interstitial. Deliberately *not* on
 * "challenge-platform": Cloudflare injects that script into ordinary pages too,
 * so it would condemn every healthy response.
 */
export function looksLikeChallengePage(html: string): boolean {
  const head = html.slice(0, 2000).toLowerCase();
  return (
    head.includes("just a moment") ||
    head.includes("_cf_chl_opt") ||
    head.includes("cf-browser-verification")
  );
}

/**
 * Every page this extension fetches is a Comix app page, and each carries its
 * state in this script tag. A 2xx without it is not the site — an interstitial,
 * an error page, or a block — and is worth trying the other origin for rather
 * than failing several layers up where nothing can recover.
 */
const PAGE_MARKER = 'id="initial-data"';

/** A 2xx that is not the page that was asked for. */
class UnusablePageError extends Error {
  constructor(url: string) {
    super(`Comix served a page without its data payload for ${url}`);
  }
}

/** A 2xx whose body is an interstitial rather than the page that was asked for. */
class ChallengePageError extends Error {
  constructor(url: string) {
    super(`Comix served a challenge page for ${url}`);
  }
}

/**
 * Whether the other origin is worth trying. A 404 or 410 is a real answer about
 * missing content and says the same on either domain. Everything else — a
 * transport failure, a block, an outage, a challenge — is a property of the host
 * that produced it, which is what the mirror exists for.
 */
function shouldTryOtherOrigin(error: unknown): boolean {
  if (error instanceof HttpError) return error.status !== 404 && error.status !== 410;
  return true;
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

/**
 * URLs this extension is currently requesting, counted so concurrent fetches of
 * the same one do not release it early.
 *
 * Rate limiting keys off this rather than off the shape of the URL. The site's
 * page runs in the WebView and its requests reach the same interceptors, so any
 * attempt to recognise ours by path is a guess at everything the page might
 * fetch — a guess that missed Cloudflare's own /cdn-cgi/ scripts and cost about
 * a third of the chapter walk. Marking the request at the point it is issued
 * cannot miss anything.
 */
const ourRequests = new Map<string, number>();

/** Marks a URL as ours for the duration of the request. Returns the release. */
export function trackOwnRequest(url: string): () => void {
  ourRequests.set(url, (ourRequests.get(url) ?? 0) + 1);

  return () => {
    const remaining = (ourRequests.get(url) ?? 0) - 1;
    if (remaining > 0) ourRequests.set(url, remaining);
    else ourRequests.delete(url);
  };
}

/** True only while this extension has a request in flight for that exact URL. */
export function isOurRequest(url: string): boolean {
  return ourRequests.has(url);
}

async function attempt(url: string): Promise<string> {
  const release = trackOwnRequest(url);
  try {
    return await send(url);
  } finally {
    release();
  }
}

async function send(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new HttpError(response.status, url);
  }

  const html = Application.arrayBufferToUTF8String(data);
  if (looksLikeChallengePage(html)) throw new ChallengePageError(url);

  if (!html.includes(PAGE_MARKER)) {
    // Recorded because the body is the only evidence of what was served instead,
    // and by the time the reader reports it the response is long gone.
    recordFetchIssue(`${url} -> ${html.length}B ${html.replace(/\s+/g, " ").slice(0, 100)}`);
    throw new UnusablePageError(url);
  }
  return html;
}

/** A response that arrived but was not the site. */
function unrecognisedBlock(error: unknown): boolean {
  return error instanceof UnusablePageError || error instanceof ChallengePageError;
}

async function requestText(url: string): Promise<string> {
  try {
    return await attempt(onOrigin(url, preferredOrigin));
  } catch (error) {
    if (!shouldTryOtherOrigin(error)) throw error;

    // A challenge is not surfaced until both origins have been tried. One domain
    // can sit behind a stalled challenge while the other serves normally, and
    // raising the app's bypass for a host the reader cannot get past strands
    // them there — the mirror is the fix, not the banner.
    const fallback = preferredOrigin === DOMAIN ? MIRROR_DOMAIN : DOMAIN;
    try {
      const text = await attempt(onOrigin(url, fallback));
      preferredOrigin = fallback;
      return text;
    } catch (fallbackError) {
      // Both are blocked, so the bypass is the only way forward. The first
      // origin's challenge is preferred: it is the one still set as current.
      if (isCloudflareError(error)) throw error;
      if (isCloudflareError(fallbackError)) throw fallbackError;

      // Neither origin returned the site. That is nearly always a challenge the
      // detection above did not recognise, so raise the app's bypass instead of
      // reporting a dead end the reader can do nothing about. If it turns out
      // not to be Cloudflare, the Debug section can drop the clearance by hand.
      if (unrecognisedBlock(error) || unrecognisedBlock(fallbackError)) {
        throw new CloudflareError(
          {
            url: preferredOrigin,
            method: "GET",
            headers: { "user-agent": await Application.getDefaultUserAgent() },
          },
          "Comix could not load either domain — a Cloudflare check may be required",
        );
      }
      throw new Error(`Comix could not reach ${DOMAIN} or ${MIRROR_DOMAIN}: ${describe(error)}`);
    }
  }
}

/**
 * Drops every cached page and returns to the primary origin. Paired with
 * clearing the clearance: a stale origin choice would otherwise outlive the
 * cookie that caused it.
 */
export function resetFetchState(): void {
  cache.clear();
  inFlight.clear();
  preferredOrigin = DOMAIN;
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
