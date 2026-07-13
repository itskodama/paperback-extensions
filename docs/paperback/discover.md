# Discover sections

The `DISCOVER_SECTION_PROVIDING` capability: the app's landing page for a source.

## Sections

`getDiscoverSections()` returns the section list; `getDiscoverSectionItems(section, metadata)` is
then called per section. Each section has an `id`, a `title`, and a `DiscoverSectionType` that
decides its rendering: `featured` (hero carousel), `simpleCarousel`, `prominentCarousel`,
`chapterUpdates`, `genres` (chip row).

Section titles are plain data — they can be computed. LNORI reads its seasonal section's title from
the site's own heading ("Summer 2026 Anime") so it renames itself when the site does.

Sections need not map 1:1 onto requests. Compile chip sections from static vocabulary, back several
sections with one cached page fetch, or derive a "Popular" section from data another feature
already fetched. `getDiscoverSectionItems` supports pagination exactly like
[search](search.md#pagination).

## The item union — don't cast

`DiscoverSectionItem` is a discriminated union: `featuredCarouselItem`, `simpleCarouselItem`,
`prominentCarouselItem`, `chapterUpdatesCarouselItem`, `genresCarouselItem`. Each has different
required fields:

- a **featured** item has `summary`/`supertitle`/`infoItems` but no `subtitle`;
- a **genres** item has `name` and a `searchQuery`, and no `imageUrl`;
- a **chapter updates** item needs a `chapterId` alongside the `mangaId`.

Build the exact variant and let the compiler check it. An `as DiscoverSectionItem` cast silences
the excess-property check and ships a field the app ignores — that was the bug in the original
template's featured carousel.

```ts
{
  type: "genresCarouselItem",
  name: "Isekai",
  searchQuery: { title: "", metadata: { genre: "isekai" } },
  contentRating: ContentRating.MATURE,
}
```

A chip's `searchQuery.metadata` is a [`Metadata`](bridge.md): compile it with every key present,
never conditionally `undefined`.

## See also

- [Search](search.md) — where a chip's `searchQuery` lands
- [Chapters](chapters.md) — `chapterUpdatesCarouselItem` ids must match real `chapterId`s
