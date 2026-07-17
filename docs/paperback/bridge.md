# The bridge and `Metadata` — **device-only**

How values cross from the extension's JavaScript to the app's Swift side, and the one rule whose
violation passes every local test and crashes on device.

## Two kinds of crossing

Most Paperback types (`SourceManga`, `Chapter`, `SearchResultItem`, …) are **decoded structs**: the
bridge decodes them field by field, and optional fields are genuinely optional — `Chapter.title`,
`SearchResultItem.subtitle`, and friends are fine as `undefined`. One exception inside that
leniency: any field typed as an **ID** (`Tag.id`, form row ids, `DiscoverSection.id`, …) is checked
against a restricted charset regardless — see [Forms](forms.md#the-id-charset-rule-isnt-form-only).

`Metadata` is different. It is the type of `SearchQuery.metadata`, `PagedResults.metadata`, and the
return of `AdvancedSearchForm.getSearchQueryMetadata`, and it crosses to the app as a **raw
`JSValue`**, not a decoded struct. An `undefined` property becomes `nil` there and throws:

```
Expected value of type `JSValue`, found `nil` instead.
```

This was a production crash: a filter form returned `{ status: undefined, … }`, every local test
passed, and the app crashed the moment a user searched.

## The rule

Build `Metadata` objects by assigning only the keys you actually have. Never write
`{ status: cond ? value : undefined }`, and do not set `metadata: undefined` on `PagedResults` —
omit the key entirely:

```ts
const metadata: SearchMetadata = {};
if (status) metadata.status = status; // present keys only

return next ? { items, metadata: next } : { items }; // omit, don't undefine
```

The rule is specific to `Metadata`. Do not contort decoded-struct code to avoid `undefined` — that
is allowed there and the distinction matters for readable code.

## Where `Metadata` hides

- Pagination state returned from `getSearchResults` and `getDiscoverSectionItems`
  (see [Search](search.md#pagination)).
- Filter payloads produced by advanced-search forms (see [Forms](forms.md)).
- `searchQuery.metadata` embedded in `genresCarouselItem`s — compiled by your own code, so build
  them with every key present (see [Discover sections](discover.md)).

## See also

- [Testing](testing.md#device-verification) — why no local test catches this
- [Forms](forms.md) — the other device-only bridge validation (row ids)
