# Testing

What the local toolchain can prove, what it cannot, and the techniques that close the gap.

## The gate: `npm run conformance`

`tsc` + `oxlint --deny-warnings` + `oxfmt --check` — the same checks CI runs on every PR. Run it
before every commit; a pre-push hook enforces it. If it fails only on formatting, `npx oxfmt .`
fixes the tree (including a temp test file you may have added — format it too, or the gate trips
before tests run).

## The suite: `npm test`

`paperback-cli test` executes each extension's suite **against the live site**. Failures usually
mean the site changed, not that the code is wrong — which is the point: a scheduled workflow runs
the suite hourly so markup drift surfaces before users hit it.

The default suite (`src/tests/suite.ts`) chains `getSearchResults` → `getMangaDetails` →
`getChapters` → `getChapterDetails` through a shared state bag, validating shapes end-to-end.

## Throwaway deep tests

The default suite checks shapes, not meaning. To verify actual values — parsed fields, chapter
html, filter behaviour — temporarily replace the extension's test file with one that drives the
real methods and `console.log`s results, run the suite, read `bundles/tests.json` (console output
is captured per test), then **restore the original file**. This is the standard verification loop
in this repository; pair it with `xmllint` for [html chapters](html-chapters.md#validating-locally).

## Device verification

The tests run in Node; the extension runs on a phone behind a Swift bridge
([the one rule](README.md#the-one-rule-that-explains-most-surprises)). These surfaces are
**invisible to every local test**:

- [`Metadata` and the `undefined` rule](bridge.md) — crashes only when bridged
- [Form row ids](forms.md#row-ids-have-a-restricted-charset) — validated when the row opens
- [html chapter rendering](html-chapters.md) — parse _and_ typography are the app's
- Anything visual: discover layouts, icons on dark surfaces, chapter list presentation (e.g. the
  ["Chapters Unique by Volume" collapse](chapters.md#version-priority-collapses-repeated-chapnums))

The loop this repository uses: push the work to the `0.9/dev` branch, which publishes to its own
registry URL invisible to stable users, install from that URL on a device, and test there. Both
production bugs so far passed the entire local suite — treat any change on a device-only surface
as unverified until it has been exercised on a phone.

## See also

- [Runtime environment](runtime.md) — the Node/device split that motivates all of this
- [Releasing](releasing.md) — the dev-registry mechanics used for device testing
