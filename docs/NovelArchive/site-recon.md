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

## Chapter numbering — a genuinely inconsistent site, not one clean rule

`chapter_names` looks like a simple 1-based list, and the obvious implementation
(`chapterId = String(index + 1)`, title = the raw string) is wrong for a meaningful slice of the
catalog, in ways that don't share one root cause. Everything below was found by testing specific
novels — the API has no spec beyond what it does, and different novels in the same catalog behave
differently for what look like different underlying reasons (a never-imported first chapter vs.
human-entered titles drifting from source-side renumbering vs. multiple sources concatenated into
one array vs. a translator's habit of repeating the chapter number inside its own title).

### The fetch key: `chapterId` must be array position, unconditionally

**`GET /novels/<id>/chapters/<n>` is keyed by each novel's own internal chapter number, which is
array position for every novel sampled except one.** "An Archdemon's Dilemma: How to Love Your Elf
Bride: Volume 15" (`6a55244d1402dd55bf114117`) has 19 entries, text-only `"Chapter 2"` through
`"Chapter 20"` — the real "Chapter 1" was simply never imported, so array index+1 is off by exactly
one for every entry, forever: `/chapters/1` is `{"error": "Chapter does not exist"}`, only
`/chapters/2` returns `chapter_names[0]`.

Trusting an embedded "Chapter N" number as the fetch key generally, though, is actively dangerous —
not just occasionally wrong. "Omniscient Reader's Viewpoint" (`69fbdf79a5f4c7d1b734d8fb`) opens with
`chapter_names[0] = "Chapter 0"`, implying array position should be offset by −1 throughout. But
`/chapters/0` is rejected outright (`{"error": "Invalid chapter number"}`), and — critically —
`/chapters/1` (what an offset-by-text scheme would send some _other_ position's request to) returns
`chapter_names[0]`'s own content instead of 404ing. An offset-based fetch key doesn't fail loudly
here; it silently serves the wrong chapter.

**Fix:** `chapterId` is always `String(position)`. `getChapterDetails` only ever tries an
alternate id — `position + offset`, where `offset` is the novel-wide consensus described below —
after the position-based fetch specifically 404s with "Chapter does not exist". It never tries the
offset-adjusted id first. Verified end-to-end against the live API: for Archdemon's Dilemma,
`chapterId "1"` 404s, the retry with `"1" + additionalInfo.offset ("1") = "2"` succeeds and returns
the real content.

### The display number: three tiers, because no single rule covers this catalog

Three more novels show why a single entry's embedded number can't be trusted in isolation, even when
the fetch key (position) is unaffected:

- **"The Beginning After The End"** (`69ffabdfa5f4c7d1b734e239`, 532 chapters): confirmed
  `/chapters/<n>` == plain position throughout (`/chapters/517` returns position 517's content, whose
  own title text reads `"Chapter 511: Folded Space"`). 99% of entries still start with `"Chapter N"`,
  but the implied offset (`embedded number − position`) is scattered across `-1`/`-2`/`-3`/`-6` with
  no value above 54% agreement — human-entered titles drifting from source-side renumbering/splits
  over the story's history, not a single constant offset.
- **"Re:Zero Kara Hajimeru Isekai Seikatsu"** (`6a0c74d64f942c668d6981b1`, 675 chapters): almost every
  entry is `"Arc N – M: Title"` / `"Volume N, M [Title]"` — no leading "Chapter" — except two stray
  entries that happen to start with the literal word "Chapter" followed by an ARC-relative number
  wildly inconsistent with their real position (`"CHAPTER 112: …"` at real chapter 162,
  `"Chapter 47 […]"` at real chapter 231).
- **"Got Dropped into a Ghost Story, Still Gotta Work"** (`6a162ec14f942c668d69a598`, 635 chapters):
  entries 1–374 are clean `"Chapter 1"`…`"Chapter 374"`, then position 375 abruptly restarts at
  `"Chapter 165.2"`, `"Chapter 166.1"`, … — a different, apparently concatenated source for the back
  half of the book, confirmed still plain-position-fetchable across the seam. That second half isn't
  even internally clean: it has 21 further backward number-jumps of its own (`178.3 → 178.1`,
  `225.3 → 225.2 → 225.1 → 224.2 → …`) — one entry is even labelled `"Chapter 207.2 - [Illustration]"`,
  bonus art mixed into the numbering. Not a second volume, just disorder.
- **"Omniscient Reader's Viewpoint"** has a similar split: the dominant offset among entries that
  parse is `+1` (425 of 552), not the `-1` its own opening `"Chapter 0"` implies — only 77% consensus.

**Fix** (`parser.ts`): three tiers, tried in order, per novel:

1. **Trusted global offset.** Compute `offset = embeddedNumber − position` for every entry that
   parses a `"Chapter N"` prefix (decimals included: `"Chapter 165.2"` parses as `165.2` whole, not
   `165` plus leftover text). Trust the single most common offset — applied as
   `chapNum = position + offset` uniformly for every entry, matched or not — only when **both** at
   least half of all entries produced a parseable number, **and** that one offset value covers at
   least 90% of the entries that did. Archdemon's Dilemma, Miss Fairy, Shadow Slave, Reverend
   Insanity, PTSD Chaplain, and House of the Wolf all hit 100% agreement here.
2. **Literal numbers, gap-filled.** When "Chapter N" is clearly the scheme (most entries parse) but
   there's no single consistent offset — ghost-story, TBATE, ORV — each entry's own literal number is
   used **directly**, decimals and all: `"Chapter 165.2"` really does become `chapNum: 165.2`. This
   doesn't collide with anything (an earlier `"Chapter 165"` and a later `"Chapter 165.2"` are
   different numbers), and reading order no longer depends on `chapNum` being monotonic at all —
   every chapter also gets `sortingIndex: position`, which the app uses to keep the list in true
   reading order regardless of what the displayed number does. An entry with no parseable number (or
   whose number was already claimed by an identical earlier one — ORV's genuinely duplicated tail
   chapters) gets a small step past the nearest already-resolved neighbor
   (`literalNumbersWithGapFill`), the same way LNORI orders unnumbered front matter between real
   chapters. Real numbers are claimed in a first full pass before any gap-filling runs, so an early
   guess can never displace a later chapter's genuine number.
3. **Plain sequential.** When "Chapter N" isn't a real scheme at all (Re:Zero: two stray matches out
   of 675), `chapNum = position`.

`chapterId` (see above) is unaffected by any of this — it's always plain position regardless of tier.

### The title: always strip a leading "Chapter N", trust or no trust

The naive fix — strip `"Chapter N"` only when N matches the trusted `chapNum` — still leaves a
_wrong-looking_ number visible whenever a novel isn't trusted: Re:Zero's untrusted
`"CHAPTER 112: THE INSTINCT TO REJECT WEAKNESS"` would otherwise show in full under a chapter
natively labelled "162", which reads as the list being out of order even though the underlying
`chapNum`/fetch order is completely correct. Paperback already shows its own chapter number; **any**
visible competing number in the title is confusing, whether or not it happens to be right. So
`extractTitle` strips a `"Chapter N"` prefix (see `CHAPTER_PREFIX`) unconditionally whenever the text
matches it, keeping only the genuine descriptive remainder — "CHAPTER 112: THE INSTINCT TO REJECT
WEAKNESS" becomes "THE INSTINCT TO REJECT WEAKNESS" regardless of trust. Text that never claimed to
be "Chapter N" in the first place (Re:Zero's Arc/Volume text, House of the Wolf's custom-titled first
chapter) is shown untouched — there's no competing number to strip.

Two more translator habits needed handling, both found on **Shadow Slave** and **Reverend Insanity**
(2820/3096 and all 2334 entries respectively): the title repeats the chapter number a second time
right after the first — `"Chapter 1 - 1: Nightmare Begins"`. Stripping only the outer `"Chapter 1 -"`
left a redundant `"1: Nightmare Begins"` behind. `extractTitle` also strips a repeated inner number
when it exactly equals the outer one. And a remainder that's nothing but digits/punctuation after
stripping — "The Beginning After The End"'s `"Chapter 523 - 517"` (a bare secondary number, no real
title) — carries no information worth showing at all and is suppressed rather than displayed as a
bare, confusing number fragment.

No amount of this closes the gap fully; a novel with a genuine trusted offset _and_ one interior
entry with a typo'd number is still a real possibility this hasn't been tested against. The
three-tier approach is a defensible default given everything actually observed across ten novels,
not a proof.

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
