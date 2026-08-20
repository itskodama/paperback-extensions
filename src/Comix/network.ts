/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  BasicRateLimiter,
  CloudflareError,
  CookieStorageInterceptor,
  PaperbackInterceptor,
  type Request,
  type Response,
} from "@paperback/types";

import { applyKeystream, descrambleImage, parseScrambleConfig } from "./descramble.ts";
import { DOMAIN, MIRROR_DOMAIN } from "./models.ts";
import { recordScramble } from "./settings.ts";

export const rateLimiter = new BasicRateLimiter("comix", {
  numberOfRequests: 15,
  bufferInterval: 10,
  ignoreImages: true,
});

// cf_clearance is bound to the UA that solved the challenge, so it is persisted
// here and every request goes out under Application.getDefaultUserAgent() — the
// UA the app's own WebView used. See docs/LNORI/site-recon.md.
export const cookieStorage = new CookieStorageInterceptor({ storage: "stateManager" });

function isChallenge(response: Response, data: ArrayBuffer): boolean {
  if (response.status !== 403 && response.status !== 503) return false;
  const mitigated = Object.keys(response.headers).find(
    (key) => key.toLowerCase() === "cf-mitigated",
  );
  if (mitigated !== undefined) return true;

  const body = Application.arrayBufferToUTF8String(data).slice(0, 800).toLowerCase();
  return body.includes("just a moment") || body.includes("challenge-platform");
}

export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = {
      ...request.headers,
      "user-agent": await Application.getDefaultUserAgent(),
      referer: `${DOMAIN}/`,
    };
    return request;
  }

  /**
   * The app raises its bypass banner only when a CloudflareError is thrown, and
   * cover/page fetches never pass through the fetch helpers — so the check has
   * to live here, where the image loader's requests are also visible.
   */
  override async interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer> {
    if (isChallenge(response, data)) {
      // The clearance the bypass WebView earns is bound to the User-Agent that
      // solved the challenge. Without this header the WebView solves under a
      // different UA than outbound requests use, the clearance never validates,
      // and the banner reappears forever. Same trap as docs/LNORI/site-recon.md.
      throw new CloudflareError(
        {
          url: DOMAIN,
          method: "GET",
          headers: { "user-agent": await Application.getDefaultUserAgent() },
        },
        "Comix requires a Cloudflare check",
      );
    }

    const scramble = parseScrambleConfig(response.headers);
    if (!scramble) return data;

    // Both layers are keyed off headers rather than sniffed, since a scrambled
    // prefix defeats content detection. Either may be absent on a given image.
    let bytes = data;
    if (scramble.encLength > 0) {
      bytes = applyKeystream(
        new Uint8Array(bytes),
        scramble.encSeed,
        scramble.encLength,
        scramble.encAlgo,
      ).buffer as ArrayBuffer;
    }

    if (!scramble.gridded) return bytes;

    // A page that cannot be unscrambled is still worth showing scrambled: an
    // error here would leave the reader with a blank page instead.
    try {
      const descrambled = await descrambleImage(bytes, scramble, response.mimeType ?? "image/webp");
      recordScramble(
        `${scramble.cols}x${scramble.rows} algo=${scramble.scrambleAlgo ?? "?"} ` +
          `token=${scramble.scrambleHash ?? "none"} seed=${scramble.scrambleSeedRaw}`,
      );
      return descrambled;
    } catch (error) {
      recordScramble(`FAILED token=${scramble.scrambleHash ?? "none"}: ${String(error)}`);
      console.log(`[Comix] descramble failed for ${request.url}: ${String(error)}`);
      return bytes;
    }
  }
}

export const mainInterceptor = new MainInterceptor("comix-main");

type CachedPage = { fetchedAt: number; html: string };

// getMangaDetails and the discover sections read the same server-rendered pages,
// and discover fires several at once on load; a short cache with in-flight dedupe
// covers both bursts without serving stale data.
const CACHE_TTL = 60_000;
const CACHE_LIMIT = 8;

const cache = new Map<string, CachedPage>();
const inFlight = new Map<string, Promise<string>>();

export function clearPageCache(): void {
  cache.clear();
  inFlight.clear();
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
 * silently fails. The `type` tag it carries does survive. Getting this wrong
 * swallows the error the app needs in order to raise its bypass banner.
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
  const message = (error as { message?: unknown; localizedDescription?: unknown } | null)?.message;
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
    const text = await attempt(onOrigin(url, preferredOrigin));
    return text;
  } catch (error) {
    // Only an unreachable host is worth retrying elsewhere. A challenge belongs
    // to the app, and a status the server chose to return says the same thing on
    // either domain — retrying those would replace a real diagnosis with the
    // mirror's unrelated failure.
    if (isCloudflareError(error) || error instanceof HttpError) throw error;

    const fallback = preferredOrigin === DOMAIN ? MIRROR_DOMAIN : DOMAIN;
    try {
      const text = await attempt(onOrigin(url, fallback));
      preferredOrigin = fallback;
      return text;
    } catch {
      // Report the primary's failure; the mirror was only ever a long shot.
      throw new Error(`Comix could not reach ${preferredOrigin}: ${describe(error)}`);
    }
  }
}
