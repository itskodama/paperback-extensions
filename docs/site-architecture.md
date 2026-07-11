# Asura Scans site architecture

Reference for how `asurascans.com` serves its data, and how this extension maps that onto
Paperback's types. Everything here was verified against the live site on 2026-07-09.

Re-verify with `curl` before trusting any of it — the site is not versioned and gives no
deprecation warnings. The hourly `test.yaml` workflow exists to catch drift.

## Transport

- Astro v5.16.8, server-rendered. Not Next.js: there is no `__NEXT_DATA__` and no RSC payload.
- Cloudflare fronts every response (`server: cloudflare`, `cf-ray`), but does **not** challenge.
  A plain `GET` with an ordinary user-agent returns `200` and complete HTML.
  No `CLOUDFLARE_BYPASS_PROVIDING`, no `executeInWebView`, no cookie handling.
- `cdn.asurascans.com` serves page images with **no hotlink protection**. Verified `200` with no
  `Referer` and with a foreign one. The interceptor sets a user-agent; it does not need a referer.
- `api.asurascans.com` appears only as a `preconnect` hint. It backs client-side auth and
  promotion calls, its root `404`s, and nothing this extension needs touches it.

## Where the data lives

Astro hydrates client components by embedding their props in the markup:

```html
<astro-island ... props='{"seriesId":[0,1931], ...}'></astro-island>
```

The `props` attribute is HTML-escaped JSON. Because it is escaped, it can never contain a raw
double quote, so `props="([^"]*)"` extracts it safely without an HTML parser. **This extension
therefore has no HTML-parsing dependency** — see `astro.ts`.

Discriminate islands by which prop keys they carry, not by CSS classes or document order. The
site is Tailwind-based and its class names change with every redesign; the prop keys track the
actual data model.

### Prop encoding

Each prop value is a `[typeTag, payload]` tuple. Tags observed in the wild:

| Tag | Meaning                                                                                  |
| --- | ---------------------------------------------------------------------------------------- |
| `0` | Plain value. Object and array payloads contain further tuples and must be recursed into. |
| `1` | Array. Payload is a list of tuples.                                                      |
| `3` | Date, as an ISO string payload.                                                          |

A **bare single-element `[0]` means `undefined`**, not the number zero. It occurs on real fields —
`chapterTitle`, `viewCount`, `userRating`, `minChapters`. Treating it as a value writes the literal
array into chapter titles.

Also note `title` is genuinely `null` on many chapters. That is distinct from the `[0]` marker.

## Identifiers

`mangaId` is the **series slug**. It is the only identifier present in every payload: browse
results expose `slug`, trending exposes `slug`, and the latest-updates feed exposes `comic_slug`
but no numeric series id.

Series pages also carry a numeric `seriesId`, and `/s/<seriesId>` is a stable permalink that
redirects to the canonical URL. That is more rename-proof, but it cannot be recovered from the
latest-updates feed, so it is unusable as a universal `mangaId`.

Two traps:

- `slug` is not the URL path. `public_url` is. The canonical path carries a suffix
  (`/comics/<slug>-a80d257e`), and that suffix is **identical across every series** — it is a
  constant, not a per-series hash. Do not reconstruct URLs by concatenating it.
- Requesting the bare `/comics/<slug>` returns `302` to the canonical URL. Following that redirect
  is how this extension resolves a slug without depending on the suffix.

`chapterId` is the chapter `number`. Do not use the chapter `slug`: the series page reports
`"chapter-190"` while the same chapter's `nextChapter.slug` reports a UUID.

## Endpoints

| Purpose            | Request                                                              | Island keys                                |
| ------------------ | -------------------------------------------------------------------- | ------------------------------------------ |
| Discover           | `GET /`                                                              | `items`, `chapters`                        |
| Search             | `GET /browse?search=<q>&page=<n>`                                    | `initialSeries`, `initialTotalPages`       |
| Filtered browse    | `GET /browse?genres=&status=&type=&sort=&order=&min_chapters=&page=` | as above                                   |
| Details + chapters | `GET /comics/<slug>` (follow `302`)                                  | `title`+`seriesId`, `chapters`+`publicUrl` |
| Chapter pages      | `GET <publicUrl>/chapter/<number>`                                   | `pages`, `chapterId`                       |

`/s/<seriesId>/chapter/<n>` does **not** work — the permalink only resolves the series root.

### Series page

Two islands. The details island carries `title`, `description`, `alternativeTitles`, `coverUrl`,
`rating`, `status`, `type`, `author`, `artist`, `genres[{id,name,slug}]`, `chapterCount`,
`seriesId`. The chapters island carries `publicUrl` and **every** chapter — no pagination.

- `description` is raw HTML with Tailwind classes. Strip tags and decode entities for the synopsis.
- `alternativeTitles` is one string joined with `•`, not an array. Split it for `secondaryTitles`.
- `rating` is on a 0–10 scale. Paperback's `MangaInfo.rating` is an undocumented bare `number`, but
  the app renders it as a percentage, so it expects a 0–1 fraction. Asura's value is divided by ten.
  Passing it through unchanged renders a 9.22 rating as 922%.

### Chapter page

One island: `pages[{url,width,height}]`, `chapterId`, `chapterNumber`, `isLocked`, `isPremium`,
`unlockTime`, `prevChapter`, `nextChapter`, and a redundant full `chapterList`.

Asura has no volumes. Leaving `Chapter.volume` unset makes Paperback label every chapter
`Vol. TBA`, so chapters are built with `volume: 0`, which is what other published extensions do for
volumeless sources.

### Locked chapters

A locked chapter returns **`200`, not `403` or `404`**, with `isLocked: true`, an `unlockTime`, and
an **empty `pages` array**. A naive implementation returns a chapter with zero pages and the reader
shows a silently blank chapter with no error.

`getChapterDetails` must check `isLocked` explicitly and throw. On the series page,
`early_access_until` is the unlock timestamp: it is in the past for readable chapters and in the
future for locked ones. Locked chapters stay listed; only opening one raises an error.

`is_locked` is a proper boolean on the series page but comes back `null` inside browse's
`latest_chapters`. Do not trust it there.

## Browse parameters

The browse island exposes `initialSeries`, `initialCurrentPage`, `initialTotalPages`, `totalCount`,
and `availableGenres`. Pagination is 20 per page.

| Param          | Values                                                     |
| -------------- | ---------------------------------------------------------- |
| `search`       | free text                                                  |
| `genres`       | comma-separated slugs                                      |
| `status`       | `all`, `ongoing`, `completed`, `hiatus`, `dropped`, `axed` |
| `type`         | `all`, `manhwa`, `manhua`, `manga`                         |
| `sort`         | `update`, `popular`, `rating`, `newest`, `name`            |
| `order`        | `asc`, `desc`                                              |
| `min_chapters` | integer                                                    |
| `page`         | 1-based                                                    |

Two things that will bite:

**`sort` selects the field and `order` selects the direction** — the opposite of what the island's
own `initialOrder` / `initialSortDirection` prop names suggest. Verified by observing that
`?sort=rating&order=asc` returns ascending ratings.

**Multiple genres are OR'd, not AND'd.** Measured: `action` returns 310 titles, `romance` returns
12, and `action,romance` returns 318. An intersection would have capped at 12. The advanced search
form presents genres as "any of these" for this reason.

Genre ids are non-contiguous (`1, 4, 7, 9, 12, 76, 14, …`). Map by `slug`, never by index. There
are 31 genres and **none of them is an adult or mature category**; the strongest signals are
Violence, Demon, and Tragedy. The extension declares `ContentRating.MATURE`.

## Homepage sections

Several islands share the `items` key, so a section is identified by a field its _entries_ carry
rather than by the island key alone:

| Section        | Island     | Entry marker            | Notes                                              |
| -------------- | ---------- | ----------------------- | -------------------------------------------------- |
| Trending       | `items`    | `is_featured`           | 30 entries                                         |
| Latest Updates | `chapters` | `comic_slug`            | ~298 entries across ~100 series                    |
| Popular        | `items`    | `latest_chapter_number` | 10 entries; two such islands exist, take the first |

`banner_url` is a poor marker for Trending: it is present but empty on roughly a third of entries,
so the image falls back to `cover_url`.

A third `items` island holds a single entry whose `public_url` points at `/novels/`. It carries
neither marker, so it is skipped. No novel chapters appear in the updates feed.

### The latest updates feed

This feed is one entry **per chapter**, not per series, and it needs reshaping before it can back a
`chapterUpdates` carousel. Two things about its ordering are easy to miss.

**It is grouped by series, not sorted by publish time.** A series contributes up to three
consecutive entries, one per recent chapter, so the same title appears three rows in a row at
chapters 114, 113, and 112. Roughly 298 entries cover roughly 100 series. Deduplicating by
`comic_slug` collapses each run to its newest chapter.

**One entry is pinned to the top.** Exactly one carries `is_pinned: true`, and it is not
necessarily recent — an entry published three days before the true newest chapter has been observed
leading the feed. On every other entry `is_pinned` is the `[0]` undefined marker, not `false`.

Together these mean first-occurrence order is not publish order. Sort by `published_at` descending
first, then deduplicate by `comic_slug` keeping the first of each. That yields one row per series,
newest chapter first, and drops the pinned entry to its rightful position.

The feed carries `comic_slug` and `comic_cover` but **no series id**, which is what forces `mangaId`
to be the slug. Its entries also expose `is_premium` and `early_access_until`.
