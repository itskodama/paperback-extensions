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

import { applyKeystream, parseScrambleConfig } from "./descramble.ts";
import { DOMAIN } from "./models.ts";

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
      throw new CloudflareError(
        { url: DOMAIN, method: "GET" },
        "Comix requires a Cloudflare check",
      );
    }

    const scramble = parseScrambleConfig(response.headers);
    if (!scramble || scramble.encLength <= 0) return data;

    // The XOR keystream is pure byte work and is undone here. The 5x5 tile shuffle
    // is not: it needs an image decode/encode round-trip, and 0.9 exposes no way to
    // construct a PBCanvas. See docs/Comix/architecture.md#image-descrambling.
    const decoded = applyKeystream(
      new Uint8Array(data),
      scramble.encSeed,
      scramble.encLength,
      scramble.encAlgo,
    );
    return decoded.buffer as ArrayBuffer;
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

async function requestText(url: string): Promise<string> {
  const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Comix returned HTTP ${response.status} for ${url}`);
  }
  return Application.arrayBufferToUTF8String(data);
}
