# Comix performance

What reading time is spent on, what was fixed, and every optimisation that was
tried and did not work. Measured on device across 2026-08-19/20.

Recorded because most of this looks worth trying and is not: without the
disproofs below, each avenue reads like an obvious idea nobody got round to.

## Where the time goes

| Stage                         | Cost                               |
| ----------------------------- | ---------------------------------- |
| Descrambling a scrambled page | 30-102ms                           |
| Page list (one per chapter)   | ~1.5-2.3s                          |
| Chapter list walk             | ~530-800ms per page of 20 chapters |

A chapter walk is one signed request per 20 chapters. An 8,155-chapter series is
408 requests, measured at 217s. **Per-page cost fluctuates by 30-50% between
series and between runs**, so any single measurement is a weak baseline — an
early 532ms/page reading was a favourable moment, not a fixed number.

The image pipeline was never the bottleneck. Several releases went into tuning a
stage costing under a tenth of a second while the real cost was three orders of
magnitude larger. Measure before optimising.

## What was actually fixed

Three of the four large wins were this extension getting in its own way.

| Fix                                        | Effect                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Stop pacing the site's own WebView traffic | Removed ~95s of sleeping per session; a chapter open had been spending ~43s asleep across five stalls              |
| Implement `processTitlesForUpdates`        | Library sweeps no longer monopolise the WebView, which had made an unrelated chapter open take 45s instead of 1.5s |
| Update checks read the newest page only    | One request instead of 408 for a changed series                                                                    |
| Re-encode descrambled pages as JPEG        | Pages were becoming multi-megabyte PNGs; chapter downloads roughly halved                                          |

## What was tried and does not work

Every route to making the walk itself faster, and the evidence that closed it.
Rows marked (console) were verified in a browser console against the live site on
2026-08-20; the earlier rows they replace had drawn the wrong conclusion from a
weaker test.

| Attempt                                 | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enlarge `limit` in the request          | The signature covers the whole query string. A captured URL replays `200` unmodified, but the same URL with `limit=500` returns `403 {"message":"Invalid token."}` and with the token stripped `403 {"message":"Missing token."}` — two different errors, so 403 means token mismatch, not an oversized page. The router itself ignores `?limit=` in the URL and always mints `limit=20`. The old "403 at 50/100/500" reading was measuring the reused signature, never a page-size cap. (console) |
| Forge a signature                       | Plaintext is compressed before encryption (a 108-byte query yields 105 bytes, an empty one 17) and the cipher lives in the obfuscated `secure-*.js` with a WASM module. Not reimplementable.                                                                                                                                                                                                                                                                                                       |
| Reach the site's own signer             | Signing is an axios request interceptor — the minting stack is `request` → `dispatchRequest` → the XHR adapter in `vendor-*.js`, so the instance would sign whatever params it is handed. But it is module-scoped in the Vite bundle and absent from the React fiber tree (walked it, 0 axios-like instances). Unreachable from injected code. (console)                                                                                                                                           |
| Find a bulk chapter-list endpoint       | None exists. On reader load only `/api/v1/chapters/{id}` (one chapter's content) and `/api/v1/manga/{hid}` (a 7.7KB detail with no embedded chapter list) are fetched; navigating chapter-to-chapter refetches only content by id. So each chapter payload carries its neighbours' ids — a linked list, walkable only one request per chapter, worse than the paginated list. (console)                                                                                                            |
| Call the site's own React Query fetcher | Reachable via the fiber, but it closes over its own `page`/`limit` and returns page 1 whatever key is passed.                                                                                                                                                                                                                                                                                                                                                                                      |
| Server-rendered `?page=N`               | Server ignores it; `initial-data` carries `detail`, `recommended` and `groups` on every page, never chapters.                                                                                                                                                                                                                                                                                                                                                                                      |

### Clicking versus navigation: settled on device, clicking wins

An earlier revision claimed `pushState` driven by payload arrival was _slower_
than clicking (612/798ms against 532ms), then that a proper browser A/B showed
navigation _winning_ (584-656ms, 10/10, against clicking's timeouts). Both were
desktop measurements and both were wrong. The device settles it.

Navigation shipped twice — alpha.37 alongside the rate-limiter bug, and alpha.40
with the limiter corrected — so the confound that made the first run unreadable
is gone from the second:

| Series       | Pages | Click (a.39) | Nav (a.37, bad limiter) | Nav (a.40, fixed limiter) |
| ------------ | ----- | ------------ | ----------------------- | ------------------------- |
| 242 chapters | 67    | 28,844ms     | 51,908ms                | 51,202ms                  |
| Dawn         | 32    | 16,341ms     | 24,578ms                | 23,398ms                  |

Roughly **470ms per page clicking against 750ms navigating**. The two navigation
runs are days apart on different builds and agree within 1.4%, ruling out session
noise and showing the limiter never contributed to navigation's cost (isolated
separately: alpha.38 limiter-off 16,317ms against alpha.39 scoped 16,341ms on the
same series — the corrected limiter is free). A route change re-renders the page
and re-runs its other queries: cheap in a desktop browser, expensive in the app's
WebView.

Desktop timing of this walk has now mispredicted the device three times out of
three. Do not reopen it without device numbers.

### The harvest route: mint signatures fast, replay in parallel

A different shape, explored 2026-08-20. The XHR hook captures the signed URL at
`xhr.open` — _before_ React Query can cancel the query — so a walk does not need
each in-page request to succeed, only to be _issued_. Drive `pushState` through
the pages to mint signed URLs, ignore every response, then replay the harvested
URLs with `fetch` in parallel.

Parallel replay is genuinely fast and unthrottled: 11 pages' fetches in 545ms,
all `200`, no rate-limiting on the burst.

Minting is the catch. Fixed inter-navigation delays are unreliable — at 120ms
only alternating pages mint (React Query supersedes each query before its XHR
issues), reproducibly and on a cold page, so it is real cancellation, not a cache
artifact. **Advancing on the mint event fixes reliability completely:** hook
`xhr.open`, navigate, and advance the instant the current page's request is seen,
with a timeout fallback. Measured **11/11 pages minted, every run.**

But the same measurement exposes the floor. Per-navigation mint latency is
**~400ms/page** (300-485ms across 11 navigations), sequential, because the SPA
holds one active chapter query and cannot overlap. Harvest ~400ms/page plus a
~50ms/page parallel burst totals ~450ms/page — a dead heat with clicking's
~470ms.

So the harvest route **matches clicking's reliability and ties its speed; it does
not beat either.** The ~400ms is the router's own render-and-issue cycle, the
same whatever triggers the query, not overhead the technique can remove.

**Documented as a ready alternative, not shipped.** Its one real edge over the
shipped clicking walk is that it drives the walk by URL routing rather than by
finding a pager button in the DOM, so a pager restyle that broke the button
finder would not break it. If clicking ever fails in production for that reason,
this is the validated swap-in — event-driven advance on `xhr.open`, parallel
`fetch` replay of the harvested URLs. Proven in a browser tab (11/11 mint,
parallel 200s); never run on device.

## Why the walk is irreducible

Four findings compose, each verified in a browser console against the live site:

1. **20 chapters per request, and `limit` is inside the signature.** The router
   mints `limit=20` regardless of the URL, and altering any query param
   invalidates the token.
2. **Only the site's own code can mint the token.** The signer is an axios
   interceptor backed by a WASM cipher, module-scoped and unreachable from
   injected code; it cannot be forged or called directly.
3. **No bulk endpoint.** Nothing returns more than one 20-chapter page; the reader
   navigates a linked list, one request per chapter.
4. **Minting is a ~400ms/page sequential floor.** One active chapter query at a
   time, so navigations cannot overlap, and each costs the router's full
   render-and-issue cycle — the same whether triggered by a click or a
   `pushState`.

Both independent implementations — Mihon's at `keiyoushi/extensions-source` and
Inkdex's — click through the same pager one page at a time. Neither requests a
larger limit or calls the API directly. That is not an oversight; it is the only
thing the site permits.

The recurring costs are fixed. The one-time cost of a very long series is bounded
below by 20 chapters per ~400ms — about three minutes for 8,000 chapters — and is
not fixable from outside the site. The only lever left is not the walk but
avoiding repeating it: an incremental refresh (`getChapters`' `sinceDate`, or a
locally cached high-water mark) that re-walks only what is newer than the app
already holds. First open still pays the full walk once; every open after it
becomes one or two pages.
