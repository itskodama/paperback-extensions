# Comix site recon

Feasibility notes for `comix.to`. Reconnaissance 2026-08-19, from a HAR capture of a real browsing
session (595 requests) plus direct probing. **Status: buildable, and already built — Inkdex ships a
Comix extension for Paperback 0.9 (`inkdex/general-extensions`, `src/Comix`, v1.0.0-alpha.46).** Recorded so the probing
is not repeated.

`comix.to` and `comix.ws` are **mirror front-ends over one backend**, confirmed from HAR captures of
both (595 and 482 requests). They are separate Cloudflare zones with different IPs, but they serve
the same chapter ids (`6216474`, `7270086`, `8996898` appear in both), the same series `hid`s
(`qqwrm`), the same API surface, and the same sharded image hosts (`jloo.wowpic2.store`,
`j24n.wowpic2.store`, `ek10.wowpic1.store`). Everything below applies to both — **`.ws` is not a
softer second option**, it is the same site behind a second domain.

## Why direct HTTP recon is impossible

Every path answers `403` with `cf-mitigated: challenge` — a Cloudflare **Turnstile managed
challenge**, zone-wide. Only `/robots.txt` passes, being served at the edge. Four transports were
tried:

| Transport                                       | Result          |
| ----------------------------------------------- | --------------- |
| `curl` + a valid, human-solved `cf_clearance`   | `403` challenge |
| `curl` + that cookie + byte-exact UA, same IP   | `403` challenge |
| Real Gecko (Zen 153), headless, via Marionette  | `403` Turnstile |
| Real Gecko, headed, human clicking the checkbox | Turnstile loops |

The clearance is pinned to the **TLS/HTTP2 fingerprint**, so no cookie makes `curl` work. The
automated browser fails because Marionette sets `navigator.webdriver = true` by specification and
Turnstile reads it — clicking the checkbox re-runs the challenge forever. Getting past either would
mean forging a TLS fingerprint or hiding the automation flag. Both were declined as out of bounds,
and both would be permanently fragile anyway.

The HAR capture below came from ordinary human browsing, which is the only thing the site accepts.

## What the HAR showed

There is a clean, well-designed JSON API at `comix.to/api/v1/…`, and the **catalog half of it is
plain JSON**:

- `GET /api/v1/manga?keyword=&limit=&content_rating[]=` → `{status, result:{items[], meta}}`. Items
  are rich: `id`, `hid`, `title`, `altTitles[]`, `type`, `status`, `originalLanguage`, `poster`
  (`medium`/`large` URLs on `static.comix.to`), `latestChapter`, `finalChapter`, `year`, `rank`,
  `synopsis`/`synopsisHtml`, `followsTotal`, `ratedAvg`, `ratedCount`, `contentRating`, `url`.
  This one endpoint would serve search, discover, and most of `getMangaDetails`.
- `GET /api/v1/manga/<hid>/groups` → plain.
- `/api/v1/user`, `/api/v1/threads/lookup`, `/api/v1/threads/<id>/comments` → plain, and are the
  only calls that need no token.

Series are keyed by a short `hid` (e.g. `qqwrm`), with human URLs of the form
`/title/<hid>-<slug>` and chapters at `/title/<hid>-<slug>/<chapterId>`.

## What is reachable without the token

Every page embeds `<script id="initial-data">` holding the JSON the SPA hydrates from. Verified in
the HAR:

| Page                    | `initial-data` | Queries | Usable items                     |
| ----------------------- | -------------- | ------- | -------------------------------- |
| `/`                     | 377 KB         | 7       | 51 full manga objects            |
| `/title/<hid>-<slug>`   | 21 KB          | 3       | detail + groups + recommended    |
| `/title/<hid>/<chapId>` | 2.9 KB         | 1       | **none** — no pages, no images   |
| `/browse`               | 3.4 KB         | **0**   | **none** — results are not in it |

Series-page queries are keyed `["manga","detail","<hid>"]` and `["manga","groups","<hid>"]`. Items
carry `id`, `hid`, `title`, `altTitles`, `type`, `status`, `poster`, `latestChapter`, `hasChapters`
and the rest of the search-result shape.

So **discover sections and `getMangaDetails` are buildable** from plain HTML with no token at all.
**Search is not** — `/browse` embeds nothing and goes through the tokenised API.

## Chapters and pages: solved with `Application.executeInWebView`

An earlier revision of this document claimed Paperback 0.9 could not execute JavaScript in a WebView
and therefore could not reach chapters or pages. **That was wrong.** The API exists:

```ts
Application.executeInWebView(context: ExecuteInWebViewContext): Promise<WebViewExecutionResult>
```

It is in `@paperback/types` at `impl/Application.d.ts:83`, and it takes an HTML `source` (with
`baseUrl`, `userAgent`, `loadCSS`, `loadImages`), an `inject` script whose return value comes back,
and a `storage` bag for cookies. The earlier claim came from an incomplete grep, not from the types.

### How Inkdex's extension does it

`inkdex/general-extensions` `src/Comix` is GPL-3.0-or-later — the same licence as this repository —
and its `utils/webView.ts` sidesteps the token and the encryption entirely rather than reversing
either:

1. Fetch the page HTML normally and prepend a bootstrap `<script>` to `<head>`.
2. In the bootstrap, replace `JSON.parse` with a `Proxy`.
3. Hand the modified HTML to `executeInWebView`, so the site's own bundle runs: it signs its own API
   requests with `_` and decrypts the `{"e": …}` responses itself, then calls `JSON.parse` on the
   plaintext — where the proxy captures it.
4. `inject` returns `window.__comixResult__`.

Chapter listing pages by clicking the real "next" button rather than rewriting the URL, because the
URL carries the per-request `_` signature and editing it returns `403`. Browse and page lists use
the same capture with different match predicates, each with a 20 s timeout.

The WebView runs under `Application.getDefaultUserAgent()` — the UA `cf_clearance` is bound to — so
the page's own loads and its same-origin XHRs clear Cloudflare.

**Neither the `_` token nor the `e` cipher ever has to be reimplemented.** That also makes the
rotating `secure-<hash>.js` bundle a non-issue: whatever it changes to, it still decrypts its own
payloads before `JSON.parse` sees them.

## Verdict — buildable, but already covered

| Capability               | Status                                         |
| ------------------------ | ---------------------------------------------- |
| Transport past Turnstile | `CLOUDFLARE_BYPASS_PROVIDING`                  |
| Discover sections        | Homepage `initial-data`, no token needed       |
| `getMangaDetails`        | Series-page `initial-data`, no token needed    |
| Search / browse          | `executeInWebView` + `JSON.parse` capture      |
| `getChapters`            | `executeInWebView`, paginated by clicking Next |
| `getChapterDetails`      | `executeInWebView`                             |
| Image descrambling       | `PBCanvas`; seeds arrive in response headers   |

Every layer has a solution, so the question is no longer feasibility but duplication. Inkdex's
extension is at **alpha.46** and actively maintained, under the same licence, on the same platform.
`CLAUDE.md`'s "Comix — already covered" entry meant exactly this, now confirmed concretely.

Two differences from this repository's conventions are worth noting before any decision to build a
second one: Inkdex's Comix bundles **cheerio**, which
[`../paperback/runtime.md`](../paperback/runtime.md) prices at ~280 KB against ~20 KB bundles; and
it declares `ContentRating.EVERYONE` for a mixed-content site.

## Corrections this document has already needed

Recorded because the pattern matters more than any single error: three claims here were stated
confidently and were wrong — that the `_` token was canvas-fingerprint-derived (it is deterministic
and request-derived), that the runtime has no canvas (`PBCanvas` exists), and that no WebView
JS-evaluation API exists (`executeInWebView` does). Each was an inference from an incomplete check
rather than a verified fact. When this page says something is impossible, re-verify it against
`@paperback/types` before believing it.
