# Paperback extension development notes

Cross-extension notes on the Paperback 0.9 runtime and its sharp edges — the things that are not
obvious from the type definitions and that have cost real debugging time here. Per-site details live
in each extension's own doc (e.g. [`AsuraScans/site-architecture.md`](AsuraScans/site-architecture.md));
this file is about the platform.

## The one rule that explains most surprises

**The tests run in Node. The extension runs on a phone.** `paperback-cli test` executes the bundle
in a Node `vm` context; the shipped extension runs in the app's JavaScript engine (JavaScriptCore on
iOS) behind a Swift bridge. Anything the bridge validates that Node does not will pass every local
test and still fail on device.

Every entry below marked **device-only** is invisible to `npm test`. For form and metadata changes,
verifying on device is not optional.

## Runtime

- The toolchain bundles each `src/<Ext>/main.ts` with rolldown into a **single minified IIFE**
  targeting `es2020`, with no `platform`, no `external`, no injected polyfills. Everything you import
  is inlined, so a dependency's cost is the whole dependency. `Application.isResourceLimited` exists
  because this runs on phones — keep the bundle small. This extension ships with no runtime
  dependency and is ~20 KB; adding an HTML parser would have been ~280 KB.
- **No `setTimeout` / `setInterval`.** They do not exist in the runtime. Use `Application.sleep(seconds)`
  (note: seconds, not milliseconds).
- No Node builtins (`fs`, `Buffer`, `process`, …). Assume browser-ish globals plus the `Application`
  namespace, nothing more.

## `Metadata` and the JSValue bridge — **device-only**

`Metadata` (the type of `SearchQuery.metadata`, `PagedResults.metadata`, and the return of
`AdvancedSearchForm.getSearchQueryMetadata`) crosses to the app as a **raw `JSValue`**, not a decoded
struct. An `undefined` property becomes `nil` there and throws:

```
Expected value of type `JSValue`, found `nil` instead.
```

Build these objects by assigning only the keys you actually have. Never
`{ status: cond ? value : undefined }`, and do not set `metadata: undefined` on `PagedResults` —
omit the key:

```ts
const metadata: SearchMetadata = {};
if (status) metadata.status = status; // present keys only
return next ? { items, metadata: next } : { items }; // omit, don't undefine
```

Typed struct fields are the opposite — `Chapter.title`, `SearchResultItem.subtitle`, and other
optional fields on decoded types are fine as `undefined`. The rule is specific to `Metadata`.

## Form row ids — **device-only**

A form row id (`SelectRow`, etc.) must be **alphanumeric or contain only** `._-@()[]%?#+=/&:`. No
spaces. Violations throw at runtime when the row opens:

```
Could not convert JSValue: Invalid ID `author: Ah Nyunsung (D&C Webtoon Biz) / Yeombi`.
IDs must be alphanumeric or only contain `._-@()[]%?#+=/&:` symbols
```

So an id can never be a raw title/name. Use an index or a slug for the id and carry the display text
in the row's `title`, then resolve the id back to the value on selection.

## Forms

- Wire callbacks with `Application.Selector(this, "methodName")`, not closures. The named method must
  exist on the instance.
- To populate rows from the network, fetch in `formDidAppear` and then call `this.reloadForm()`; the
  first render shows whatever synchronous state exists. `getSections()` is called on every reload.
- `SelectRow` takes `items` plus a `layout` (`'flow'` | `'list'`); the older `options` field is
  deprecated. `minItemCount`/`maxItemCount` gate single vs multi select.
- `AdvancedSearchForm.getSearchQueryMetadata()` runs after the user submits; its return is the
  `Metadata` above (so the undefined rule applies). `requiresExplicitSubmission` is always true for it.

## `html` chapters must be well-formed XHTML — **device-only**

The `html` `ChapterDetails` variant (novel sources) is parsed on device by an XML parser, not an
HTML one. Feeding it ordinary HTML5 fails at open with a libxml2-style error naming the first
violation, e.g.:

```
error on line 1 at column 414: Opening and ending tag mismatch: img line 1 and picture
```

Real markup is full of things XML rejects that every browser accepts: unclosed void elements
(`<img …>`, `<hr>`, `<br>`, `<source …>`), undeclared namespace prefixes (EPUB-derived content
carries `epub:type` attributes), and named entities beyond XML's five (`&nbsp;` broke real
volumes on device; only `amp`/`lt`/`gt`/`quot`/`apos` are predefined — map the rest to numeric
references like `&#160;`). A source must transform scraped content: self-close void tags, strip
or declare foreign-namespace attributes, and normalise entities.

Well-formedness makes it parse; the **XHTML namespace** makes it render. Serve a complete
document, not a fragment:

```html
<html xmlns="http://www.w3.org/1999/xhtml">
  <head></head>
  <body>
    …content…
  </body>
</html>
```

Without that `xmlns`, the XML parses but every element is anonymous — no block semantics, so an
entire book renders as one run-together wrapped line, and `<img>` is not treated as an image (a
bare fragment showed images only sporadically). Inserting literal newlines does nothing; the fix
is the namespace, after which `<p>`/`<img>` behave like HTML.

The Node test runner accepts any string here, so validate locally by dumping the transformed
chapter and running `xmllint --noout` over it — xmllint is the same libxml2 that produces the
on-device error, which makes it a faithful proxy for the parse (not for rendering).

## Capabilities are type-enforced

`pbconfig`'s `capabilities` array drives an `ExtensionImpl<typeof config>` conditional type that
requires the matching interface for each flag — declare `CHAPTER_PROVIDING` and the compiler demands
`getChapters`/`getChapterDetails`. The manifest and the implementation cannot drift; conversely,
adding a capability is a compile-time contract, not just metadata.

## Discover items are a discriminated union — don't cast

`DiscoverSectionItem` is a union: `featuredCarouselItem`, `simpleCarouselItem`,
`prominentCarouselItem`, `chapterUpdatesCarouselItem`, `genresCarouselItem`. Each has different
required fields — a featured item has `summary`/`supertitle`/`infoItems` but no `subtitle`;
`genresCarouselItem` has `name`/`searchQuery` and no `imageUrl`; `chapterUpdatesCarouselItem` needs a
`chapterId`. Build the exact variant and let the compiler check it. An `as DiscoverSectionItem` cast
silences the excess-property check and ships a field the app ignores — that was the template's
original featured-carousel bug.

## Assorted type facts worth knowing

- **`MangaInfo.rating` is a 0–1 fraction.** The type is a bare `number` with no doc, but the app
  renders it as a percentage. A source that rates out of 10 must divide by 10, or a 9.2 shows as 920%.
- **`ChapterDetails` is a union** of image (`pages: string[]`), `html` (novels), and `file` variants.
  A comic source returns the images variant; the html variant has its own rules (see
  [`html` chapters must be well-formed XHTML](#html-chapters-must-be-well-formed-xhtml--device-only)).
- **`Chapter.volume` unset renders as "Vol. TBA".** For a source with no volumes, set `volume: 0`.
- **Networking** goes through `Application.scheduleRequest(request)`, which resolves to
  `[Response, ArrayBuffer]`. Redirects are not transparently followed — inspect the `3xx` status and
  the `Location` header yourself if the host redirects. Convert bodies with
  `Application.arrayBufferToUTF8String`. Global request behaviour (headers, rate limiting) belongs in
  a `PaperbackInterceptor` / `BasicRateLimiter`.

## Deploying

`version` in `pbconfig.ts` is what the app compares to decide whether an update exists — a behavioural
change that does not bump it never reaches users. Pushing (via a merged PR) to a version branch such
as `0.9/stable` triggers a bundle + publish to `gh-pages`; that URL is what users install. See
[`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the branch/PR workflow.
