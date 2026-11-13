/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { type Cookie } from "@paperback/types";

export type WebViewPage = { status: number; url: string; html: string };

const WEBVIEW_FETCH_TIMEOUT_MS = 30_000;

// Seeds an empty document at the target's own address and fetches it same-origin, so nothing is
// navigated to and no site script runs. The WebView presents a clearance that scheduleRequest
// cannot. See site-architecture.md#cloudflare-challenge.
export async function fetchViaWebView(url: string, cookies: Cookie[]): Promise<WebViewPage> {
  const bootstrap = `(function () {
    var settle;
    window.__asuraPage__ = new Promise(function (resolve) { settle = resolve; });
    var timer = setTimeout(function () { settle({ status: 0, url: "", html: "" }); }, ${WEBVIEW_FETCH_TIMEOUT_MS});
    function finish(value) { clearTimeout(timer); settle(value); }

    fetch(location.href, { credentials: "include" })
      .then(function (response) {
        return response.text().then(function (html) {
          finish({ status: response.status, url: response.url, html: html });
        });
      })
      .catch(function () { finish({ status: 0, url: "", html: "" }); });
  })();`;

  const { result } = await Application.executeInWebView({
    source: {
      html: `<!doctype html><html><head><script>${bootstrap}</script></head><body></body></html>`,
      baseUrl: url,
      loadCSS: false,
      loadImages: false,
      userAgent: await Application.getDefaultUserAgent(),
    },
    inject: "return window.__asuraPage__",
    storage: { cookies },
  });

  const page = (result ?? {}) as Partial<WebViewPage>;
  return {
    status: typeof page.status === "number" ? page.status : 0,
    url: typeof page.url === "string" && page.url.length > 0 ? page.url : url,
    html: typeof page.html === "string" ? page.html : "",
  };
}
