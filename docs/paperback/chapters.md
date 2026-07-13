# Chapters

The `CHAPTER_PROVIDING` capability: listing chapters and delivering their content.

## The interface

```ts
getChapters(sourceManga: SourceManga, sinceDate?: Date): Promise<Chapter[]>
getChapterDetails(chapter: Chapter): Promise<ChapterDetails>
```

`getChapters` must return the **complete** list — there is no lazy loading, which shapes how
expensive sources are designed (LNORI fetches one page per volume because chapter titles exist
nowhere cheaper). `getChapterDetails` receives the same `Chapter` object back, so anything it needs
beyond the id can ride along in `additionalInfo` (a `Record<string, string>`).

`ChapterProviding` also optionally offers `processTitlesForUpdates(updateManager, lastUpdateDate)`
for sources that can answer "what changed?" in bulk instead of per-title `getChapters` calls during
library refresh.

## `Chapter` field behaviours

- **`volume` unset renders as "Vol. TBA".** A source with no volume concept should set
  `volume: 0`; a source with real volumes sets the number.
- **`chapNum` accepts decimals** — `0.4`, `5.1` — which is how side content orders between whole
  chapters.
- **`sortingIndex`** pins list order explicitly; set it when `chapNum` alone doesn't sort the way
  the source intends (e.g. decimal-numbered front matter across many volumes).
- **`chapterId`** is yours: any string that `getChapterDetails` can resolve. Composite ids
  (`<bookPath>#<anchor>`) are fine.

## Version priority collapses repeated `chapNum`s

The app's version-priority system treats two chapters with the same `chapNum` as duplicate
_versions_ of one chapter — designed for multi-scanlator comic sources. A volume-structured source
(Vol 1 Ch 1, Vol 2 Ch 1) collides with it: chapters silently collapse until the user enables
**"Chapters Unique by Volume"** (Manage Version Priority) for the source.

No `ExtensionInfo` or `Chapter` field can enable that setting from the extension side. Say it in
the extension's `description` — the one surface users see before installing (see
[Extension structure](extension-structure.md#the-manifest-pbconfigts)).

## `ChapterDetails` is a union

Three variants, discriminated by `type`:

| Variant | Shape                                                              | For                                              |
| ------- | ------------------------------------------------------------------ | ------------------------------------------------ |
| images  | `{ type?: 'images', pages: string[] }`                             | comics — a URL per page                          |
| html    | `{ type: 'html', html: string }`                                   | novels — see [`html` chapters](html-chapters.md) |
| file    | `{ type: 'file', format: 'epub'\|'pdf'\|'cbz', request: Request }` | whole-file delivery                              |

A comic source returns the images variant; page image requests flow through your
[interceptors](networking.md#interceptors). The html variant has device-only formatting rules
strict enough to get their own page.

## Locked and premium content

Return an error, not an empty chapter: a chapter with zero pages renders as a silently blank
reader. Check the source's locked/premium markers in `getChapterDetails` and throw a message that
tells the user _when_ or _why_ ("in early access until …"). Keep locked chapters listed in
`getChapters` — hiding them makes the series look shorter than it is; only opening one should
raise.

## See also

- [`html` chapters](html-chapters.md) — the novel reader's XHTML requirements
- [Discover sections](discover.md) — `chapterUpdatesCarouselItem.chapterId` must round-trip into
  `getChapterDetails`
