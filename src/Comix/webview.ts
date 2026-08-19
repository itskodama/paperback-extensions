/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { DOMAIN, type ChapterPayload, type PagesPayload } from "./models.ts";
import { cookieStorage, fetchText } from "./network.ts";

/**
 * Search, chapter lists and page lists are signed with a per-request token and
 * returned encrypted. Rather than reimplementing either, the site's own bundle is
 * run under executeInWebView and its decrypted plaintext is captured off
 * JSON.parse. Nothing here depends on the cipher, so a rotated bundle still works.
 *
 * See docs/Comix/site-recon.md#chapters-and-pages-solved-with-applicationexecuteinwebview.
 */
const CAPTURE_TIMEOUT_MS = 20_000;

function injectBootstrap(html: string, bootstrap: string): string {
  const script = `<script>${bootstrap}</script>`;
  const headIndex = html.search(/<head[^>]*>/i);
  if (headIndex === -1) return `${script}${html}`;

  const insertAt = html.indexOf(">", headIndex) + 1;
  return html.slice(0, insertAt) + script + html.slice(insertAt);
}

async function capture<T>(pageUrl: string, bootstrap: string): Promise<T> {
  const html = injectBootstrap(await fetchText(pageUrl), bootstrap);

  const { result } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: pageUrl,
      loadCSS: false,
      loadImages: false,
      // Must match the UA the Cloudflare clearance was issued to, or the page's
      // own same-origin XHRs are challenged instead of served.
      userAgent: await Application.getDefaultUserAgent(),
    },
    inject: "return window.__comixCapture__",
    storage: { cookies: cookieStorage.cookiesForUrl(`${DOMAIN}/`) },
  });

  if (result === undefined || result === null) {
    throw new Error(`Comix: the page at ${pageUrl} produced no data`);
  }
  return result as T;
}

/**
 * Shared preamble: installs a JSON.parse proxy and exposes a promise the inject
 * expression awaits. `accept` returns the value to resolve with, or undefined to
 * keep waiting.
 */
function bootstrapFor(acceptBody: string, afterAccept = ""): string {
  return `(function () {
    var settle;
    window.__comixCapture__ = new Promise(function (resolve) { settle = resolve; });
    var done = false;
    function finish(value) { if (!done) { done = true; settle(value); } }
    setTimeout(function () { finish(null); }, ${CAPTURE_TIMEOUT_MS});
    var accept = function (parsed, raw) { ${acceptBody} };
    var original = JSON.parse;
    JSON.parse = new Proxy(original, {
      apply: function (target, thisArg, args) {
        var parsed = Reflect.apply(target, thisArg, args);
        try { accept(parsed, args[0]); } catch (e) { /* never break the page */ }
        return parsed;
      }
    });
    ${afterAccept}
  })();`;
}

export async function captureChapterList(hid: string): Promise<ChapterPayload[]> {
  // Pagination clicks the site's own Next control: the request URL carries the
  // per-request signature, so rewriting it to jump pages returns 403.
  const bootstrap = bootstrapFor(
    `
      var result = parsed && parsed.result;
      if (!result || !Array.isArray(result.items)) return;
      if (!result.items.length || result.items[0].mangaId === undefined) return;
      var meta = result.meta || {};
      var page = meta.page || 1;
      if (window.__comixPages__[page]) return;
      window.__comixPages__[page] = raw;
      if (meta.hasNext || page < (meta.lastPage || page)) { window.__comixNext__(page); }
      else { finish(Object.keys(window.__comixPages__).sort(function (a, b) { return a - b; })
        .map(function (key) { return window.__comixPages__[key]; })); }
    `,
    `
      window.__comixPages__ = {};
      window.__comixNext__ = function (page) {
        var tries = 0;
        var timer = setInterval(function () {
          var buttons = Array.prototype.slice.call(document.querySelectorAll("button"))
            .filter(function (button) { return !button.disabled; });
          var next = buttons.filter(function (button) {
            var label = [button.getAttribute("aria-label"), button.getAttribute("title"),
              button.textContent].filter(Boolean).join(" ");
            return /\\bnext\\b/i.test(label) || Number((button.textContent || "").trim()) === page + 1;
          })[0];
          if (next) { clearInterval(timer); next.click(); }
          else if (++tries > 50) { clearInterval(timer); finish(null); }
        }, 100);
      };
    `,
  );

  const raw = await capture<string[]>(`${DOMAIN}/title/${hid}`, bootstrap);
  return raw.map((payload) => JSON.parse(payload) as ChapterPayload);
}

export async function capturePageList(chapterPath: string): Promise<PagesPayload> {
  const bootstrap = bootstrapFor(
    `if (parsed && parsed.result && parsed.result.pages) { finish(raw); }`,
  );
  const raw = await capture<string>(`${DOMAIN}${chapterPath}`, bootstrap);
  return JSON.parse(raw) as PagesPayload;
}

export async function captureBrowse(browseUrl: string): Promise<unknown> {
  const bootstrap = bootstrapFor(`
    var result = parsed && parsed.result;
    if (result && Array.isArray(result.items) && result.items.length
        && result.items[0].hid !== undefined) {
      finish({ items: result.items, meta: result.meta || null });
    }
  `);
  return capture<unknown>(browseUrl, bootstrap);
}
