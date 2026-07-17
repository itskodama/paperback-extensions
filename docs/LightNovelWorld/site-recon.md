# LightNovelWorld site recon

Feasibility notes for a Paperback extension for `lightnovelworld.org` ("Light Novel World").
Everything here was verified with `curl` against the live site on 2026-07-16.

## What it is

A large aggregator of English-translated web/light novels (~11,000 series per `/genre-all/`'s
count), mixing licensed-adjacent fan translations and original web novels. User accounts, Discord
account linking, and a library/bookmark system exist but are irrelevant to a read-only extension.

## Transport

- Server-rendered HTML (Django: `csrftoken` cookie, `/accounts/google/login/`-style paths). No
  SPA framework markers — Alpine.js and htmx are used for progressive enhancement (modals, forms),
  not for rendering primary content.
- Cloudflare fronts it but does **not** challenge plain GETs — every page and API endpoint used
  below returned `200` with a default `curl`/Chrome UA, no JS challenge triggered.
- `robots.txt` has a `Disallow: /` block for `ClaudeBot`, `GPTBot`, `CCBot`, `Bytespider`,
  `Google-Extended`, `Amazonbot`, `meta-externalagent`, and `CloudflareBrowserRenderingCrawler`
  (AI-training/crawling bots specifically — see the `Content-Signal: ai-train=no` header comment),
  plus a blanket `Disallow: /api/` for generic bots. This is aimed at bulk AI crawlers indexing the
  whole site, not at a reader app making targeted per-chapter requests on a human's behalf — same
  category as a browser or RSS reader — but worth being aware of if this ever comes up. `Allow: /`
  otherwise; `/auth/`, `/oauth/` are also disallowed (irrelevant, login-only).

## Structure

Three levels: **novel → chapter (paginated list) → chapter (full text)**, plus a real search API.

| Page            | URL                                 | What it carries                                           |
| --------------- | ----------------------------------- | --------------------------------------------------------- |
| Novel           | `/novel/<slug>/`                    | schema.org `Book` JSON-LD (no chapter list)               |
| Chapter list    | `/novel/<slug>/chapters/?page=N`    | 50 chapters/page, server-rendered `.chapter-card` grid    |
| Chapter         | `/novel/<slug>/chapter/<n>/`        | full chapter text as plain `<p>` tags                     |
| Search API      | `/api/search/?q=<query>`            | JSON, live-filtered results                               |
| Advanced search | `/advanced-search/?<filters>`       | server-rendered, filterable/sortable results              |
| Recommendations | `/api/recommendations/`             | JSON, randomized novel list (good for a Discover section) |
| Browse          | `/genre-all/?page=N` (`?order=new`) | server-rendered, all ~11k novels, paginated               |
| Ranking         | `/ranking/`                         | server-rendered top-100 list                              |
| Updates         | `/updates/`                         | server-rendered latest-chapter-updates list               |

- **Novel identity is slug-only** — `/novel/1-lifesteal/`, no numeric id in the URL (a
  `data-novel-id` attribute exists in the DOM but isn't needed for navigation). Unlike LNORI, bare
  slugs resolve fine; there's no composite `<id>/<slug>` requirement.
- Novel JSON-LD (`schema.org/Book`): `name`, `author`, `genre` (array), `description`, `image`
  (relative `/media/covers/...` path), `aggregateRating`, `numberOfPages` (= chapter count),
  `status` (`"Ongoing"` / `"Completed"`). **No `hasPart` chapter list** — unlike LNORI, the chapter
  list is a separate paginated page, not embedded JSON-LD.
- Chapter list (`/novel/<slug>/chapters/?page=N`): 50 `.chapter-card` divs per page (last page
  short), each `onclick="location.href='/novel/<slug>/chapter/<n>/'"` with a `.chapter-title` of
  the form `Chapter <n> - <raw> - <title>`. **`<n>` (the URL position) is a clean, gapless 1..N
  sequence — use it as `chapterNumber`.** The embedded `<raw>` segment drifts from `<n>` partway
  through longer series (observed: raw stays in sync 1–101, then diverges after book-boundary
  markers like `[BOOK TWO FINALE]`/`[BOOK THREE START]`, and a bonus chapter had no raw segment at
  all — `Chapter 150 - Surprise chapter drop!`). Treat `<raw>` as untrustworthy for numbering, same
  lesson as AsuraScans' bare-leading-number titles (`docs/paperback/chapters.md`); strip the
  `Chapter <n> - ` prefix for the display title and keep the remainder as-is.
- Search API: `GET /api/search/?q=<query>` → `{"novels": [{id, title, author, slug, rank, status,
genres, cover_path, latest_chapter_number}, ...]}`. This is a real server-side query (confirmed
  it returns query-relevant matches, not a static list) — no need to replicate LNORI's
  fetch-then-filter-locally pattern. `/api/recommendations/` returns the same shape without a
  query, randomized each call, and is what the homepage's "Recommended"/"Featured" widgets use —
  good raw material for a Discover section.
- Advanced search (`/advanced-search/?genres_include=X&genres_exclude=Y&genre_logic=AND|OR&sort=Z&order=asc|desc`,
  repeatable `genres_include`/`genres_exclude`): genre filtering is confirmed real and working —
  `genres_include`, `genres_exclude`, and `genre_logic=AND|OR` each verified to change the result
  set, not just the count (e.g. `genres_include=Fantasy&genres_include=Action&genre_logic=OR` vs.
  `...&genre_logic=AND` return different lists; excluding a genre drops most of the unfiltered
  overlap). Genre values are plain, hyphen-safe strings matching the page's checkbox list (`Action`,
  `Martial-Arts`, `Slice-of-Life`, ... — convenient, no space-to-id transform needed). **`status`
  is a no-op** despite accepting the parameter with no error: `status=Completed`, `status=Ongoing`,
  and a nonsense value all returned the identical 24-result list (verified by diffing titles, not
  just counts) — don't expose it as a filter. `sort` is mostly real (`views`, `bookmarks`,
  `updates`, `new`, and the default `rank` each verified to reorder results sensibly — `new`
  matches `/genre-all/?order=new`'s top entry exactly), **but `sort=rating` looks broken**: its
  result order reads as alphabetical, not rating-sorted, and doesn't match any other verified
  ordering. Ship only the sort values individually verified to actually reorder.
- Chapter page: full text lives in `<div class="chapter-text protected-content" id="chapterText"
data-protected="true">` despite the `protected-content`/`data-protected` naming — the raw HTML
  response has the complete, unobfuscated text (checked for hidden decoy spans / reversed text /
  `user-select: none` tricks — none present in the response; whatever "protection" exists is
  client-side JS behavior, irrelevant to a raw fetch). Content is a flat run of `<p>` tags with one
  ad `<div class="chapter-ad-container">...</div>` + `<style>` block injected before the first
  paragraph (not interspersed mid-chapter in the sample checked) — regex out ad containers,
  `<style>`, and `<script>` blocks and keep the `<p>` tags, same discipline as AsuraScans/LNORI (no
  HTML parser needed).

## Mapping onto Paperback

- `contentType: 'novel'`; `ChapterDetails` uses the **`html` variant**.
- Unlike LNORI (whole-volume chapters, ~480 KB HTML), chapters here are already individual-chapter
  granularity — normal reader-sized payloads. This substantially de-risks the on-device rendering
  question that was LNORI's linchpin.
- `getMangaDetails`: fetch `/novel/<slug>/`, read the `Book` JSON-LD directly (no HTML parsing).
- `getChapters`: paginate `/novel/<slug>/chapters/?page=N` (50/page) until a short/empty page;
  `chapterNumber` = the URL's `<n>`; title = the `.chapter-title` text with the `Chapter <n> - `
  prefix stripped.
- `getChapterDetails`: fetch `/novel/<slug>/chapter/<n>/`, extract `<p>` tags from `#chapterText`
  after stripping the ad/style/script blocks, hand the joined HTML to the reader.
- `getSearchResults`: `GET /api/search/?q=<query>` directly — real server-side search, no local
  filtering needed (a first for this repo; AsuraScans and LNORI both fall back to client-side
  filtering over a bulk fetch).
- Search metadata: genre include/exclude filters route through `/advanced-search/`; plain text
  queries with no filters use `/api/search/` directly. No `status` filter (confirmed non-functional
  server-side) and only the verified-working sort values are exposed.
- Discover: `/api/recommendations/` for a "Recommended" shelf, `/ranking/` for "Popular",
  `/updates/` for "Latest", `/genre-all/?order=new` for "New".

## The linchpin — device verification

Lower-risk than LNORI's whole-volume case since chapters are normal-sized, but still needs the
usual device check per `docs/paperback/html-chapters.md`: confirm the `html` reader renders a real
chapter (inline ad-container markup stripped, remaining `<p>` text only) acceptably, and that
`Metadata`/search-form values built from the JSON-LD (`status`, `genre` array) don't hit the
`undefined`-in-`Metadata` trap that bit AsuraScans. Probe with a stub extension against one real
novel before wiring up the full extension.

## Risks

- **Aggregator, not a single-source scraper** — markup is Django-templated and fairly stable
  (no framework-churn risk like Astro islands), but as a novel-aggregation site it likely mirrors
  fan translations of varying licensing status; less of a clean-licensed-library case than LNORI,
  more like a typical scanlation aggregator's copyright posture.
- Ad markup (`chapter-ad-container`) is injected server-side into the content div itself (not just
  as a sidebar), so extraction must actively strip it rather than assume `<p>` tags are the only
  children — confirmed safe with the `<p>`-tag-only regex approach above, but re-check on a chapter
  with more inline ad breaks if paragraphs start looking truncated.
- No numeric novel id in the URL; if the site later reintroduces id-based routing, slugs used as
  `mangaId` today would break — same category of risk LNORI already carries with its slug-derived
  volume ids.
