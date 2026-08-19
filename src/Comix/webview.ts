/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { DOMAIN, type ChapterPayload, type PagesPayload } from "./models.ts";
import { cookieStorage, fetchText, origin } from "./network.ts";

/**
 * Search, chapter lists and page lists are signed with a per-request token and
 * returned encrypted. Rather than reimplementing either, the site's own bundle is
 * run under executeInWebView and its decrypted plaintext is captured off
 * JSON.parse. Nothing here depends on the cipher, so a rotated bundle still works.
 *
 * See docs/Comix/site-recon.md#chapters-and-pages-solved-with-applicationexecuteinwebview.
 */
const CAPTURE_TIMEOUT_MS = 20_000;

// Chapters are walked 20 at a time, so a long series legitimately needs many
// round trips. The budget is idle time between captured pages, not total time.
const CHAPTER_IDLE_TIMEOUT_MS = 25_000;

function injectBootstrap(html: string, bootstrap: string): string {
  const script = `<script>${bootstrap}</script>`;
  const headIndex = html.search(/<head[^>]*>/i);
  if (headIndex === -1) return `${script}${html}`;

  const insertAt = html.indexOf(">", headIndex) + 1;
  return html.slice(0, insertAt) + script + html.slice(insertAt);
}

async function capture<T>(pageUrl: string, bootstrap: string): Promise<T> {
  const html = injectBootstrap(await fetchText(pageUrl), bootstrap);

  // fetchText may have failed over to the mirror; the WebView has to resolve the
  // page's own scripts and XHRs against whichever origin actually answered.
  const resolved = pageUrl.replace(DOMAIN, origin());

  const { result } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: resolved,
      loadCSS: false,
      loadImages: false,
      // Must match the UA the Cloudflare clearance was issued to, or the page's
      // own same-origin XHRs are challenged instead of served.
      userAgent: await Application.getDefaultUserAgent(),
    },
    inject: "return window.__comixCapture__",
    storage: { cookies: cookieStorage.cookiesForUrl(`${origin()}/`) },
  });

  if (result === undefined || result === null) {
    throw new Error(`Comix: the page at ${resolved} produced no data`);
  }
  return result as T;
}

/**
 * Shared preamble: installs a JSON.parse proxy and exposes a promise the inject
 * expression awaits. `accept` returns the value to resolve with, or undefined to
 * keep waiting.
 */
function bootstrapFor(
  acceptBody: string,
  afterAccept = "",
  onTimeout = "null",
  timeoutMs: number = CAPTURE_TIMEOUT_MS,
): string {
  return `(function () {
    var settle;
    window.__comixCapture__ = new Promise(function (resolve) { settle = resolve; });
    var done = false;
    function finish(value) { if (!done) { done = true; settle(value); } }

    // Rearmed whenever progress is made, so the budget is idle time rather than
    // total time — a long series needs many round trips and must not be cut off
    // mid-walk just because it is large.
    var idle;
    window.__comixIdle__ = function () {
      if (idle) clearTimeout(idle);
      idle = setTimeout(function () { finish(${onTimeout}); }, ${timeoutMs});
    };
    window.__comixIdle__();
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
  // The site serves 20 chapters per request and the URL carries a signature bound
  // to its exact query, so pages cannot be requested directly — the site's own
  // pagination control has to be driven. Whatever has been captured is always
  // returned, even if advancing stalls: a partial chapter list beats none.
  const bootstrap = bootstrapFor(
    `
      var result = parsed && parsed.result;
      if (!result || !Array.isArray(result.items)) return;
      if (!result.items.length || result.items[0].mangaId === undefined) return;

      var meta = result.meta || {};
      var page = meta.page || 1;
      if (window.__comixPages__[page]) return;
      window.__comixPages__[page] = raw;

      window.__comixIdle__();
      if (meta.hasNext || page < (meta.lastPage || page)) { window.__comixAdvance__(page); }
      else { finish(window.__comixCollect__()); }
    `,
    `
      window.__comixPages__ = {};
      window.__comixCollect__ = function () {
        return Object.keys(window.__comixPages__)
          .sort(function (a, b) { return a - b; })
          .map(function (key) { return window.__comixPages__[key]; });
      };

      // The chapter module's own footer. Scoping to it matters because the
      // comment thread on the same page carries a second, unrelated pager.
      function pagerButtons() {
        var scoped = document.querySelectorAll(".mchap-foot button:not([disabled])");
        if (scoped.length) return Array.prototype.slice.call(scoped);

        var link = document.querySelector('a[href*="/title/"][href*="chapter"]');
        for (var node = link; node; node = node.parentElement) {
          var found = node.querySelectorAll("button:not([disabled])");
          if (found.length > 1) return Array.prototype.slice.call(found);
        }
        return [];
      }

      // Preference order: the button naming the next page, then one labelled
      // "next", then the trailing control — which is what a chevron-only pager
      // with no text or aria-label leaves to go on.
      function nextControl(buttons, page) {
        var numbered = buttons.filter(function (button) {
          return Number((button.textContent || "").trim()) === page + 1;
        })[0];
        if (numbered) return numbered;

        var labelled = buttons.filter(function (button) {
          var label = [button.getAttribute("aria-label"), button.getAttribute("title"),
            button.textContent].filter(Boolean).join(" ");
          return /\\bnext\\b/i.test(label);
        })[0];
        if (labelled) return labelled;

        var last = buttons[buttons.length - 1];
        var lastLabel = (last && last.textContent || "").trim();
        return lastLabel === "" || isNaN(Number(lastLabel)) ? last : undefined;
      }

      window.__comixAdvance__ = function (page) {
        var tries = 0;
        var timer = setInterval(function () {
          var next = nextControl(pagerButtons(), page);
          if (next) { clearInterval(timer); next.click(); }
          else if (++tries > 60) { clearInterval(timer); finish(window.__comixCollect__()); }
        }, 100);
      };
    `,
    "window.__comixCollect__()",
    CHAPTER_IDLE_TIMEOUT_MS,
  );

  const raw = await capture<string[]>(`${DOMAIN}/title/${hid}`, bootstrap);
  if (raw.length === 0) throw new Error(`Comix: no chapters were returned for ${hid}`);
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
