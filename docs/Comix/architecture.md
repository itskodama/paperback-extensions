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

Page images arrive in two layers, and **only one of them is currently undoable**:

| Layer            | Needs                        | Status                                     |
| ---------------- | ---------------------------- | ------------------------------------------ |
| XOR keystream    | byte arithmetic only         | Done, in `interceptResponse`               |
| 5x5 tile shuffle | image decode/encode + canvas | **Blocked** — no way to construct a canvas |

The maths for both is implemented and unit-tested in `descramble.ts`; the blocker is purely
applying the second one. `PBCanvas` in 0.9 exposes drawing methods but **no constructor or
factory** — the only ones (`App.createPBCanvas()`, `App.createPBImage()`) live in the 0.8 compat
layer at `compat/0.8/types.d.ts`, which is not re-exported from the package root.

Three options, none yet verified on device:

1. Deep-import the 0.8 compat layer and hope `App` still exists at runtime. Most likely to work,
   least likely to survive a platform release.
2. Check how often the grid layer is actually applied. If `x-scramble-grid` is rare, shipping
   without it degrades a minority of chapters rather than all of them.
3. Ask upstream for a 0.9 canvas factory.

**Do not claim tile descrambling works until it has been checked on device.** An earlier revision of
these notes asserted `PBCanvas` made this solvable, which was true of the drawing API and false of
the ability to obtain one.

## Fetch strategy

Discover and `getMangaDetails` read server-rendered HTML and need no token, so they go through the
ordinary cached fetch. Only search, chapter lists and page lists need the WebView, because only they
are gated behind the per-request `_` signature. Keeping that boundary explicit matters: the WebView
path is far slower, so anything reachable without it should stay out of `webview.ts`.
