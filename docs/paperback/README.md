# Paperback extension development

Documentation for building extensions against the Paperback 0.9 runtime — the platform behaviours
that are not obvious from the type definitions and that have cost real debugging time in this
repository. Per-site details live in each extension's own doc (e.g.
[`../AsuraScans/site-architecture.md`](../AsuraScans/site-architecture.md)); these pages are about
the platform itself.

Everything here was learned by shipping extensions: each rule cites the failure that taught it.
Re-verify against the current app when something looks out of date.

## The one rule that explains most surprises

**The tests run in Node. The extension runs on a phone.** `paperback-cli test` executes the bundle
in a Node `vm` context; the shipped extension runs in the app's JavaScript engine (JavaScriptCore
on iOS) behind a Swift bridge. Anything the bridge validates that Node does not will pass every
local test and still fail on device.

Sections marked **device-only** describe exactly those behaviours. For changes touching a
device-only surface, [verifying on device](testing.md#device-verification) is not optional.

## Pages

| Page                                          | What it covers                                                        |
| --------------------------------------------- | --------------------------------------------------------------------- |
| [API reference](api-reference.md)             | Complete map of `@paperback/types` — what exists, verified            |
| [Runtime environment](runtime.md)             | The JavaScript environment: bundling, size budgets, missing globals   |
| [Networking](networking.md)                   | `Application.scheduleRequest`, redirects, interceptors, rate limiting |
| [Extension structure](extension-structure.md) | `pbconfig`, capabilities, the type-level contract, extension identity |
| [The bridge and `Metadata`](bridge.md)        | How values cross to Swift; the `undefined` rule — **device-only**     |
| [Forms](forms.md)                             | Settings and advanced-search forms; row id rules — **device-only**    |
| [Search](search.md)                           | `getSearchResults`, pagination, sorting options, filter metadata      |
| [Discover sections](discover.md)              | Section types and the `DiscoverSectionItem` union                     |
| [Chapters](chapters.md)                       | `Chapter` fields, version priority, the `ChapterDetails` union        |
| [`html` chapters](html-chapters.md)           | The novel reader's XHTML requirements — **device-only**               |
| [Testing](testing.md)                         | What the test runner can and cannot catch; verification techniques    |
| [Releasing](releasing.md)                     | Version semantics, the registry, what users actually see              |

## Reading order

For a first extension, read [Extension structure](extension-structure.md),
[Networking](networking.md), and [Testing](testing.md), then the pages matching the capabilities
you declare. Keep [API reference](api-reference.md) open alongside them — the conceptual pages
explain _why_, it lists _what exists_, and checking it first avoids concluding the platform cannot
do something it can. Before shipping anything, read [The bridge and `Metadata`](bridge.md) — its failure
mode passes every local test.
