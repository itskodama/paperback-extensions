# NovelArchive site recon

Feasibility notes for a Paperback extension for `novelarchive.cc` ("Novel Archive"). Everything here
was verified with `curl` against the live site on 2026-07-13/14.

## What it is

An aggregator of web-novel translations (fan translations of Chinese/Korean/Japanese web novels,
plus original English web serials like _Shadow Slave_) — ~26,000 novels at last count. Several
titles are pulled from more than one upstream source (`GET /api/novels/<id>/sources`); the default
per-novel endpoints transparently serve one merged/default source, and multi-source selection is not
exposed anywhere in the site's own frontend beyond that.

## Transport

- **A first-party JSON REST API**, not markup to scrape. The frontend (`assets/js/api.js`) is a thin
  `fetch` wrapper over `/api/*`; the server-rendered HTML is empty containers the JS fills in. This
  means **no HTML parser, no JSON-LD digging, no structured-data-in-markup tricks** — just JSON in,
  JSON out. `apiBase` is same-origin (`/api`), declared in `/config.js`.
- Cloudflare fronts it (`server: cloudflare`) but does **not** challenge plain requests — every
  endpoint tested returned `200`/`404` directly to a bare `curl` with a browser UA, no
  `CLOUDFLARE_BYPASS_PROVIDING` needed. The `challenge.xewdy.systems` script on the page is not
  invoked for reads.
- No auth required for anything a reader needs: browsing, novel details, chapter content, covers.
  Auth (`/api/auth/*`) exists only for account features (library, comments, ratings, downloads) —
  out of scope, matching this repo's established stance of not handling user credentials.
- **Rate limit is explicit and generous**: response headers carry `ratelimit-limit: 900`,
  `ratelimit-policy: 900;w=300` — 900 requests per 300 s (3 req/s). LNORI/AsuraScans run their
  limiters far under their sites' actual ceiling (20/10s, 15/10s); the same discipline here still
  leaves huge headroom.
- `robots.txt` sets `Content-Signal: search=yes,ai-train=no,use=reference` for `User-agent: *`
  (`Allow: /`), plus explicit `Disallow: /` for named AI/training crawlers (GPTBot, ClaudeBot,
  Google-Extended, etc.). Those disallows target crawlers harvesting training data; a reader
  extension fetching one novel's current chapter on a human's behalf, identified with a normal
  browser UA, is the same class of client the frontend's own JS already is — not one of the named
  bots. Worth a mention if the user wants a second opinion, not a blocker.

## Structure — the endpoints that matter

All under `https://novelarchive.cc/api`, all JSON, no auth:

| Endpoint                                                                                         | Returns                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /novels?search=&genres_include=&genres_exclude=&genre_match=&sort=&status=&page=&per_page=` | Paginated novel list — this one endpoint **is** both search and browse                                                                                                                |
| `GET /novels/trending?limit=`                                                                    | Trending list                                                                                                                                                                         |
| `GET /novels/editors-choice?limit=`                                                              | Editor's picks                                                                                                                                                                        |
| `GET /novels/recent?limit=` / `/recently-updated`                                                | New / recently-updated lists                                                                                                                                                          |
| `GET /novels/genres`                                                                             | `{value, label}` list — the full genre vocabulary (~200 tags)                                                                                                                         |
| `GET /novels/<id>`                                                                               | Full novel detail, **including `chapter_names: string[]`** — the ordered chapter titles for the whole novel in one call                                                               |
| `GET /novels/<id>/chapters/<n>`                                                                  | One chapter's `{number, name, content}` — `content` is **plain text**, paragraphs newline-separated (single `\n` on some novels, `\n\n` on others — split on `\n+`, don't assume one) |
| `GET /novels/<id>/cover?w=&q=&format=webp`                                                       | Cover image, no referer required                                                                                                                                                      |
| `GET /novels/<id>/sources` / `/source-list`                                                      | Alternate upstream sources for a novel (unused by MVP — see below)                                                                                                                    |

Errors are clean JSON with correct status codes: `{"error": "Novel not found"}` / `404`,
`{"error": "Chapter does not exist"}` / `404`. No silent empty-200s observed.

## Mapping onto Paperback

- `contentType: 'novel'`; `ChapterDetails` uses the **`html` variant**
  ([html-chapters.md](../paperback/html-chapters.md)) — wrap each `content` paragraph in `<p>`
  inside a full `xmlns="http://www.w3.org/1999/xhtml"` document, escaping `&`/`<`/`>` (none observed
  in sampled chapters, but don't assume that holds for all 26k novels).
- **Chapter list needs zero extra requests.** `chapter_names` on the novel-detail response already
  gives the complete ordered title list; `chapNum` is just the 1-based index, `chapterId` is
  `<novelId>#<n>`. This is a meaningfully cheaper shape than LNORI's one-fetch-per-volume TOC.
- No per-chapter publish date is exposed anywhere (`latest_release` on the novel is frequently the
  literal string `"Unknown"`) — omit `Chapter.publishDate` rather than fabricate one.
- Discover sections map close to 1:1 onto existing endpoints: `trending` → Popular,
  `editors-choice` → Editor's Choice, `recently-updated` → Latest Updates, `genres` → chip row. No
  homepage HTML scraping needed at all (contrast LNORI, which reads its featured/seasonal carousels
  off rendered markup).
- Search: `query.title` → `search` param; `fuzzy=1` by default matches the site's own behaviour.
  Sort (`recent`/`popular`/`rating`/`chapters`) and status (`all`/`ongoing`/`completed`/`hiatus`)
  are enumerable `SortingOption`s / filter chips. Multi-select genre include/exclude with an
  all/any match mode is richer than LNORI's single genre and is the one place a real
  `AdvancedSearchForm` would earn its device-only risk — worth deciding scope for v1 vs. later
  (see [search.md](../paperback/search.md#filters-without-a-form): genre chips in a discover
  section can carry filter metadata without a form at all, which is the lower-risk starting point).
- **Multi-source novels are a non-issue for a v1**: the default `/chapters/<n>` endpoint always
  resolves to one canonical source regardless of how many exist, and the site's own primary reading
  flow never exposes source choice either. Skip `/sources` entirely unless a later version wants
  per-source chapter switching.

## Risks

- **Aggregator, not original host** — the underlying failure mode is closer to AsuraScans (an
  origin that can reshape its API at will) than LNORI (a static CDN unlikely to move). The API
  contract (not markup) is the surface to watch; a hosted JSON API is far less prone to incidental
  drift than scraped HTML, but a breaking API version bump is still possible without notice.
- Total catalog is ~26,000 novels / ~8,700 pages at the site's own default page size — fine for
  server-side search/browse (the API does the filtering), but confirms client-side full-catalog
  caching (LNORI's `getLibrary()` pattern) is the wrong model here; every list-producing method
  should hit `/novels` directly with its own query rather than trying to cache-and-filter locally.
- `content` field pattern differs by source-of-origin per novel (`\n` vs `\n\n` paragraph breaks
  observed across two sampled novels) — the XHTML transform must split on one-or-more newlines, not
  a fixed delimiter.

## The linchpin — device verification

Same as every `html`-chapter extension: whether the on-device XHTML reader renders these
chapters acceptably is unverifiable locally. Probe with a stub extension returning one hardcoded
chapter before building the rest, per [testing.md](../paperback/testing.md#device-verification).
