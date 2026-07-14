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
  gives the complete ordered title list. This is a meaningfully cheaper shape than LNORI's
  one-fetch-per-volume TOC — but the numbering itself needs real work; see below.
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

## Chapter numbering — array position is not the fetch key

`chapter_names` looks like a simple 1-based list, and the obvious implementation (`chapterId =
String(index + 1)`) is wrong for a meaningful slice of the catalog. Found by testing specific
novels, not by reading docs — the API has no spec beyond what it does.

**`GET /novels/<id>/chapters/<n>` is keyed by each novel's own internal chapter number, which for
most novels equals array position exactly — but not always, and there is no field anywhere that
tells you which case you're in.** Two confirmed failure modes:

1. **Constant offset.** "An Archdemon's Dilemma: How to Love Your Elf Bride: Volume 15"
   (`6a55244d1402dd55bf114117`) has 19 entries, text-only `"Chapter 2"` through `"Chapter 20"` — the
   real "Chapter 1" was simply never imported. `chapter_names[0]` is `"Chapter 2"`, and only
   `/chapters/2` returns it; `/chapters/1` is `{"error": "Chapter does not exist"}`. Array index+1
   here is off by exactly one **for every entry**, forever.
2. **Drifting, unreliable embedded numbers.** "The Beginning After The End" (`69ffabdfa5f4c7d1b734e239`,
   532 chapters) is the opposite trap: `/chapters/<n>` **is** plain array position throughout
   (verified: `/chapters/517` returns array position 517's content, whose own title text reads
   `"Chapter 511: Folded Space"` — not whatever entry embeds the number 517), but 99% of its
   `chapter_names` entries still start with `"Chapter N"`, because the site's human-entered titles
   drifted from the real position due to source-side renumbering/splits over the story's history.
   Trusting the embedded number here silently fetches the wrong chapter's content. Sampling the
   implied offset (`embedded number − position`) across the whole array shows why this can't be
   fixed per-entry: it's scattered across `-1`/`-2`/`-3`/`-6` with no value above 54% agreement — a
   trust threshold has to look at the _whole array's_ consensus, not any single entry.
3. A third novel, "Re:Zero Kara Hajimeru Isekai Seikatsu" (`6a0c74d64f942c668d6981b1`, 675 chapters),
   is `/chapters/<n>` == array position throughout, and its `chapter_names` are almost entirely
   `"Arc N – M: Title"` / `"Volume N, M [Title]"` text with **no** leading "Chapter" — except two
   stray entries that happen to start with the literal word "Chapter" followed by an ARC-relative
   number wildly inconsistent with their real position (`"CHAPTER 112: …"` at real chapter 162,
   `"Chapter 47 […]"` at real chapter 231). A per-entry regex match with no whole-array sanity check
   would trust those two and corrupt everything downstream of them.

**The fix implemented in `parser.ts`** (`detectNumberingOffset`): parse a `"Chapter N"` prefix out of
every entry, then compute `offset = embeddedNumber − position` for every entry that matched. Only
trust a single consensus offset — and apply it uniformly to every entry, matched or not, as
`chapNum = position + offset` — when **both** hold across the whole array:

- at least half the entries produced a parseable number (rules out Re:Zero's two strays), and
- one offset value accounts for at least 90% of the entries that did match (rules out TBATE's
  drifting titles; Archdemon's Dilemma and every other clean novel sampled hit 100% agreement here).

Otherwise the offset defaults to `0` (plain array position) for the whole novel — which is exactly
what TBATE and Re:Zero need, and is the same safe default a totally unnumbered novel already needed.
`chapterId` and `chapNum` end up as the _same_ derived value (`position + offset`); there's no need
to keep them separate once the offset is known. The title only has the `"Chapter N"` prefix stripped
when the whole novel's numbering was trusted **and** that specific entry's parsed number matches the
resolved value — an entry whose number doesn't fit (or a novel with no trusted offset at all) keeps
its full original text as the title instead of a misleadingly-truncated fragment.

No amount of per-novel special-casing closes this fully; a novel with, say, a genuine trusted offset
_and_ one interior entry with a typo'd number is still a real possibility this hasn't been tested
against. The consensus-offset approach is a defensible default given what's actually been observed
across several novels, not a proof.

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
