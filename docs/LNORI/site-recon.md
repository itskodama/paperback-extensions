# LNORI site recon

Feasibility notes for a Paperback extension for `lnori.com` ("LNORI | Curated Light Novel
Library"). Everything here was verified with `curl` against the live site on 2026-07-12, except
where a later dated note says otherwise.

## Status: site-wide Cloudflare challenge since 2026-08-09 — bypassed

Sometime between `2026-08-09 05:05Z` (last passing hourly CI run) and `06:57Z` (first failing one),
lnori.com enabled a Cloudflare **managed challenge** across the whole zone. Every path answers `403`
with `cf-mitigated: challenge` and the "Just a moment…" interstitial (`cType: 'managed'`). The
extension could not reach the site at all for three days; it now solves the challenge through the
app's bypass WebView, as described under "Getting past it" below.

Verified 2026-08-12 from two networks (residential + GitHub Actions), repeated, with the
extension's own iPhone UA and with full Chrome-like headers — not a blip, not IP-specific, not
markup drift:

| URL                                    | Before | Now                 |
| -------------------------------------- | ------ | ------------------- |
| `/`, `/library`, `/series/<id>/<slug>` | `200`  | `403` challenge     |
| `/me/signin`                           | `200`  | `403` challenge     |
| `cdn.lnori.com/cover/<id>.webp`        | `200`  | `403` challenge     |
| `img.lnori.com/<id>-NN.jpg`            | `200`  | `403` challenge     |
| `/favicon.ico`                         | `200`  | `200` (edge-cached) |

The origin is alive (favicon still serves), so this is a WAF config flip, **not** the
takedown/domain-hop failure the Risks section predicted. Nothing in `src/LNORI/` changed — its last
commit is 2026-07-12.

### Getting past it

**Declaring `CLOUDFLARE_BYPASS_PROVIDING` does nothing on its own.** The app does not detect the
challenge and offer a bypass by itself — waiting for it to notice a `403` is the obvious wrong turn,
and it fails silently on device with no banner and no WebView. The app raises the bypass banner only
when the extension **throws a `CloudflareError`**, whose `resolutionRequest` tells the WebView what
to load. The capability is a prerequisite for that throw being honoured, not a trigger.

Two consequences shape where the throw goes and what it carries:

- **It belongs in `interceptResponse`, not the fetch wrapper.** Covers and inline illustrations are
  fetched by the app's image loader and never pass through `fetchPage`, so a check there would
  leave every image broken. The interceptor sees them.
- **`cf_clearance` is bound to the exact User-Agent that solved the challenge.** So the resolution
  request and every outbound request must carry the same UA — `Application.getDefaultUserAgent()`
  on both sides. The old hardcoded iPhone UA would have invalidated the clearance; so would
  dropping the header entirely and hoping the app's default matches the WebView's.

`CookieStorageInterceptor` then persists the returned `cf_clearance`. Its domain matching is
suffix-based, so a cookie scoped to `.lnori.com` also covers `cdn.` and `img.`. Note it drops
cookies with no `expires` when persisting — a clearance without one survives the session but not an
app restart.

## What it is

A curated library of **licensed English light novels** (Yen On/Yen Press releases and similar:
Re:ZERO, Bookworm, Classroom of the Elite, …), ~884 series, served as complete volumes. This is a
piracy library of commercial books, which matters for durability: the likeliest failure mode is not
markup drift but a takedown/domain hop.

## Transport

- Server-rendered plain HTML. No framework markers (no `__NEXT_DATA__`, no astro-island, no Nuxt).
  Zero external scripts on the homepage; the book page loads one `/book/script.js` plus an inline
  thumbhash module — nothing content-critical is client-rendered.
- Cloudflare fronts it (`server: cloudflare`). It did **not** challenge as of 2026-07-12 — plain
  GETs returned `200` — but **it does now**; see the status section above. Pages are CDN-cached
  aggressively (`max-age=2678400`, observed `age` in days) — the site is effectively static.
- `cdn.lnori.com` (covers, `cover/<bookId>.webp`) and `img.lnori.com` (inline illustrations,
  `<bookId>-NN.jpg`) had no hotlink protection — both served `200` with no referer and with a
  foreign one. Both are behind the same challenge as of 2026-08-09; the hotlink finding is
  untestable until the challenge is passed, and unlikely to have changed independently.
- No auth gate anywhere in the read path. `/me/signin` exists but content is fully public.

## Structure

Three levels: **series → book (volume) → inline full text**.

| Page    | URL                   | What it carries                                                  |
| ------- | --------------------- | ---------------------------------------------------------------- |
| Library | `/library`            | ~1.8 MB; **all 884 series** as `<article class="card">` entries  |
| Series  | `/series/<id>/<slug>` | schema.org `Book` JSON-LD incl. `hasPart` (every volume)         |
| Book    | `/book/<id>/<slug>`   | `Book` JSON-LD + the **entire volume text** as EPUB-derived HTML |

- **Bare ids 404.** `/series/3343` and wrong-slug URLs return `404`, no redirect. Identifiers must
  be the composite `<id>/<slug>` path segment (so `mangaId = "3343/re-zero-starting-life..."`).
- Library cards carry data attributes: `data-id`, `data-t` (title), `data-a` (author), `data-d`
  (year), `data-v` (volume count), `data-tags` (genres), `data-rel` (relevance/popularity rank),
  plus cover URL and canonical link. Site search is **client-side** over this page (`/library#q=`),
  so an extension replicates search/filter/sort locally from one cached fetch.
- Series JSON-LD: `name`, `author`, `description`, `genre` (joined string), `image`, and
  `hasPart[{name: "Volume N", position, url}]` — a complete chapter list with **no HTML parsing**.
  No per-volume dates there (the book page's JSON-LD has `datePublished`).
- Book page: schema.org metadata plus the full text — `<section epub:type="bodymatter chapter">`
  blocks, `<h2 class="chapter-title">`, ~2,700 `<p>` and 19 inline illustrations for a typical
  volume (~480 KB HTML).

## Mapping onto Paperback

- `contentType: 'novel'`; `ChapterDetails` uses the **`html` variant**.
- **Volumes are split into their real chapters via the book page's TOC sidebar** — every book
  page opens with `toc-sidebar`, whose `#pageNN` anchors match the content's
  `<section class="chapter" id="pageNN">` wrappers and whose text carries the true chapter titles.
  A chapter slice runs from its section to the next TOC entry's section. Numbering: explicit
  "Chapter N" prefixes keep N (Re:ZERO), fully unnumbered TOCs (Bookworm) fall back to ordinals,
  and surrounding matter interpolates as decimals (Prologue 0.4, Epilogue 5.1).
- The TOC only exists on the ~500 KB book page and the CDN **ignores Range requests** (200, never
  206), so listing chapters costs one page per volume (~160 KB gzipped; a 28-volume series ≈
  4.5 MB cold, ~15 s at the 20 req/10 s limiter). Volumes are immutable, so parsed TOCs are cached
  for the session and refreshes are free. `datePublished` from the book JSON-LD backs
  `publishDate`.
- `getChapterDetails`: fetch the book page, cut out the `epub:type` bodymatter sections (regex on
  section boundaries; no HTML parser needed — same discipline as AsuraScans), hand the HTML to the
  reader with `img.lnori.com` images left inline.
- Search/browse: local over the library page; a `genre` key in the search metadata filters on the
  cards' `data-tags` (slugs hyphenate what tags write with spaces — normalise both sides).
- Discover: the homepage hero carries `data-title/-author/-desc/-image/-link` per
  `hero-carousel-card` (→ featured). The seasonal block is anchored by its "Seasonal Preview"
  kicker and its heading names the section ("SUMMER 2026 ANIME") — the title is read from the
  page, since it changes each season. Genre chips come from the homepage's `/genre/<slug>` links
  (their text is lowercase behind an emoji; strip and title-case). Popular is compiled from the
  library's `data-rel` rank, no extra request.

## The linchpin — device verification

Everything above is one clean fetch layer; the unknown is entirely on the **app side**: whether
Paperback's `html` reader renders a whole-volume chapter (~480 KB of HTML with inline remote
images) acceptably on device. That is a device-only surface exactly like forms/`Metadata` — no
local test can answer it. Probe with a stub extension returning one hardcoded book before building
anything.

## Risks

- **Takedown, not rot.** Markup is EPUB-derived and framework-free, so scraper rot is low; but a
  public library of licensed Yen Press novels is a prime DMCA target. Assume the domain is
  disposable; keep the domain constant in one place.
- **The WAF is the third failure mode, and it's the one that actually fired** (2026-08-09, above).
  A site under this much legal pressure can turn a challenge on for the whole zone in one dashboard
  click, with no warning and nothing to diff. Neither the low-rot markup nor the "keep the domain
  in one place" mitigation helps against it — plan for the bypass capability to be a permanent part
  of this extension, and expect the challenge level to keep moving.
- Volume ids are embedded in slugs (`vol-03` vs `vol-3` inconsistencies observed), so never derive
  anything from slug text; use JSON-LD `position`.
