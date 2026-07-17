# Forms — **device-only**

Settings forms and advanced-search forms render native UI from your row descriptions. Two of their
validations happen only on device, so form changes always need an on-device look
([Testing](testing.md#device-verification)).

## The `ID` charset rule isn't form-only

Any field the bridge treats as an **ID** — not just a form row id — is validated against the same
restricted charset on the Swift side: **alphanumeric, or only** `._-@()[]%?#+=/&:`. No spaces.
Violations throw at runtime when the value is actually used, with the same message shape regardless
of which field triggered it:

```
Could not convert JSValue: Invalid ID `author: Ah Nyunsung (D&C Webtoon Biz) / Yeombi`.
IDs must be alphanumeric or only contain `._-@()[]%?#+=/&:` symbols
```

```
Could not convert JSValue: Invalid ID `Slice of Life`.
IDs must be alphanumeric or only contain `._-@()[]%?#+=/&:` symbols
```

Two confirmed production crashes, both from the same mistake in different fields: a `SelectRow` id
built from a raw creator name (`Application.Selector`'s row, thrown when the picker opened — the
form-row case this page used to describe as the whole rule), and a `TagSection`'s `Tag.id` built
straight from a site's own genre string (LightNovelWorld, thrown the moment a series page opened —
no form involved at all). Any `id`-typed field on a decoded struct that crosses the bridge is
suspect, not just form rows — `Tag.id`, `DiscoverSection.id`, and similar are all candidates the
next time a raw title/name gets used as one.

So an id can never be a raw title or name. Use an index or a slug as the id and carry the display
text in the sibling `title` field, then resolve the id back to the value on selection (or, for a
display-only `Tag`, just sanitize the raw string — replace spaces/punctuation with `-`, as LNORI's
and LightNovelWorld's `Tag.id` construction both do).

## Wiring callbacks

Wire callbacks with `Application.Selector(this, "methodName")`, not closures. The named method must
exist on the instance:

```ts
SelectRow("genres", {
  title: "Genres",
  layout: "flow",
  value: this.genres,
  items: GENRES,
  minItemCount: 0,
  maxItemCount: GENRES.length,
  onValueChange: Application.Selector(this as MySearchForm, "handleGenresChange"),
});
```

The `this as MySearchForm` cast is load-bearing: `Selector`'s mapped type cannot resolve method
names through the polymorphic `this` type, so removing the cast is a compile error.

## Form lifecycle

- The first render shows whatever synchronous state exists. To populate rows from the network,
  fetch in `formDidAppear` and then call `this.reloadForm()`; `getSections()` is called on every
  reload.
- `SelectRow` takes `items` plus a `layout` (`'flow'` | `'list'`); the older `options` field is
  deprecated. `minItemCount`/`maxItemCount` gate single- vs multi-select.
- `AdvancedSearchForm.getSearchQueryMetadata()` runs after the user submits. Its return is a
  [`Metadata`](bridge.md), so the undefined rule applies — assign only present keys.
  `requiresExplicitSubmission` is always true for advanced-search forms.

## See also

- [The bridge and `Metadata`](bridge.md) — the rule governing what a form may return
- [Search](search.md) — how the submitted metadata reaches `getSearchResults`
