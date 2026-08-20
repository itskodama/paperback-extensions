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
import { isOurRequest } from "./http.ts";
import { DOMAIN } from "./models.ts";
import { recordScramble, thoroughDescrambleEnabled } from "./settings.ts";

/**
 * Paces only the requests this extension itself issues, identified by the
 * registry in http.ts rather than by the shape of the URL.
 *
 * The site's page runs in the WebView and its requests reach these interceptors
 * too. Pacing those meant a chapter open spent about 43 seconds asleep across
 * five stalls, and a later attempt to exempt them by path still missed
 * Cloudflare's /cdn-cgi/ scripts, costing a third of every chapter walk.
 */
class OriginRateLimiter extends BasicRateLimiter {
  override async interceptRequest(request: Request): Promise<Request> {
    return isOurRequest(request.url) ? super.interceptRequest(request) : request;
  }
}

export const rateLimiter = new OriginRateLimiter("comix", {
  numberOfRequests: 20,
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

/** cf_clearance is per-domain, so a challenge must be solved on the host that
 * issued it. Falls back to the primary if the URL will not parse. */
function challengedOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return DOMAIN;
  }
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
      // The domain that was challenged, not the primary: cf_clearance is issued
      // per-domain, so pointing the bypass at DOMAIN while requests are going to
      // the mirror earns a clearance for the wrong host and the banner returns
      // forever. preferredOrigin only resets when the app restarts, which is why
      // that loop outlives repeated solves.
      throw new CloudflareError(
        {
          url: challengedOrigin(request.url),
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
      const result = await descrambleImage(
        bytes,
        scramble,
        response.mimeType ?? "image/webp",
        thoroughDescrambleEnabled(),
      );
      const total = result.decodeMs + result.transformMs + result.encodeMs;
      recordScramble(
        `${Math.round(result.inputBytes / 1024)}KB->${Math.round(result.outputBytes / 1024)}KB ` +
          `${total}ms (decode ${result.decodeMs} blit ${result.transformMs} ` +
          `encode ${result.encodeMs}) ${scramble.cols}x${scramble.rows} ` +
          `algo=${scramble.scrambleAlgo ?? "?"}`,
      );
      return result.bytes;
    } catch (error) {
      recordScramble(`FAILED token=${scramble.scrambleHash ?? "none"}: ${String(error)}`);
      console.log(`[Comix] descramble failed for ${request.url}: ${String(error)}`);
      return bytes;
    }
  }
}

export const mainInterceptor = new MainInterceptor("comix-main");
