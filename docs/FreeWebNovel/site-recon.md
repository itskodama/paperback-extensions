# FreeWebNovel site recon

Feasibility notes for a Paperback extension for `freewebnovel.com` ("Free Web Novel"). Everything
here was verified with `curl` against the live site on 2026-08-20, except where a later dated note
says otherwise.

`docs/ecosystem/candidate-ranking.md` picked this site as the highest-value unclaimed target
(Tranco 3,271 — more trafficked than MangaDex, roughly 350× either novel source this repository
already ships). The screen there was two lines long: "Clean — no Cloudflare, no WordPress". This
page is the detail behind that.

## What it is

A large aggregator of English web-novel translations — Chinese, Korean and Japanese web novels plus
some original English serials. The site tags each novel with its **original language**, which is a
first-class browse axis (`/sort/latest-release/chinese-novel`) rather than metadata.

Catalog scale, read off the pagers: `/genre/*` and the `/sort/*` lists all run to 50 pages of 20,
and individual novels run very long — 7,205 chapters for _Emperor's Domination_, 3,160 for
_Shadow Slave_. Chapter count, not novel count, is what this extension has to be engineered around.

## Transport

- **Server-rendered HTML on every page that matters.** No SPA, no hydration payload, no JSON island
  to dig out. Nine `<script>` tags on the homepage, all of them analytics, ads or progressive
  enhancement; zero `__NEXT_DATA__`/`__NUXT__`/`data-reactroot`.
- **No JSON-LD.** Unlike LNORI, there is no `application/ld+json` block anywhere. The structured
  data lives in `og:novel:*` meta tags instead — see [Structure](#structure).
- Cloudflare fronts it (`server: cloudflare`, `cf-ray` present, a `challenge-platform/scripts/jsd`
  iframe on the page) but **does not challenge plain requests**. Every endpoint tested returned
  `200` to a bare `curl` with a browser UA. No `CLOUDFLARE_BYPASS_PROVIDING` needed.
- **A realistic `user-agent` is mandatory.** With one, `/home` is 105 KB; with no UA header at all
  the same URL returns a 5.5 KB stub and a listing page returns zero rows. This is the single
  request-shaping requirement — no cookie, no referer, no token.
- **`https://` is required going in but the site 301s to `http://` on the apex.** `curl -L` follows
  it back to `https` for the canonical `/home`; request paths directly and the redirect never fires.
- **gzip is honoured and worth having**: a 200-entry chapter-list page is 40,516 bytes plain and
  4,022 bytes gzipped, a 10× reduction.
- **Cover images need no referer and no UA.** Both the JPEG originals (`/files/article/image/…`)
  and the WebP derivatives (`/cache/cover-webp/…`) serve `200` to an unadorned request. Both carry
  file extensions, so `BasicRateLimiter`'s `ignoreImages` works here (it matches by extension).
- **Use the WebP derivatives, not the JPEG the `<img>` points at.** Every listing row, the release
  feed and the novel page all carry a `<source type="image/webp" srcset="…">` beside the `<img>`,
  offering the cover pre-scaled to the width it is being shown at. The `<img>` src is always the
  single full-size JPEG. Measured over 14 covers the WebP set is **76% smaller** — 183 KB against
  760 KB — and over a real 12-cover discover page, **75%** (154 KB against 629 KB). A handful of
  already-small covers are a few hundred bytes _larger_ as WebP; the aggregate is not close. The
  runtime cannot **encode** WebP (`api-reference.md`), which is a different question from displaying
  it — Comix decodes WebP page images, and `ignoreImages` lists the extension.
- **`robots.txt` is `User-agent: *` / `Disallow:` — an empty disallow, which permits everything**,
  plus a sitemap pointer. There is no crawler restriction to reason around.
- **No observed rate limiting.** 16 concurrent chapter-list requests all returned `200` in 0.53 s
  total. That is a ceiling probe, not a licence — see [Cost model](#cost-model).
- **Cloudflare blocks Node's `fetch` on its TLS fingerprint, which breaks `npm test`.** Found
  2026-08-20 while driving the finished extension end-to-end. `curl` with a browser UA gets `200`;
  Node's built-in `fetch` (undici) gets `403` on the same URL in the same second, and adding
  `accept`, `accept-language` or any other header does not change it — the block is below the HTTP
  layer. This matters beyond the harness: `@paperback/runtime-polyfills`' `RequestManager` issues
  its requests with global `fetch`, so **the live suite cannot reach this site**, and the hourly
  `test.yaml` run cannot validate it either. It is a Node-only problem — the app itself requests
  through Swift's URLSession, whose fingerprint is a real browser's. Drive local end-to-end checks
  through `curl` (stub `Application.scheduleRequest` and shell out) and treat the device as the only
  true end-to-end.
- **An explicit `page=1` is `301`-ed as non-canonical**, and this runtime does not follow redirects,
  so sending one fails the request outright. Every listing URL omits the page when it is 1. The
  redirect is the site canonicalising, not rate limiting: `?keyword=shadow` is `200` and
  `?keyword=shadow&page=1` is `301` to the former. `%20` and `+` are both accepted in `keyword`,
  which is what makes this easy to misdiagnose as an encoding problem.
- **There are no mirrors.** `freewebnovel.net`, `libread.com` and `bednovel.com` all resolve and all
  respond `200`, but none is the same codebase: probing `/novel/shadow-slave` on each returns a
  16 KB page with zero `og:novel:` tags and no `#idData`, against the real site's 74 KB page with
  ten. `freewebnovel.io` redirects to an unrelated manga site; `freewebnovel.me` and `innread.com`
  do not resolve. **The domain is a single point of failure with no fallback.**

## Structure

Three URL levels — catalog → novel → chapter — plus a JSON side-door for chapter lists.

| Endpoint                                          | Carries                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/home`                                           | Featured shelf, "Latest Release" feed with relative timestamps, genre nav         |
| `/novel/<slug>`                                   | Full novel record, plus chapter-list page 1 and the paging counters               |
| `/novel/<slug>?ajax=chapters&page=N&pageSize=M`   | **JSON** `{code, html, page, pageSize, totalPage, totalChapters}`                 |
| `/novel/<slug>/chapter-<n>`                       | One chapter's text                                                                |
| `/search?keyword=<q>&page=N`                      | Keyword search, 20/page                                                           |
| `/search-adv?apply=1&<filters>&page=N`            | The filter engine, 20/page                                                        |
| `/sort/<key>[/<lang>-novel][/completed][/<page>]` | Browse lists: `most-popular`, `latest-release`, `latest-novel`, `completed-novel` |
| `/genre/<Genre>[/completed][/<page>]`             | One genre, 20/page, up to 50 pages                                                |

`mangaId` is the bare slug (`apocalypse-gachapon`) — clean, stable, and the only identifier the
site uses in URLs. The numeric `data-article-id` (`3612`) exists but keys only the ratings and
library APIs, which are out of scope.

### One row markup serves all four listing endpoints

`/search`, `/search-adv`, `/sort/*` and `/genre/*` emit structurally identical `div.li-row` blocks.
Each carries slug, cover (JPEG `src` plus a WebP `srcset`), title, numeric rating, original
language, genres, total chapter count and the latest chapter's link and title. **One parser covers
all four**, and the fields are rich enough to post-filter client-side when the server cannot express
a query.

Pagination is a `div.pages` block whose final `<a>` is the last page number — read it there rather
than guessing. Note that `/sort` and `/genre` take the page as a **path segment**
(`/sort/most-popular/2`); `?page=` is silently ignored on those two. `/search` and `/search-adv`
take `?page=`.

### `og:novel:*` is the real detail API

The novel page carries ten of them, and they are a far better parse target than the nested `div.txt`
markup: single-line, attribute-escaped, and stable against a restyle.

```
og:novel:category            Chinese Novel
og:novel:genre               Action, Harem, Mature, Romance, Sci-fi
og:novel:author              Xuan Huang
og:novel:status              OnGoing
og:novel:update_time         2026-08-21 07:08:22
og:novel:lastest_chapter_name  (sic — the site's own spelling)
og:novel:lastest_chapter_url
og:novel:novel_name
og:novel:read_url
og:novel:author_link
```

Plus ordinary `og:image` (cover) and `og:description` (synopsis). Only two things are not in a meta
tag: **alternative titles**, which sit in the `glyphicon-tasks` block, and the **rating**, in
`div.score .vote`. Read those two from markup and everything else from meta.

The page root also carries the paging counters as data attributes, which is what makes the update
sweep cheap:

```html
<div
  class="main"
  id="indexListPage"
  data-article-id="3612"
  data-current-page="1"
  data-page-size="40"
  data-total-page="61"
  data-total-chapters="2429"
></div>
```

### The chapter-list JSON endpoint

Discovered by reading `/static/freewebnovel/js/indexlist.js?v=1.4`, which paginates the list
client-side. `?ajax=chapters&page=N&pageSize=M` returns JSON whose `html` field is a run of
`<li><span …/><a href="/novel/<slug>/chapter-<n>" title="<title>" class="con">…</a></li>`.

Two findings:

- **`pageSize` is capped server-side at 200.** Requests for 1,000, 5,000 and 100,000 all come back
  as `pageSize: 200`. The page's own UI uses 40.
- **`X-Requested-With: XMLHttpRequest` is not required** despite the site's own code sending it —
  the `ajax` parameter alone is enough.

Because the response reports `totalPage`, page 1 both returns data and tells you how many more
requests you need. No request is ever wasted.

The chapter page's own `<select class="catalog">` is **not** a shortcut — it ships empty and is
filled by the same endpoint.

### Chapter pages

Content is a single `<div id="article">` holding an optional `<h4>` title and a run of `<p>`
paragraphs. Sampled across five novels (91, 51, 45, 145 and 39 paragraphs):

- Every `<p>` is **bare** — zero attributes on all 371 sampled.
- **No images**, no `<span>`s, no named entities, no numeric entities. Punctuation arrives as raw
  UTF-8.
- **No obfuscation**: no hidden paragraphs, no `display:none` text, no character substitution, no
  watermark spans. This is unusual for the category and should be re-checked if parsing ever breaks.
- **1–3 `div.reader-ad-skip` ad blocks are injected inline, mid-article.** They contain `<div>` and
  `<script>` and **no `<p>`**, so they cannot contribute false paragraphs — but they do mean a
  non-greedy `<div id="article">(.*?)</div>` truncates the chapter at the first ad. Use a
  brace-balanced scan, or collect the `<p>` elements directly.

`#prev_url` / `#next_url` anchors give chapter neighbours if ever needed.

## Chapter numbering — the URL index is the only trustworthy number

This is the one genuinely hard problem, and the answer is the opposite of NovelArchive's.

Two numbers exist per chapter: the **URL index** (`/chapter-2429`) and whatever number the **title**
embeds (`Chapter 2213 - 40 closeness`). They disagree, and the disagreement is not a constant.

Measured over the complete 2,429-chapter list of _Apocalypse Gachapon_ (13 requests at
`pageSize=200`):

| Property                       | URL index | Title-embedded number    |
| ------------------------------ | --------- | ------------------------ |
| Present on every entry         | yes       | no — 3 entries have none |
| Gapless `1..N`                 | **yes**   | no                       |
| Strictly increasing            | **yes**   | **no**                   |
| Unique                         | **yes**   | yes                      |
| Distinct offsets from position | 1         | **428**                  |

The offset distribution is not a long tail around one value — the three commonest offsets are 0
(218 entries), 180 (206) and 181 (173). There is no consensus offset to find.

Gaplessness was then confirmed on four more novels spanning the size range — _Shadow Slave_ (3,160),
_Emperor's Domination_ (7,205), _My Vampire System_ (2,545), _Omniscient Reader's Viewpoint_ (552).
All gapless.

**So `chapNum` is the URL index, and `chapterId` is the same integer as a string** — it round-trips
straight into `/novel/<slug>/chapter-<id>` with no lookup table.

### Two different questions, and only one of them lacks a consensus

These are easy to conflate, and conflating them is how the first cut of this extension shipped a bug.

**Question one — what should `chapNum` be?** The URL index, per the table above. **NovelArchive's
`detectNumberingOffset` must not be ported for this.** It exists to recover a _consistent_ offset
that the title numbers imply and the ids do not; here there is no such offset, so it would parse
2,429 titles only to return `{ offset: 0, trusted: false }`. The URL index already has every
property that detector is trying to manufacture.

**Question two — is a number at the front of a title part of the title, or a numbering artifact?**
Here a consensus very much does exist, and the first cut of this extension wrongly generalised
"no consensus on this site" from question one and got question two wrong as a result.

Some novels label chapters with a second, drifted chapter number ahead of the real title. Others
put a genuine number there. The surface forms are identical:

| Novel                 | Title                              | The leading number is |
| --------------------- | ---------------------------------- | --------------------- |
| _Apocalypse Descent_  | `Chapter 69 - 68: New Expansion…`  | a drifted number      |
| _Apocalypse Descent_  | `Chapter 86 80 Ice Crystal Sword…` | a drifted number      |
| _Apocalypse Gachapon_ | `Chapter 142 - 2 star evolution`   | title text            |
| _Apocalypse Gachapon_ | `Chapter 1993 - 10 million`        | title text            |

Not even the separator distinguishes them. What does is that **an artifact is systematic and prose
is not** — measured over first pages:

| Novel                                                                | Titles opening with a number | Ascending |
| -------------------------------------------------------------------- | ---------------------------: | --------- |
| _I Am Immortal in Great Yu_                                          |                    **97.8%** | yes       |
| _Apocalypse Descent_                                                 |                    **66.0%** | yes       |
| _Cultivation Online_                                                 |                         1.0% | no        |
| _Apocalypse Gachapon_                                                |                         0.5% | no        |
| _Shadow Slave_, _Emperor's Domination_, _TBATE_, _My Vampire System_ |                           0% | —         |

Two populations with sixty-five points of empty space between them. `resolveChapterTitles` takes the
whole assembled list and strips the leading number only when it is present on ≥50% of entries and
ascends across ≥95% of adjacent pairs, with a minimum sample so a short novel is never guessed at.
Verified end to end: 96% and 98% of entries stripped on the two affected novels with no leading
digit left behind, and **zero** entries touched across the other four.

Neither single-entry rule works. Stripping unconditionally — correct for the
[LightNovelWorld extension](../LightNovelWorld/site-recon.md), whose site carries the artifact
universally — yields "star evolution", "million" and "D Wheel". Never stripping leaves exactly the
duplicated number [`chapters.md`](../paperback/chapters.md) warns about. The population decides, not
the entry.

A useful side effect: this subsumes the "1 Nightmare Begins" case from `chapters.md` without a
special rule, and catches it even when the bare number has drifted away from the index.

The one place it cannot apply is the homepage release feed, where a single item has no siblings to
be judged against. There only the `Chapter N` prefix comes off, so a carousel subtitle on an
affected novel keeps a number the chapter list would have dropped.

**The accepted consequence:** on a novel whose own numbering has drifted, the app shows
"Chapter 2429" where the site's list shows "Chapter 2213". Ordering, resume position and chapter
identity all stay correct, and `shareUrl` returns the reader to the site's own page. This is the
right trade — monotonicity is worth more than label parity, and duplicate `chapNum`s would be
silently collapsed by the app's version priority.

**No per-chapter dates are available.** The chapter list carries titles only. The novel page's
`og:novel:update_time` dates the newest chapter and nothing else, and the homepage feed gives
relative times for the latest chapter of each listed novel. So `publishDate` is set on discover's
chapter-update items and omitted on `Chapter` — omitted, not `undefined`.

Those relative times run compound ("11 months, 2 weeks ago" as well as "3 mins ago"), so every unit
present is summed rather than the first one read; and the month and year lengths are the mean
Gregorian values, because on a year-old chapter a 365-day year is days out.

### Content rating is only knowable on the novel page

The site states a rating as a `content-rating-<value>` class on the novel page, over the same
vocabulary its filter form uses (`general`, `guidance`, `suggestive`, `adults-only`). **Nothing
carries it on a listing row** — not the row, not the badge slot; every `18+` string on a listing
page belongs to the filter form's own `<option>` list.

That matters because a row prints only its **first two genres** and this site orders the explicit
tags late. Measured against each novel's real rating:

| Browse page    | Adult titles | The row reveals | Leaked as MATURE |
| -------------- | -----------: | --------------: | ---------------: |
| Most Popular   |       0 / 20 |               0 |                0 |
| Latest Release |       7 / 20 |               2 |                5 |
| Latest Novels  |      12 / 20 |               4 |                8 |

So genre inference on a row is a **lower bound**: an Adult or Smut tag proves a novel is adult,
its absence proves nothing.

Two signals, treated differently on the novel page: a tag is proof and outranks everything, since
the site rates some novels "Parental Guidance Suggested" while tagging them Adult and Smut; failing
that, its stated rating is taken at face value, including when it clears a novel outright; with
neither, the rating is unknown and this source's floor is MATURE.

For listings, `main.ts` reads `Application.filterAdultTitles` and resolves each row against its
novel page **only when the app is filtering** — one request per row, paid solely by the users for
whom it changes anything, and verified to lift Latest Novels from 4 detected to the true 12. When
filtering is off, no extra request is made. A row that cannot be verified while filtering is
answered ADULT rather than letting a failed request show adult content.

## Cost model

`getChapters` must return the complete list, so its cost is `ceil(totalChapters / 200)` requests:

| Novel                  | Chapters | Requests |
| ---------------------- | -------- | -------- |
| Typical                | ~500     | 3        |
| _Shadow Slave_         | 3,160    | 16       |
| _Emperor's Domination_ | 7,205    | **37**   |

Page 1 reports `totalPage`, so pages 2..N issue concurrently and nothing is speculative.

**The recurring cost is what matters, not the first open.** Without intervention every library
refresh re-walks every novel — 37 requests for one title, multiplied by the library. This is the
failure mode `docs/Comix/performance.md` records in detail ("Library sweeps no longer monopolise the
WebView"; "One request instead of 408 for a changed series").

FreeWebNovel can answer "what changed" more cheaply than any other source in this repository,
because `data-total-chapters` states the count outright:

1. Fetch `/novel/<slug>` — one request — and read `data-total-chapters`.
2. Equal to `updateManager.getNumberOfChapters(mangaId)` → `setUpdatePriority(id, "skip")`.
3. Changed → fetch **only the last** ajax page, diff by `chapterId` against
   `updateManager.getChapters(id)`, and hand the remainder to `setNewChapters(id, unseen)`.
4. Anything unexpected → fall through to `"high"` and let the app call `getChapters`. One title's
   failure must never abandon the sweep.

This is stronger than Comix's remembered high-water mark: the count is exact and server-supplied, so
the extension keeps no state of its own. An unchanged library costs one request per novel.

**Rate limiting is not tuned yet.** The extension ships LNORI's budget (20 requests / 10 s,
`ignoreImages: true`) as a starting point. The 16-concurrent probe above says the site tolerates far
more, but a desktop probe is not the device — settle it from the app's debug log, which prints
`[BasicRateLimiter] rate limit hit, sleeping for …`, rather than from another `curl` run.

## Mapping onto Paperback

| Paperback               | FreeWebNovel                                                           |
| ----------------------- | ---------------------------------------------------------------------- |
| `contentType`           | `"novel"`; green `Novel` badge, repo convention                        |
| `ChapterDetails`        | the `html` variant — a complete XHTML document                         |
| `mangaId`               | the slug                                                               |
| `chapterId` / `chapNum` | the URL index                                                          |
| `contentRating`         | `MATURE` source-wide; `ADULT` per-novel from the Adult/Smut genres     |
| `langCode`              | `"en"` — the site publishes English translations whatever the original |
| `Chapter.version`       | unset; one source, one "Unversioned" bucket                            |
| `Chapter.volume`        | `0` — unset renders "Vol. TBA"                                         |

**Search splits across two endpoints.** `/search?keyword=` does free text; `/search-adv?apply=1`
does filters and **ignores `keyword`** (verified: passing one returns the unfiltered default set).
They cannot be combined server-side, so a query carrying both goes to `/search` and is post-filtered
client-side against the fields the rows already carry.

Two traps on `/search-adv`:

- **`apply=1` is required.** It is the submit button's own `name`/`value`, and without it the page
  renders the form with an empty result list and the placeholder "Select your preferences above".
  This looks exactly like "no matches" and is not.
- **`genre_match` is a single mode for the whole selected set** (`all` / `any` / `exclude`), so
  simultaneous include _and_ exclude is not expressible in one request. Send the include set with
  the chosen mode and drop excluded genres client-side.

**Both search endpoints cap at 5 pages / 100 results** — the site says so itself in its search tips
("Up to 100 results are displayed"), and the pager confirms it. Pagination must stop there rather
than request a sixth page. `/sort` and `/genre` are the ones that run to 50.

The filter vocabulary, read off the form: 4 original languages (numeric ids 1–4), 39 genres, plus
`content_rating`, `last_updated`, `chapters` (count band), `rating` (minimum), `status`, and six
`sort` orders (`updated`, `popular`, `rating`, `collected`, `chapters`, `title`). Genre values
contain spaces (`Gender Bender`, `Slice of Life`) — **they must be slugged before becoming any kind
of Paperback id**, which is a crash this repository has already shipped twice.

Discover maps cleanly, and two sections share one homepage fetch:

| Section        | Type             | Source                                         |
| -------------- | ---------------- | ---------------------------------------------- |
| Featured       | `featured`       | homepage hero shelf                            |
| Latest Release | `chapterUpdates` | homepage feed, `publishDate` from "3 mins ago" |
| Most Popular   | `simpleCarousel` | `/sort/most-popular/<page>`                    |
| Latest Novels  | `simpleCarousel` | `/sort/latest-novel/<page>`                    |
| Completed      | `simpleCarousel` | `/sort/completed-novel/<page>`                 |
| Genres         | `genres`         | 39 static chips                                |

## The linchpin — device verification

Two things cannot be proven locally and should be probed before the rest is built:

1. **Does the on-device XHTML reader render these chapters acceptably?** Same linchpin both existing
   novel recons name. Ship a stub returning one hardcoded chapter and look at it. `xmllint --noout`
   over a dumped document catches well-formedness — it is the same libxml2 that produces the
   on-device error — but says nothing about rendering.
2. **Does the advanced search form survive the bridge?** Forms are a device-only surface the Node
   runner cannot validate, and both production crashes in this repository so far came from id
   charset violations in exactly this kind of code.

Then, in order: a large novel's chapter list (_Emperor's Domination_, 37 pages) for the real walk
cost, and a library refresh to confirm the update sweep collapses to one request per novel. Read the
app's debug log rather than building instrumentation.

## Risks

- **Single domain, no fallback.** The three plausible mirror names are unrelated sites. If
  `freewebnovel.com` moves, the extension is dead until the constant is changed — cheap to fix,
  impossible to fail over automatically.
- **Markup restyle breaks the listing parser.** Mitigated where it matters most: the novel detail
  parser reads `og:novel:*` meta tags, which survive a restyle, and the chapter-list parser reads a
  JSON endpoint. The `div.li-row` listing parser is the genuinely exposed surface — but it is one
  function serving four endpoints, so a break is one fix, not four.
- **Ad markup drifting into the article body.** Today the ad blocks contain no `<p>` and so cannot
  inject false paragraphs. If that changes, paragraphs of ad copy would appear mid-chapter. The
  parser strips `div.reader-ad-skip` subtrees explicitly rather than relying on the `<p>` accident.
- **The 100-result search cap** is a site limitation, not a bug to fix. A user searching a common
  word sees the site's own first hundred.
- **Silent breakage is not currently reported, and here it is worse than elsewhere.** `npm test`
  exits `0` whatever the per-extension results are — the caveat recorded in `CLAUDE.md` after LNORI
  was dead for three days across ~70 green hourly runs. On this source the live suite cannot even
  reach the site, because Cloudflare rejects Node's `fetch` fingerprint (see
  [Transport](#transport)). So CI carries **no** signal for FreeWebNovel, not merely an unread one.
  Regression cover comes from `test/unit/FreeWebNovel.test.ts` and from the device.
