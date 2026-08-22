# HiveToons site recon

Reference for how `hivetoons.org` serves its data, and how this extension maps that onto
Paperback's types. Everything here was verified against the live site on 2026-08-21 by direct
probing — no HAR capture was needed, because nothing on the site requires a browser.

Re-verify with `curl` before trusting any of it. The site is not versioned and gives no
deprecation warnings.

## The site runs a shared platform

`hivetoons.org` is one deployment of a white-label comic platform called **Iken**. Keiyoushi
maintains a multi-site extension for it (`lib-multisrc/iken`), and thirteen sites use it, including
`vortexscans.org`, `magustoon.org`, `kencomics.com` and `eternalmangas.org`.

That matters twice over. It is where the `/api/post`, `/api/chapter` and `/api/genres` endpoints
below came from — none is linked or referenced anywhere in the site's own client bundles, and
direct probing had not found them. And it means this extension is most of the way to any of the
other twelve: the API contract is the platform's, not HiveToons'.

## Transport

- **Astro, server-rendered.** Build assets live under `/_vcomics/`, not the usual `_astro/`.
  Responses carry `x-astro-cache` and `x-vastro-proxy-cache` headers.
- Cloudflare fronts every response (`server: cloudflare`, `cf-ray`) but **does not challenge**. A
  plain `GET` with an ordinary user-agent returns `200` and complete HTML. No
  `CLOUDFLARE_BYPASS_PROVIDING`, no `executeInWebView`, no cookie handling.
- `storage.hivetoon.com` serves covers and page images with **no hotlink protection**. Verified
  `200` with no `Referer`, with a foreign one, and with no user-agent at all. The interceptor sets
  a user-agent for consistency with the rest of the repo, not because the site needs it.
- Two hosts answer the API with identical payloads: `hivetoons.org/api/*` and
  `api.hivetoons.org/api/*`. **`/api/chapters` exists only on `api.hivetoons.org`** — the main host
  `404`s it. `/api/query` works on both.
- The catalog is small and the origin is fast: all 313 series in 4 requests in 1.8s, with no
  throttling and no rate-limit responses.

## Where the data lives

**Every read this extension makes is JSON, and all of it is on `api.hivetoons.org`.** The main
host serves only `/api/query`; it `404`s every other endpoint below.

| Data                         | Endpoint                  | Size           |
| ---------------------------- | ------------------------- | -------------- |
| Catalog, search, discover    | `/api/query`              | ~90 KB per 100 |
| Genre catalog                | `/api/genres`             | 3.4 KB         |
| Series detail                | `/api/post?postId=`       | 4.3 KB         |
| Chapter list                 | `/api/chapters?postId=`   | up to 400 KB   |
| Chapter images or novel text | `/api/chapter?chapterId=` | ~12 KB         |

Everything is keyed by **numeric id**, which is what lets the extension key series and chapters by
id and never handle a slug — see [trap 1](#1-slugs-violate-the-bridges-id-charset).

### The HTML is a fallback nobody needs

The site is Astro, server-rendered, and every screen embeds its data as HTML-escaped JSON in
`<astro-island props="…">` — the same tuple encoding Asura Scans uses, `[0, value]` / `[1, array]`
and a bare `[0]` meaning `undefined`
(see `docs/AsuraScans/site-architecture.md#prop-encoding`).

That route works and was the original implementation here. It was **replaced entirely** by the API,
because the same series record costs 4.3 KB from `/api/post` and about **1 MB** on the page that
embeds it, and a chapter costs 12 KB against roughly 300 KB. Two hazards went with it: islands on a
page share prop names (`ChapterNavigationDropdownIsland` and `NovelBody` both carry `chapter`, the
dropdown first; `SeriesChaptersPanelIsland` and `SeriesDescriptionIsland` both carry `post`), so
they can only be told apart by inspecting the nested value.

Recorded because it is a genuine fallback if the API is ever locked down, not because anything
still uses it.

## `GET /api/query`

Returns `{ posts[], totalCount, searchTerm }`. Parameters, recovered from the site's own archive
bundle (`/_vcomics/CondfQIq.js`) and each confirmed against the live endpoint:

| Parameter                       | Notes                                                                       |
| ------------------------------- | --------------------------------------------------------------------------- |
| `page`                          | 1-based                                                                     |
| `perPage`                       | **capped at 100** — `120` and `200` both return 100                         |
| `view`                          | only `archive` and `manage` exist; `archive` is the public one              |
| `searchTerm`                    | see [the stopword trap](#3-a-stopword-only-query-returns-the-whole-catalog) |
| `genreIds`                      | comma-separated genre ids to include                                        |
| `excludedGenreIds`              | comma-separated genre ids to exclude                                        |
| `seriesType`                    | `MANHWA`, `MANHUA`, `MANGA`, `NOVEL`                                        |
| `seriesStatus`                  | `ONGOING`, `COMPLETED`, `HIATUS`, `DROPPED`                                 |
| `orderBy`                       | `totalViews`, `createdAt`, `postTitle`, `updatedAt`, `lastChapterAddedAt`   |
| `orderDirection`                | `asc`, `desc`                                                               |
| `minChapters`, `maxChapters`    | integers                                                                    |
| `createdAfter`, `createdBefore` | dates                                                                       |
| `saleFilter`                    | accepted; its values were not enumerated                                    |

Both enum lists above are the **complete** distribution over all 313 titles, not a sample:
`MANHWA` 304, `NOVEL` 7, `MANHUA` 1, `MANGA` 1; `ONGOING` 299, `COMPLETED` 7, `HIATUS` 5,
`DROPPED` 2.

Each post carries `id`, `slug`, `postTitle`, `featuredImage`, `seriesType`, `seriesStatus`, `hot`,
`isPinned`, `saleActive`, `salePercentage`, `saleEndDate`, `genres[]`, `chapters[]` (the newest
few) and `averageRating`. It does **not** carry the synopsis, alternative titles or artist — those
need the series page.

The genre catalog is 89 entries, exposed on the `/series` page's `ArchivesPostListIsland` under
`genres`. Ids are not contiguous (they run 1–79, then scattered up to 1235).

## `GET /api/genres`

A flat list of `{ id, name }`, 89 entries, 3.4 KB. The ids are what every genre filter sends. Read
live rather than hardcoded — a stale copy silently drops whatever the site has added since.

## `GET /api/post`

`?postId=<id>` (also accepts `?postSlug=<slug>`; `?id=` is a `400`) returns
`{ post, firstChapter, lastChapter, totalChapterCount }`.

`post` is the complete series record — `postTitle`, `postContent`, `alternativeTitles`, `artist`,
`author`, `studio`, `seriesStatus`, `genres[]`, `averageRating`, `featuredImage`, `banner`, `slug`,
and **`isNovel` as a plain boolean**, which is more direct than inferring it from `seriesType`.

`averageRating` is on a **0-10** scale, where the app renders `MangaInfo.rating` as a 0-1 fraction.
Sending it through unscaled displays as several hundred percent — the mistake Comix and
FreeWebNovel both shipped.

## `GET /api/chapter`

`?chapterId=<numeric id>` returns `{ chapter, nextChapter, previousChapter }`.

`chapter.images[]` holds a comic's pages as `{ url, width, height, order }`, and `chapter.content`
holds a novel's text as one HTML string; each is empty for the other kind. **Sort by `order`** —
the array has arrived sorted so far, but a silently misordered page list is not something a reader
would report clearly.

This endpoint's `isLocked` / `isAccessible` are accurate, unlike the list endpoint's — see
[trap 2](#2-price-is-the-accessibility-signal-not-islocked-or-isaccessible). It serves no images and
no content for a chapter it will not release, so the paywall is enforced server-side.

## `GET api.hivetoons.org/api/chapters`

`?postId=<id>&skip=0&take=all&order=desc` returns `{ post: { chapters[] }, totalChapterCount }`.

**`take=all` returns the complete list in a single call** — verified at 627 chapters / 403 KB for
Lookism. There is no pagination to walk, which is what makes `getChapters` cheap here.

Each chapter carries `id`, `slug` (`chapter-621`), `number` (numeric, supports decimals), `title`,
`price`, `unlockAt`, `isPermanentlyLocked`, `isShortLinkLocked`, `createdAt`, `isLocked`,
`isAccessible`, and a nested `mangaPost` with `postTitle`, `slug` and `featuredImage`.

That nested `mangaPost.slug` is why **`take=1` (752 bytes) is a cheap id → slug lookup**, which is
how this extension recovers a series' URL slug from its numeric id on a cold start.

An unknown `postId` returns `404`.

## Chapter pages, on the site itself

Recorded alongside the HTML fallback above, not used. Comic pages are fully server-rendered as one
`<img data-reader-page-image data-reader-index="N">` per page, contiguous `0..N-1`, with no
lazy-load truncation and no "load more" — verified across chapters of 92, 57 and 9 pages. There is
no image scrambling; the bytes served are the bytes displayed. Novel chapters carry no reader
images, only the `NovelBody` island noted above.

`storage.hivetoon.com` has no hotlink protection either way, so the image URLs the API returns are
directly usable.

## Traps

### 1. Slugs violate the bridge's ID charset

Real slugs on this site include `debut-or-die!-(novel)` and `swordmanship-veteran's-game-stream`.
`!` and `'` are outside the charset the Swift bridge validates IDs against — alphanumeric or only
`._-@()[]%?#+=/&:`, per `docs/paperback/forms.md`. A slug used as a `mangaId` therefore throws on
device while passing every local test.

**This extension keys series by the numeric post `id`.** That is also stable across a slug rename,
and unique across comics and novels, which is why no `novel:` namespace prefix is needed here
(unlike Asura Scans, where the two catalogs could collide on a shared slug).

### 2. `price` is the accessibility signal, not `isLocked` or `isAccessible`

Those two flags are session-relative and, for an anonymous client, actively misleading. A chapter
reporting `price: 100`, `isLocked: false`, `isAccessible: true` served **zero** page images:

| Chapter      | `price` | `isLocked` | `isAccessible` | Pages served |
| ------------ | ------- | ---------- | -------------- | ------------ |
| `chapter-63` | 0       | false      | true           | 10           |
| `chapter-32` | 0       | false      | true           | 10           |
| `chapter-70` | 100     | false      | true           | **0**        |

**On the list endpoint, `price === 0` is the only reliable signal.** Same family as the "locked
chapter returns 200 with empty content" trap in `docs/AsuraScans/site-architecture.md`. 8 of 313
titles gate their newest chapters this way; `unlockAt` gives the date a timed one becomes free.

The single-chapter endpoint is different: `/api/chapter` reports `isLocked: true`,
`isLockedByCoins: true` and `isAccessible: false` for exactly the chapter the list endpoint claimed
was accessible. The flags are only untrustworthy in the bulk listing.

### 3. The search silently falls back to the whole catalog

`searchTerm=the`, `and`, `of`, `a`, and any purely non-Latin term return **all 313 titles** in
default order — the origin's full-text search reduces them to an empty query and then drops the
filter rather than matching nothing. Only 42 of the first 100 results for `the` contain it.

This is **not** edge caching: `cf-cache-status: DYNAMIC`, and a cache-busting parameter does not
change it. Terms of two characters and up otherwise filter correctly (`lo` → 29, `loo` → 3,
`look` → 2).

**The echoed `searchTerm` cannot be used to detect this.** Across three consecutive probes of the
identical `searchTerm=the` request it came back as `null`, as `"the"`, and once as `"전지적"` — a
_different_ query's term. It reflects some shared state on the origin, not what was applied.

The extension therefore checks the results instead: a post is kept when every word of the query
appears in its title. Which leads directly to the next trap.

### 3a. The origin searches alternative titles, and the catalog response does not include them

A title-only check would be wrong on its own, because the origin's search reaches fields the
archive projection never returns. Verified live:

| Query                            | Finds                        | Matches the visible title? |
| -------------------------------- | ---------------------------- | -------------------------- |
| `True Education`                 | Get Schooled                 | no                         |
| `Surviving as a Trashy PD Idol`  | The Trashy PD Has To Survive | no                         |
| `El misterio del pueblo Gwichon` | The Gwichon Village Mystery  | no                         |

So a result set where _nothing_ matches the title is the signature of a genuine alternative-title
hit, not of a collapse — a collapse returns the whole catalog, most of which matches nothing. The
extension keeps the origin's own answer whenever its filter would empty the list.

### 4. `orderBy=chaptersCount` ignores `perPage`

It is a valid ordering, but the response is not paginated — `perPage=3` returned ~195 items. Not
used by this extension.

### 5. `orderBy=averageRating` is not valid

It silently falls back to the default ordering (`lastChapterAddedAt`) rather than erroring, so
there is no rating sort to offer, even though `averageRating` is returned on every post. The same
silent fallback applies to any unrecognised `orderBy`, which is what makes an invalid value hard
to notice.

## Not covered

- **Accounts, coins and the store.** The site has all three (`/auth/signin`, `/redeem`,
  `store.hivetoon.com`, `/api/user/balance`). This extension is anonymous-only; unlocking paid
  chapters would need a WebView auth capture like Asura Scans'.
- **`saleFilter` values.** The parameter is accepted and 8 titles are on sale, but the permitted
  values were not determined.
- **`api.hivetoons.org` as a failover** for `/api/query`. Both hosts answer it identically today;
  no fallback is wired because the main host has not been seen to fail.
