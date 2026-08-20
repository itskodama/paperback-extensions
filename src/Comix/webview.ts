/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { fetchText, origin } from "./http.ts";
import { DOMAIN, type ChapterPayload, type PagesPayload } from "./models.ts";
import { cookieStorage } from "./network.ts";
import { recordTiming } from "./settings.ts";

/**
 * Search, chapter lists and page lists are signed with a per-request token and
 * returned encrypted. Rather than reimplementing either, the site's own bundle is
 * run under executeInWebView and its decrypted plaintext is captured off
 * JSON.parse. Nothing here depends on the cipher, so a rotated bundle still works.
 *
 * See docs/Comix/site-recon.md#chapters-and-pages-solved-with-applicationexecuteinwebview.
 */
// Budgets are idle time, not wall clock: the WebView needs to boot, load the
// site's bundle and clear Cloudflare before it fetches anything, which was
// measured at over 20s on device. Any JSON the page parses counts as progress
// and rearms the timer, so a slow-but-working page is waited on and only a truly
// stalled one gives up.
const CAPTURE_TIMEOUT_MS = 45_000;

// Chapters are walked 20 at a time, so a long series legitimately needs many
// round trips. The budget is idle time between captured pages, not total time.
const CHAPTER_IDLE_TIMEOUT_MS = 25_000;

// The opening marks establish the per-page rhythm, which is what the trace is
// for; a full walk of fifty pages would not fit in the log and would not add
// anything the first few do not already show.
const TRACE_LIMIT = 8;

function injectBootstrap(html: string, bootstrap: string): string {
  const script = `<script>${bootstrap}</script>`;
  const headIndex = html.search(/<head[^>]*>/i);
  if (headIndex === -1) return `${script}${html}`;

  const insertAt = html.indexOf(">", headIndex) + 1;
  return html.slice(0, insertAt) + script + html.slice(insertAt);
}

async function capture<T>(pageUrl: string, bootstrap: string, label: string): Promise<T> {
  const startedAt = Date.now();
  const html = injectBootstrap(await fetchText(pageUrl), bootstrap);
  const fetchedAt = Date.now();

  // fetchText may have failed over to the mirror; the WebView has to resolve the
  // page's own scripts and XHRs against whichever origin actually answered.
  const resolved = pageUrl.replace(DOMAIN, origin());

  const { result: envelope } = await Application.executeInWebView({
    source: {
      html,
      baseUrl: resolved,
      loadCSS: false,
      loadImages: false,
      // Must match the UA the Cloudflare clearance was issued to, or the page's
      // own same-origin XHRs are challenged instead of served.
      userAgent: await Application.getDefaultUserAgent(),
    },
    // The trace rides alongside the result rather than replacing it: a capture
    // must still succeed if the trace is missing or malformed.
    inject:
      "return window.__comixCapture__.then(function (r) { return { result: r, trace: window.__comixTrace__ || [] }; })",
    storage: { cookies: cookieStorage.cookiesForUrl(`${origin()}/`) },
  });

  const wrapped = envelope as { result?: unknown; trace?: unknown } | null;
  const result = wrapped?.result;

  // The WebView run is the expensive half and the one a reader waits on, so it
  // is reported apart from the page fetch that precedes it.
  recordTiming(
    `${label} ${Date.now() - startedAt}ms (fetch ${fetchedAt - startedAt}, ` +
      `webview ${Date.now() - fetchedAt})`,
  );

  // Recorded as one entry rather than one per mark: the log prepends, so separate
  // writes would read backwards and crowd out everything else. Each mark is when
  // something happened inside the page, relative to its load — the gaps between
  // them are where a slow walk actually spends its time.
  if (Array.isArray(wrapped?.trace) && wrapped.trace.length > 0) {
    const marks = wrapped.trace
      .filter((mark): mark is string => typeof mark === "string")
      .slice(0, TRACE_LIMIT);
    if (marks.length > 0) recordTiming(`${label} trace: ${marks.join(" | ")}`);
  }

  if (result === undefined || result === null) {
    // Distinguishes a stalled page from a wrong one: a capture that ran the full
    // idle budget was waiting on the site, not misreading it.
    const elapsed = Date.now() - startedAt;
    throw new Error(
      `Comix: ${label} found nothing after ${Math.round(elapsed / 1000)}s at ${resolved}`,
    );
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
    // A trace of what happened inside the page, returned alongside the result.
    // Timing measured from outside can only show total elapsed; the cost of a
    // slow walk is here, in the gaps between a click and the payload it causes.
    window.__comixTrace__ = [];
    window.__comixT0__ = Date.now();
    window.__comixMark__ = function (what) {
      try {
        if (window.__comixTrace__.length < 200) {
          window.__comixTrace__.push(Date.now() - window.__comixT0__ + "ms " + what);
        }
      } catch (e) { /* a trace must never break the capture */ }
    };

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
        try {
          // Any parsed object means the page is still working; keep waiting.
          if (parsed && typeof parsed === "object") window.__comixIdle__();
          accept(parsed, args[0]);
        } catch (e) { /* never break the page */ }
        return parsed;
      }
    });
    ${afterAccept}
  })();`;
}

// Walking a long series costs one round trip per 20 chapters, so the result is
// reused — but only while the series page still reports the same newest chapter.
// A plain time-based cache would swallow an upload mid-window and make a
// pull-to-refresh appear to do nothing, which is when fresh data is most wanted.
// Validating costs one already-cached HTML fetch and no WebView run.
const chapterCache = new Map<string, { latestChapter: number; payloads: ChapterPayload[] }>();
const chapterInFlight = new Map<string, Promise<ChapterPayload[]>>();

export async function captureChapterList(
  hid: string,
  latestChapter?: number,
): Promise<ChapterPayload[]> {
  const cached = chapterCache.get(hid);
  if (cached && latestChapter !== undefined && cached.latestChapter === latestChapter) {
    return cached.payloads;
  }

  // A WebView chapter walk is the most expensive call the extension makes, so a
  // second request for the same series while one is running joins it rather than
  // starting a parallel walk.
  const pending = chapterInFlight.get(hid);
  if (pending) return pending;

  const walk = captureChapters(hid, latestChapter);
  chapterInFlight.set(hid, walk);
  try {
    return await walk;
  } finally {
    chapterInFlight.delete(hid);
  }
}

async function captureChapters(hid: string, latestChapter?: number): Promise<ChapterPayload[]> {
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
      window.__comixMark__("payload page=" + page + " n=" + result.items.length);

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
          if (next) {
            clearInterval(timer);
            // The poll count separates waiting for the site to re-render its
            // pager from waiting for the request that the click causes.
            window.__comixMark__("click page=" + (page + 1) + " afterPolls=" + tries);
            next.click();
          } else if (++tries > 60) {
            clearInterval(timer);
            window.__comixMark__("gave up finding next after " + tries + " polls");
            finish(window.__comixCollect__());
          }
        }, 100);
      };
    `,
    "window.__comixCollect__()",
    CHAPTER_IDLE_TIMEOUT_MS,
  );

  const raw = await capture<string[]>(`${DOMAIN}/title/${hid}`, bootstrap, "chapter-list");
  const payloads = raw.map((payload) => JSON.parse(payload) as ChapterPayload);
  if (latestChapter !== undefined) chapterCache.set(hid, { latestChapter, payloads });
  return payloads;
}

export async function capturePageList(chapterPath: string): Promise<PagesPayload> {
  const bootstrap = bootstrapFor(
    `if (parsed && parsed.result && parsed.result.pages) { finish(raw); }`,
  );
  const raw = await capture<string>(`${DOMAIN}${chapterPath}`, bootstrap, "page-list");
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
  return capture<unknown>(browseUrl, bootstrap, "browse");
}
