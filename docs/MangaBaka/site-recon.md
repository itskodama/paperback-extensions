# MangaBaka site recon

Feasibility notes for a Paperback **tracker** extension for `mangabaka.org`. Everything here was
verified with `curl` against the live API on 2026-08-12 unless explicitly marked otherwise.

Unlike every other extension in this repo, this one serves **no chapters**. It declares
`PROGRESS_PROVIDING` and syncs the user's read progress to their MangaBaka account. The relevant
platform docs are [extension-structure.md](../paperback/extension-structure.md) (the capability →
interface table), [forms.md](../paperback/forms.md), and [bridge.md](../paperback/bridge.md) — not
[chapters.md](../paperback/chapters.md) or [html-chapters.md](../paperback/html-chapters.md).

## What it is

A manga/light-novel metadata database **and** personal tracker. It aggregates and normalises AniList,
MyAnimeList, MangaUpdates, Kitsu, Anime-Planet, Shikimori and Anime News Network, and — unusually —
exposes the cross-IDs back to all seven on every series (`source` object, verified present on
`/v1/series/1677`). That aggregator role is what distinguishes it from the AniList/MAL trackers
already in the Paperback ecosystem; `CLAUDE.md`'s standing "another anime/manga tracker adds little"
rejection does not apply.

The per-user library is a full tracker surface: seven states (`considering`, `completed`, `dropped`,
`paused`, `plan_to_read`, `reading`, `rereading`), a 0–100 rating, chapter **and** volume progress,
start/finish dates, reread count, a private flag, notes, priority, and custom lists.

**It indexes novels as first-class entries** (`type: "novel"`, e.g. id `83072` "Chainsaw Man: Buddy
Stories"). Three of this repo's four existing extensions are novel sources, so novels are
deliberately **not** filtered out, even though the search API offers `type_not=novel`.

## Transport

- **A documented first-party JSON REST API.** No GraphQL, no markup to scrape, no HTML parser.
  OpenAPI 3.1 spec at `https://mangabaka.org/api.json` (479,456 bytes, `200`); human docs at
  `https://mangabaka.org/data/api`.
- **API host is `https://api.mangabaka.org`**, not `mangabaka.dev`. `mangabaka.dev` is asset
  subdomains (`images.`, `cdn.`) and is Cloudflare-challenged; the API host is **not** — plain
  `curl` with a default _or empty_ User-Agent returns `200`. No `CLOUDFLARE_BYPASS_PROVIDING`, no
  header gymnastics, no UA spoofing needed. (Contrast CopyManga's hard app-version gate.)
- **Envelope**, uniform on success and error: `{ status, data?, message?, pagination? }`. `status`
  mirrors the HTTP code; `message` is documented as safe to show end-users. One `unwrapEnvelope`
  helper handles everything, same shape as `src/AsuraScans/network.ts`.
- **Versioned paths**: `/v0` (internal/unstable), `/v1` (stable), `/v2` (beta). Responses carry
  `x-api-version: v1` and `x-api-stability: stable` headers — both observed live.
- CORS is reflective (`access-control-allow-origin` echoes the `Origin` sent).

### Rate limits

Two published buckets, both IP + leaky bucket, quoted from `https://mangabaka.org/data/api`:

| Kind    | Method | Path             | Limit                 |
| ------- | ------ | ---------------- | --------------------- |
| Search  | `GET`  | `/series/search` | 30 requests / minute  |
| Default | `GET`  | `*`              | 180 requests / minute |
| Default | `*`    | `/my/*`          | 180 requests / minute |

Two consequences that shape the network layer:

- **"Rate Limiting is only applied to _uncached_ requests, so requesting `GET /v1/series/1` 10 times
  will only count as 1 request."** A local TTL cache therefore buys real quota, not just latency.
  Cache status is readable as `cf-cache-status: HIT`/`MISS`. Series detail advertises
  `cdn-cache-control: public, max-age=604800` (7 days) with `cache-control: public, max-age=60`.
- **There are no `X-RateLimit-*` headers to read.** Verified on an uncached request: only
  `x-api-stability`, `x-api-version`, `cf-cache-status`, `cache-control`, `cdn-cache-control`. So
  the extension must self-throttle blind; there is no server signal to back off against. Over-limit
  is `429 {"status":429,"message":"Too Many Requests"}` (spec; not triggered during recon).

`BasicRateLimiter` registers as a global interceptor and **cannot route by URL**, so it can only be
tuned to one bucket. The search bucket is 6× tighter than the default one, so tuning the limiter to
search would throttle library writes pointlessly. Use the limiter for the default bucket and gate
`/series/search` separately in code.

## Auth

**The current flow lives in [`auth.md`](auth.md).** This section keeps only the recon findings
that page does not repeat.

MangaBaka's auth layer is **[better-auth](https://better-auth.com)**, with the api-key plugin
enabled. Confirmed by probing the standard plugin routes unauthenticated:

| Endpoint                    | Unauth response                            | Meaning                          |
| --------------------------- | ------------------------------------------ | -------------------------------- |
| `GET  /auth/ok`             | `{"ok":true}`                              | better-auth confirmed            |
| `GET  /auth/get-session`    | `null` (200)                               | session endpoint                 |
| `POST /auth/api-key/create` | `401 {"code":"UNAUTHORIZED_SESSION"}`      | **exists; needs only a session** |
| `GET  /auth/api-key/list`   | `401 {"code":"UNAUTHORIZED"}`              | keys are listable                |
| `POST /auth/sign-in/email`  | `401 {"code":"INVALID_EMAIL_OR_PASSWORD"}` | email/password accepted          |

The API accepts either a PAT (`x-api-key: mb-…`) or an OAuth token (`Authorization: Bearer`).
Unauthenticated `/v1/my/*` returns `401 {"message":"No session found"}`; a _bad_ bearer returns
`401 {"message":"BAD_REQUEST: Invalid access token"}`. Those two messages are worth distinguishing
in error handling — they separate "no credential arrived" from "the credential is bad".

**The WebView cannot be pre-authenticated — settled, do not retry.** `WebViewRow` carries cookies
only _outward_, via `onComplete`. Setting a `cookie` request header was tried on device and does not
seed the web view's jar: `/my/settings` still landed on the login page, now behind a Cloudflare
check as well. `CookieStorageInterceptor` does not help either — it is a `PaperbackInterceptor`, so
it only decorates `scheduleRequest` traffic, not the native web view. `Application.executeInWebView`
does take `storage.cookies`, but it is headless and cannot present an interactive page. So any
"open the site" row costs a fresh sign-in; the row points at `/auth?redirect_to=/my/settings` so
that sign-in at least lands on the right page.

Why OAuth over the alternatives:

- **vs. a minted PAT** — the session cookie needed to mint one also reaches `/auth/update-user`,
  `/auth/change-email` and `/auth/change-password`. An OAuth token is confined to the library, and
  its blast radius is smaller if leaked. The original argument for the PAT — "a
  minted key never expires, so there is no refresh path" — was also wrong; keys do lapse.
- **vs. asking the user to paste a key** — a worse version of the same outcome.
- **vs. using the session cookie directly** — cookies expire, cannot be refreshed programmatically,
  and would need re-login on a schedule.

## Structure — the endpoints that matter

All under `https://api.mangabaka.org`.

### Public (no auth)

| Endpoint                                                                           | Returns                                                           |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET /v1/series/search?q=&page=&limit=&sort_by=&…`                                 | Paginated search **and** browse — returns **full series objects** |
| `GET /v1/series/match?q=&limit=`                                                   | Exact compact-title match; returns nothing rather than guessing   |
| `GET /v1/series/{id}` · `/v2/series/{id}`                                          | Full series detail                                                |
| `GET /v1/series/batch?id=&id=`                                                     | Up to 50 ids per call                                             |
| `GET /v2/series/discover/rising` · `/hidden-gems`                                  | Curated discover feeds                                            |
| `GET /v1/genres`                                                                   | **46** `{label, value}` pairs — the whole genre vocabulary        |
| `GET /v1/tags`                                                                     | **2,685** hierarchical tags (see below)                           |
| `GET /v1/source/{anilist\|kitsu\|manga-updates\|my-anime-list\|anime-planet}/{id}` | Cross-source lookup → `data.series` (an **array**)                |

Search params (all optional, **≥1 required**): `q`, `type`, `type_not`, `status`, `status_not`,
`content_rating`, `not_content_rating`, `genre`, `genre_not`, `tag`, `tag_not`, `tag_mode` (`and|or`),
`publisher`, `staff`, `year_lower`/`year_upper`, `rating_lower`/`rating_upper`, `is_licensed`,
`page` (default 1), `limit` (default 10), and ~20 `sort_by` values (`relevance_desc` default,
`name_*`, `score_*`, `popularity_*`, `chapters_*`, `volumes_*`, `published_*`, `trending_7d`,
`trending_30d`, `latest`, `random`).

**Verified: `sort_by` alone satisfies the "≥1 param" rule** — `?sort_by=trending_7d&limit=1` returns
`200`. So the discover sections need no dummy query. `/v2/series/discover/rising` likewise returns
full series objects directly.

Pagination is a root `pagination: {count, next, previous, page, limit}`.

### Library / tracker (auth required)

| Method          | Endpoint                             | Use                                               |
| --------------- | ------------------------------------ | ------------------------------------------------- |
| `GET`           | `/v1/my/profile`                     | Validate key; `id`, `nickname`, `rating_steps`    |
| `GET`           | `/v1/my/library/{series_id}`         | Read one entry — **`404` = not in library**       |
| `POST`          | `/v1/my/library/{series_id}`         | Create (`201`, body `{"status":201,"data":true}`) |
| `PUT` / `PATCH` | `/v1/my/library/{series_id}`         | Update; both accept partial bodies                |
| `DELETE`        | `/v1/my/library/{series_id}`         | Remove                                            |
| `GET`           | `/v2/my/library?state=&page=&limit=` | List — v2 items embed `{entry, lists, series}`    |
| `GET`           | `/v1/my/library/batch?series_id=…`   | Up to 100 ids                                     |
| `POST`          | `/v1/my/library/batch`               | Upsert ≤100, **atomic**, reports created/updated  |

Writable entry fields (`additionalProperties: false`): `state`, `rating` (0–100, nullable),
`progress_chapter` (0–10000), `progress_volume` (0–10000), `number_of_rereads` (0–1000),
`start_date` / `finish_date` (`YYYY-MM-DD` in, `…T00:00:00.000Z` out), `is_private`, `priority`
(10–30, default 20), `note`, `read_link`.

`GET /v1/my/library` additionally supports **`updated_after` / `updated_before`** (ISO 8601),
documented for incremental sync — the right tool if collection sync ever needs to be cheap.

All `/my/*` responses are `no-store`. **Never cache them locally** — stale progress is a correctness
bug, not a latency win.

## Data model

Series top-level keys, verified on `/v1/series/1677`:

```
id, state, merged_with, title, native_title, romanized_title, secondary_titles, cover,
authors, artists, description, year, published, status, is_licensed, has_anime, anime,
content_rating, type, rating, popularity, final_volume, total_chapters, links, links_v2,
publishers, titles, genres_v2, genres, tags_v2, tags, last_updated_at, relationships,
relationships_v2, source
```

Enums:

- `type`: `manga | novel | manhwa | manhua | oel | other`
- `status`: `cancelled | completed | hiatus | releasing | unknown | upcoming`
- `content_rating`: `safe | suggestive | erotica | pornographic` — the NSFW flag. Spec gloss: _"safe
  has no nudity or sex, suggestive can have nudity but no sex, erotica has sex but it's censored,
  pornographic has uncensored sex"_.
- `state`: `active | merged | deleted`.

Traps in this shape, all verified:

- **`total_chapters` and `final_volume` are _strings_**, and nullable — `'232'`, `'24'` on Chainsaw
  Man. Parse defensively; never arithmetic on them raw.
- **`title` / `native_title` / `romanized_title` are marked `deprecated` in the spec** in favour of
  `titles[]` (`{language, traits, title, note, is_primary}`). They still populate today; prefer
  `titles[]` and fall back.
- **`state: "merged"` means the id was retired** and `merged_with` names the survivor. The spec says
  _"You should update your system reference to the new ID"_. For a tracker this matters more than for
  a source: a stored link must self-heal by following the pointer, or it 404s forever.
- `cover` has four sizes: `raw` (`{url, size, height, width, blurhash, thumbhash, format}`) plus
  `x150`/`x250`/`x350`, each with `x1`/`x2`/`x3` DPI variants pointing at
  `cdn.mangabaka.dev/imgproxy/…`.
- `rating` is a float 0–100 (`84.62…`); library `rating` is an integer 0–100. `rating_steps` on the
  profile controls only display granularity, never the stored scale.

**Genres vs tags are different vocabularies and different sizes.** `/v1/genres` is 46 flat
`{label: "Boys Love", value: "boys_love"}` pairs. `/v1/tags` is **2,685** entries under 17 roots
(`Activities`, `Audience Demographics`, `Character Archetype`, `Character Traits`, `Character Types`,
`Derivative Work`, `Locations`, `Narrative Tropes`, …) with `{id, parent_id, name, name_path,
description, is_spoiler, is_genre, content_rating, series_count, level}`. Genres are form-sized;
the full tag tree is not — a filter UI should use genres, or top-level tag roots, not 2,685 chips.

### ID charset

[forms.md](../paperback/forms.md) requires every bridged id to match **alphanumeric or
`._-@()[]%?#+=/&:`**. Checked against MangaBaka's actual values:

- **Safe as-is**: genre `value` slugs (`boys_love`, `mahou_shoujo`) and library states
  (`plan_to_read`) — underscore is in the permitted set.
- **Not safe**: any human-readable `label`/`name` (`"Boys Love"`, `"Slice of Life"`, `"Arts &
Crafts"`) — spaces are illegal and have already caused two production crashes in this repo.

So always use `genre.value` / `tag.id` as the id and `label` / `name` as the title. This is the exact
mistake LightNovelWorld shipped.

## Mapping onto Paperback

- `type: "novel"` → `MangaInfo.contentType = "novel"`; everything else stays `"comic"`.
- `content_rating`: `safe` → `EVERYONE`, `suggestive` → `MATURE`, `erotica`/`pornographic` → `ADULT`.
- Covers: `cover.x250.x2` for search/carousel thumbnails, `cover.raw.url` for detail artwork.
- **Search returns full series objects**, so seed the detail cache from search results — the
  link-a-title flow then costs one request, not two. This is a materially better shape than AniList's
  (separate search and detail queries).
- `getMangaProgress` → `GET /v1/my/library/{id}`; `404` → return **`undefined`** (the typed contract
  for "not on the user's list"; do not throw). Synthesise the `Chapter` the way every tracker must:
  `{ chapterId: String(progress_chapter), sourceManga, langCode: "unknown",
chapNum: progress_chapter, volume: progress_volume }`.
- `processChapterReadActionQueue` **must never throw** (the interface doc says so). Collapse the
  queue to the highest `chapterNum` per manga and ACK the rest with no network call; never move
  remote progress backwards; `PATCH` to bump, `POST` on `404` to auto-add as `reading`.
- Managed collections map onto the seven states, read via `GET /v2/my/library?state=…` (v2 embeds
  the series, so one call per page instead of N). Unlike inkdex's AniList tracker — which throws on
  collection writes — writes are genuinely implementable here: `POST /v1/my/library/batch` is an
  atomic ≤100 upsert.
- No date-picker row exists in the 0.9 form catalogue, so `start_date`/`finish_date` should be
  auto-managed on state transitions rather than exposed as editable rows.
- Attribution: see [`terms.md`](terms.md#attribution).

## Risks

- **The `openid` scope is undocumented but mandatory.** The spec declares no per-endpoint scopes;
  without `openid` every `/v1/my/*` call 401s against an otherwise valid token. See
  [`auth.md`](auth.md#openid-is-required-not-cosmetic).
- **Beta `/v2` endpoints.** `/v2/my/library` and `/v2/series/discover/*` are marked beta and may
  change without the `/v1` stability promise. `/v1` equivalents exist for everything except the
  discover feeds; prefer `/v1` where behaviour is equal, and treat the discover sections as the
  parts most likely to need maintenance.
- **No rate-limit headers.** Self-throttling is blind — there is no server signal to adapt to, so the
  budget has to be conservative by construction.
- **Merged ids** silently retire series (`state: "merged"`). A tracker stores ids long-term, so this
  is a live concern, not theoretical.
- **`/my/*` cannot be cached**, so every progress read is a real request against the 180/min bucket.
  Collection sync over a large library is the one operation that could plausibly approach the limit —
  page it and use `updated_after` rather than full re-reads.

## The linchpin — device verification

Three things here are **device-only** surfaces the Node test runner cannot validate, and the default
`src/tests/` suite has **no** `PROGRESS_PROVIDING` coverage at all:

1. **The WebView cookie capture.** Whether `onComplete` delivers `Cookie[]` with a usable domain
   field, and whether those cookies authenticate `POST /auth/api-key/create`, is unverifiable
   locally. This is the linchpin — probe it before building anything else, the same way an
   `html`-chapter extension probes the reader first.
2. **The three forms** (settings, tracking, deletion) — id charset and `Application.Selector` wiring.
3. **`MangaProgress.userRating`'s expected scale.** MangaBaka stores 0–100; whether the app expects
   0–100 or 0–10 is not determinable from the type definitions, and the two shipped trackers use
   0–10 steppers. Confirm on device before trusting either.

Per [testing.md](../paperback/testing.md#device-verification), push to `0.9/dev` and **bump `version`
on every single push** — the app gates the whole refetch on a one-directional version comparison.
