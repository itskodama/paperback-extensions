# Forms — **device-only**

Settings forms and advanced-search forms render native UI from your row descriptions. Two of their
validations happen only on device, so form changes always need an on-device look
([Testing](testing.md#device-verification)).

## Row ids have a restricted charset

A form row id (`SelectRow`, etc.) must be **alphanumeric or contain only** `._-@()[]%?#+=/&:`. No
spaces. Violations throw at runtime when the row opens:

```
Could not convert JSValue: Invalid ID `author: Ah Nyunsung (D&C Webtoon Biz) / Yeombi`.
IDs must be alphanumeric or only contain `._-@()[]%?#+=/&:` symbols
```

So an id can never be a raw title or name. Use an index or a slug as the id and carry the display
text in the row's `title`, then resolve the id back to the value on selection. This was the second
production crash in this repository — a creator picker built ids from names, passed every test, and
threw the moment the picker opened.

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
