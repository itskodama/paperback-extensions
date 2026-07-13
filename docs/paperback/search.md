# Search

The `SEARCH_RESULT_PROVIDING` capability and its `SearchResultsProviding` interface.

## The entry point

```ts
getSearchResults(
  query: SearchQuery<Metadata>,
  metadata: Metadata | undefined,
  sortingOption: SortingOption | undefined,
): Promise<PagedResults<SearchResultItem>>
```

Three inputs that are easy to conflate:

- **`query.title`** — the user's free-text search.
- **`query.metadata`** — _filters_: whatever the advanced-search form's
  `getSearchQueryMetadata()` returned, or the `searchQuery.metadata` baked into a genre chip. Type
  it with your own filter shape.
- **`metadata` (the parameter)** — _pagination state_: whatever your previous page returned in
  `PagedResults.metadata`. `undefined` on the first page.

## Pagination

Return the next request's state in `PagedResults.metadata`; omit it to signal the last page.
Because it is a [`Metadata`](bridge.md), never set it to `undefined` — omit the key:

```ts
return next < total ? { items, metadata: next } : { items };
```

Any JSON-safe shape works (a page number, an offset). The app hands it back verbatim.

## Sorting options

`getSortingOptions` is optional. Paperback's sort control is a single flat list with no direction
toggle, so a site with field + direction parameters needs each combination enumerated as one
option ("Rating — High to Low", "Title — A to Z"). Map the option id back to field/direction
parameters in `getSearchResults`.

## Filters without a form

A source doesn't need an `AdvancedSearchForm` for filtered entry points: `genresCarouselItem`s in
a [discover section](discover.md) each carry a ready-made `searchQuery` with filter metadata, which
arrives in `query.metadata` like a form submission would.

## See also

- [Forms](forms.md) — building the advanced-search form
- [The bridge and `Metadata`](bridge.md) — rules for everything this page calls "metadata"
