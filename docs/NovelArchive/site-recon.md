# NovelArchive site recon

Feasibility notes for a Paperback extension for `novelarchive.cc` ("Novel Archive"). Everything here
was verified with `curl` against the live site on 2026-07-13/14.

## What it is

An aggregator of web-novel translations (fan translations of Chinese/Korean/Japanese web novels,
plus original English web serials like _Shadow Slave_) — ~26,000 novels at last count. Several
titles are pulled from more than one upstream source (`GET /api/novels/<id>/sources`); the default
per-novel endpoints transparently merge whichever sources are available into one array, and the
site's own frontend never exposes source choice — but the underlying per-source data is real and
directly fetchable, which this extension uses even though the site itself doesn't (see the chapter
numbering section).

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
| `GET /novels/<id>/sources` / `/source-list`                                                      | Alternate upstream sources for a novel — each becomes its own `Chapter.version`, see below                                                                                            |
| `GET /novels/<id>/sources/<source>/chapters` / `/chapters/<n>`                                   | A source's own chapter list/detail — clean `number` field per chapter, `content_html` (real HTML, not plain text) on detail                                                           |

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
- Discover sections map close to 1:1 onto existing endpoints: `editors-choice` → the `featured` hero
  (it's the site's own human-curated pick, the correct analog to LNORI's homepage hero / AsuraScans'
  `is_featured` flag — `trending` is algorithmic and maps to a plain `simpleCarousel` instead, same
  category as `recently-updated`), `genres` → chip row. No homepage HTML scraping needed at all
  (contrast LNORI, which reads its featured/seasonal carousels off rendered markup) — `rating` and
  `views_number` on the novel JSON are enough to build real `infoItems` for the hero cards, the same
  pattern AsuraScans uses for its own featured carousel.
- Search: `query.title` → `search` param; `fuzzy=1` by default matches the site's own behaviour.
  Sort (`recent`/`popular`/`rating`/`chapters`) and status (`all`/`ongoing`/`completed`/`hiatus`)
  are enumerable `SortingOption`s / filter chips. Multi-select genre include/exclude with an
  all/any match mode is richer than LNORI's single genre and is the one place a real
  `AdvancedSearchForm` would earn its device-only risk — worth deciding scope for v1 vs. later
  (see [search.md](../paperback/search.md#filters-without-a-form): genre chips in a discover
  section can carry filter metadata without a form at all, which is the lower-risk starting point).
- **Multi-source novels expose each source as its own `Chapter.version`, alongside the site's own
  hosted content** — see the chapter numbering section below. The `/chapters/<n>` endpoint silently
  stitches whichever sources are available into one array, but it's still a legitimate reading
  option in its own right ("Novel Archive"), not something to discard just because cleaner
  alternate-source data also exists.

## Chapter numbering — every real source, including the site's own, as its own version

`chapter_names` on `GET /novels/<id>` looks like a simple 1-based list, and the obvious
implementation (`chapterId = String(index + 1)`, title = the raw string) is wrong for a meaningful
slice of the catalog — in ways that don't share one root cause. This endpoint turns out to be a
**merge**: the site stitches together whichever upstream sources it has for a novel into one
array, silently switching source mid-list when one runs out.

**The fix is to stop trying to reverse-engineer the merge for anything beyond its own content, and
additionally use `GET /novels/<id>/sources` (each real upstream — `novelfire`, `ranobes`,
`fucknovelpia`, …) directly.** Each source's own `GET /novels/<id>/sources/<source>/chapters` list
gives a `number` field per chapter that's simply correct — no offset detection, no consensus voting,
no gap-filling. Verified end-to-end: fetching `GET /novels/<id>/sources/<source>/chapters/<n>` by
that literal `number` reliably returns the right chapter, for every source on every novel sampled.
`chapterId` is `"<sourceId>:<number>"`, `chapNum` is `number` directly, and `Chapter.version` is set
to the source's label. The site's own merged content is _also_ always included as its own version
(labelled `"Novel Archive"`, from `chaptersFromDetail`/the merged endpoint) — it's a legitimate
reading option in its own right, not something to drop just because cleaner alternate-source data
exists alongside it. All of these legitimately share overlapping chapNum ranges (they're alternate
translations/cuts of the same story, exactly what Paperback's version-priority system is for — see
below), so the app needs `version` set on every one of them to tell them apart rather than silently
collapsing all but one.

Each source's own title text needs the same "don't show a competing number" treatment as the merged
endpoint, but the shapes differ per source — verified directly, not assumed: `fucknovelpia` uses the
usual `"Chapter N ..."`; `ranobes` is a bare local/arc-relative number with nothing else (`"1"`,
`"2"`, `"3"`, resetting per arc — pure noise, suppressed); `novelfire` is a bare
`"<number> Title"` with **no** `"Chapter"` keyword at all (`"1 Nightmare Begins"`) — found on device,
not in recon, because `extractTitle`'s `"Chapter N"`-prefix regex doesn't match text that never says
"Chapter" in the first place, so this one slipped through unstripped until a real device screenshot
caught it. `extractSourceTitle` strips this bare-number case too, but only when the leading number
equals that entry's own real `number` — the same mismatch-guard `extractTitle` already applies to
the "Chapter N" case, for the same reason (a stray unrelated leading number should never be treated
as this chapter's number just because it's first in the string).

The merged-endpoint path (`chaptersFromDetail`) is deliberately conservative, since — unlike a real
source's clean `number` field — its own numbering has no ground truth to fall back on beyond text
heuristics:

- **`chapterId` is always plain array position**, unconditionally. `GET /novels/<id>/chapters/<n>` is
  keyed by each novel's own internal chapter number, which is array position for every novel sampled
  except one: "An Archdemon's Dilemma: How to Love Your Elf Bride: Volume 15" has
  `chapter_names[0] = "Chapter 2"` because the real "Chapter 1" was never imported, so `/chapters/1`
  404s and only `/chapters/2` (position + 1) works — true of its `"Novel Archive"` version regardless
  of it also having a real alternate source.
- Trusting an embedded "Chapter N" number as the fetch key generally is worse than occasionally
  wrong — it can be silently wrong. "Omniscient Reader's Viewpoint" opens with `"Chapter 0"`
  (implying offset −1), but `/chapters/0` is rejected outright, and `/chapters/1` (what an
  offset-by-text scheme would misdirect some _other_ position's request to) returns
  `chapter_names[0]`'s own content instead of 404ing — no error, just the wrong chapter.
- `getChapterDetails` only ever tries an offset-adjusted id — `position + offset`, from a simple
  whole-array consensus (`detectNumberingOffset`: trust one offset only when it covers ≥90% of the
  entries that parsed a number, and at least half of all entries parsed one at all) — **after**
  position-based fetch specifically 404s. It never tries the offset-adjusted id first, for the same
  silent-wrong-chapter reason.
- The title still gets a `"Chapter N"` prefix stripped when present (`extractTitle`/
  `CHAPTER_PREFIX`), including a redundant repeated inner number (Shadow Slave/Reverend Insanity's
  `"Chapter 1 - 1: Nightmare Begins"` → `"Nightmare Begins"`, on their `"Novel Archive"` version — both
  also have a real alternate source, which gets its own clean titles independently) and a remainder
  left with nothing but digits after stripping, which is suppressed rather than shown as a bare,
  confusing fragment.

No amount of this closes the gap fully for a hypothetical novel with, say, a trusted offset _and_ one
interior entry with a typo'd number. It's a defensible conservative default for the `"Novel Archive"`
version specifically, not a proof — which is exactly why alternate real sources, when they exist,
are always offered as additional versions rather than something to lean on this heuristic instead of.

## Risks

- **Aggregator, not original host** — the underlying failure mode is closer to AsuraScans (an
  origin that can reshape its API at will) than LNORI (a static CDN unlikely to move). The API
  contract (not markup) is the surface to watch; a hosted JSON API is far less prone to incidental
  drift than scraped HTML, but a breaking API version bump is still possible without notice.
- Total catalog is ~26,000 novels / ~8,700 pages at the site's own default page size — fine for
  server-side search/browse (the API does the filtering), but confirms client-side full-catalog
  caching (LNORI's `getLibrary()` pattern) is the wrong model here; every list-producing method
  should hit `/novels` directly with its own query rather than trying to cache-and-filter locally.
- The merged endpoint's `content` field is plain text (`\n`/`\n\n` paragraph breaks, varies by
  novel — split on one-or-more, never a fixed delimiter) but per-source chapter detail
  (`GET .../sources/<source>/chapters/<n>`) returns real HTML in `content_html` (images, headings,
  `<hr>`) — genuinely different content shapes needing two separate XHTML transforms
  (`toXhtml` vs `toXhtmlFromHtml`), not one shared paragraph-splitter.
- Per-source content has a real, uncorrectable encoding bug on at least one source: some special
  characters (a "※" reference mark, observed on `fucknovelpia`) come through as raw mojibake
  (`â\x80»`) rather than the correct character. Passed through as-is — not something a client can fix
  without guessing at the original intended byte sequence, and guessing risks corrupting text that
  wasn't actually broken.
- A source's own chapter numbers can have gaps (`ranobes` on one novel: `total: 620` chapters, but
  `number` values run past 625) — never assume a source's numbering is gapless or that `total`
  equals the highest `number`, only that each entry's own `number` is a valid, correct fetch key.

## The linchpin — device verification

Same as every `html`-chapter extension: whether the on-device XHTML reader renders these
chapters acceptably is unverifiable locally. Probe with a stub extension returning one hardcoded
chapter before building the rest, per [testing.md](../paperback/testing.md#device-verification).
