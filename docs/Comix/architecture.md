# Comix extension architecture

Decisions made before `src/Comix` was written, and why. Payload shapes live in
[`api-shapes.md`](api-shapes.md); site access lives in [`site-recon.md`](site-recon.md).

## Module split

Follows AsuraScans' multi-file layout rather than LNORI's flat one, because this source has three
genuinely separate concerns (plain HTML parsing, WebView capture, image maths) that would otherwise
crowd a single file.

| File            | Responsibility                                                        |
| --------------- | --------------------------------------------------------------------- |
| `models.ts`     | Payload types, domain constant, sort options. No behaviour.           |
| `parsers.ts`    | Pure functions: `initial-data` extraction, payload → Paperback types. |
| `network.ts`    | Interceptor, rate limiter, cached/deduped fetch, `CloudflareError`.   |
| `webview.ts`    | `Application.executeInWebView` captures for chapters, pages, browse.  |
| `descramble.ts` | Keystream + tile permutation maths driven by response headers.        |
| `forms.ts`      | Advanced search form.                                                 |
| `main.ts`       | The extension class; wiring only.                                     |

`parsers.ts` and `descramble.ts` are deliberately free of `Application` calls so both are
exercisable by `test/unit/Comix.test.ts` offline. That is most of the risk in this extension, and
all of it is testable without a network.

## Decisions

**No HTML parser.** Inkdex's Comix bundles cheerio;
[`runtime.md`](../paperback/runtime.md) prices that at ~280 KB against ~20 KB bundles. Everything
needed sits inside one `<script id="initial-data">` tag, so a single regex cuts it out and the rest
is JSON. If the site ever moves data into markup proper, revisit — but not before.

**`mangaId` is the `hid`.** The site exposes two identifiers: the short `hid` (`qqwrm`) that keys
every URL, and a numeric `id` that appears as `mangaId` inside chapter payloads. They are not
interchangeable. The extension uses `hid` throughout and ignores the numeric one.

**`ContentRating.MATURE` unless the payload says `safe`.** The site's vocabulary is wider than the
app's three levels, so anything not explicitly `safe` is treated as mature. Inkdex's declares
`EVERYONE` source-wide; this repository's convention is to declare the ceiling.

**Scanlation group goes in `Chapter.version`.** Several groups translate one series, so `chapNum`
repeats — `version` is what stops the app collapsing them. See
[`chapters.md`](../paperback/chapters.md#version-priority-collapses-repeated-chapnums).

**Sibling imports carry the `.ts` extension.** The repository is split on this; Node 24's
type-stripping in `npm run test:unit` requires it, so the AsuraScans convention wins.

## Image descrambling

**Measured 2026-08-19 across 439 page images in three HAR captures:**

| Layer                       | Occurrences  | Notes                         |
| --------------------------- | ------------ | ----------------------------- |
| `x-scramble-*` tile shuffle | **37 (~8%)** | Always `5x5`, always algo `3` |
| `x-enc-*` XOR keystream     | **0**        | Not observed at all           |

So the shuffle is the layer that matters and the keystream is the one that does not — the opposite
of what this extension currently implements. Roughly one page in twelve renders as a jumbled
mosaic until the shuffle is undone.

**The permutation maths is solved and verified.** Every observed hash was checked against a real
scrambled image by scoring seam continuity across tile boundaries — a correct arrangement scores
10-70x lower than a wrong one, so the oracle is unambiguous:

| `x-scramble-hash`                                               | Offset |
| --------------------------------------------------------------- | ------ |
| `02900`                                                         | 117532 |
| `03632`                                                         | 58414  |
| `06a77` `13276` `42791` `44cbb` `4894c` `73c77` `c0f0d` `f40c0` | **0**  |

An unlisted hash means "use the seed unmodified", not "unknown" — so `descramble.ts`'s two special
cases plus a zero default are correct and complete as written. An earlier revision of this page
claimed the unlisted values would be mis-descrambled; that was wrong.

The seed is stable per image, but the hash **rotates per response** and the bytes change with it, so
the server re-scrambles on each fetch. That is why the table has to be complete rather than
covering the common cases.

Both layers are undone in `interceptResponse`:

| Layer         | Mechanism                                                   |
| ------------- | ----------------------------------------------------------- |
| XOR keystream | Byte arithmetic; no image decoding needed                   |
| Tile shuffle  | Decode, blit tiles, re-encode via the polyfilled DOM canvas |

The canvas comes from the runtime's **undeclared DOM polyfills** — `Image`, `HTMLCanvasElement`,
`ImageData` — not from `PBCanvas`, which has no constructor, and not from the 0.8 compat layer,
which a device probe showed is absent entirely (`App` undefined). See
[`api-reference.md`](../paperback/api-reference.md#the-polyfilled-dom) for the two traps that
matter: `Blob`/`URL` are missing so bytes cross as `data:` URLs, and the pixel buffer is Y-up so
rows must be flipped both ways.

The grid is read from `x-scramble-grid` rather than assumed: only algo 3 is bound to 5x5, while the
LCG variants shuffle any grid. A page that fails to descramble is returned as delivered — a
scrambled page still beats a blank one.

## Known gap: an unrecognised scramble hash

An `x-scramble-hash` outside the derived table falls back to an offset of 0. That is correct for
every value observed so far, but a genuinely new one carrying a non-zero offset would render its
page scrambled **silently** — there is no error, just a visibly wrong image.

Now that a canvas is available the extension could detect this itself: score seam continuity across
tile boundaries on its own output, and if the result is poor, brute-force the offset and cache it
against the hash. The scoring oracle is reliable — a correct arrangement scores 10-70x lower — and
a bounded search over ~2^18 candidates resolves in well under a minute offline. Surfacing any
discovered value in a debug settings section, in the style of `src/MangaBaka/settingsForm.ts`, would
let it be reported and hardcoded.

Not built. Recorded because the failure mode is silent, which is the kind that goes unnoticed.

## Where reading time actually goes

Measured on device 2026-08-20, after instrumenting each stage. Recorded because
nearly every guess about this was wrong, including several confident ones.

| Stage                         | Cost                                     |
| ----------------------------- | ---------------------------------------- |
| Descrambling a scrambled page | 30-102ms                                 |
| Page list, uncontended        | ~1.5-2.3s (one WebView boot per chapter) |
| Chapter list walk             | ~34s typical, 210s on a long series      |

**The image pipeline was never the bottleneck.** Several releases went into
tuning a stage costing under a tenth of a second while the real costs were three
orders of magnitude larger.

Two causes were self-inflicted, and both were found from the app's debug log
rather than by reasoning:

- **`processTitlesForUpdates` was unimplemented**, so a library check called
  `getChapters` on every followed title — each a WebView walk — and those queued
  behind whatever the reader was opening. The same chapter measured 1.5s idle and
  45s while a sweep ran.
- **The rate limiter was throttling the site's own page.** WebView requests do
  reach the extension's interceptors, so a chapter open spent about 43 seconds
  asleep across five stalls. See
  [`api-reference.md`](../paperback/api-reference.md#webview-traffic-passes-through-your-interceptors).

What remains is genuine: the site serves 20 chapters per signed request and the
signature covers the query, so a long series needs one round trip per 20
chapters. Raising `limit` returns 403.

## Fetch strategy

Discover and `getMangaDetails` read server-rendered HTML and need no token, so they go through the
ordinary cached fetch. Only search, chapter lists and page lists need the WebView, because only they
are gated behind the per-request `_` signature. Keeping that boundary explicit matters: the WebView
path is far slower, so anything reachable without it should stay out of `webview.ts`.
