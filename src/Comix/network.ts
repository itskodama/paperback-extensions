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
import { DOMAIN } from "./models.ts";
import { recordScramble, thoroughDescrambleEnabled } from "./settings.ts";

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
      const result = await descrambleImage(
        bytes,
        scramble,
        response.mimeType ?? "image/webp",
        thoroughDescrambleEnabled(),
      );
      recordScramble(
        `${scramble.cols}x${scramble.rows} algo=${scramble.scrambleAlgo ?? "?"} ` +
          `token=${scramble.scrambleHash ?? "none"} ` +
          `${Math.round(result.inputBytes / 1024)}KB->${Math.round(result.outputBytes / 1024)}KB`,
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
