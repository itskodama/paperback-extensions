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
- **`sortingIndex` did not override the visible list's sort order in one direct device test**
  (NovelArchive, 2026-07): a source deliberately given a `chapNum` non-monotonic with true reading
  order (`165.2` after `374`, reflecting a second concatenated upstream's own numbering) but with
  `sortingIndex` correctly set to true reading position still showed `165.2` sorted to the top of
  the chapter list, not in the position `sortingIndex` implied. Treat `chapNum` as the value the
  list actually sorts by; don't rely on `sortingIndex` to rescue a numbering scheme that isn't
  already monotonic on its own. (This contradicts what the type's doc comment suggests — decimal
  front matter across volumes as the motivating case — which was never device-verified before now.
  Kept here corrected rather than silently dropped; report back if a future test finds
  `sortingIndex` _does_ work in some other configuration.)
- **`chapterId`** is yours: any string that `getChapterDetails` can resolve. Composite ids
  (`<bookPath>#<anchor>`) are fine.
- **The chapter list row renders as `"Chapter {chapNum} - {title}"`** when `title` is set
  (device-verified) — `chapNum` and `title` are not shown as visually separate elements. A `title`
  that itself starts with a number — its own `"Chapter N"` prefix, or even a bare leading number
  with no `"Chapter"` keyword at all (one real-world source titled chapters `"1 Nightmare Begins"`)
  — reads as a second, possibly-contradicting number sitting right next to the app's own label
  (`"Chapter 1 - 1 Nightmare Begins"`). Strip any leading number from `title` before returning it,
  regardless of whether it happens to equal `chapNum` — a _correct_ duplicate number is exactly as
  confusing to read as a wrong one.

## Version priority collapses repeated `chapNum`s

The app's version-priority system treats two chapters with the same `chapNum` as duplicate
_versions_ of one chapter — the field that labels each alternate is `Chapter.version?: string`.
Leave it unset and every chapter for a title falls into a single **"Unversioned"** bucket
(device-verified: the per-title version picker shows literally that word as the only option when no
chapter on the title sets `version`).

This is a real, useful mechanism beyond just avoiding accidental collisions — a source that legitimately
aggregates chapters from more than one upstream (translated by different groups, scraped from
different sites) can expose **each upstream as its own selectable version**, letting the reader pick
their preferred one through the app's own UI instead of the extension silently choosing for them.
Verified end-to-end (NovelArchive, which aggregates several translation sources per title): set
`version` to a human-readable label per upstream on every `Chapter` for a title — including
whichever one is the extension's own "default" source, if it has one; that default is a legitimate
reading option in its own right and belongs in the version list too, not something to drop just
because cleaner alternate-source data also exists. `chapterId` and `chapNum` only need to be unique
_within_ each version's own chapter set, not across all of them — overlapping ranges across versions
(both starting near `chapNum: 1`) are expected and fine.

Device-verified screen, reached per-title via **Manage Version Priority** (Manage Version Priority
→ **Available Versions** to see what a source has actually exposed):

- **Collapse Multiple Versions** — show only one version per `chapNum`, chosen by priority.
- **Filter Out Unprioritized Versions** — hide versions not in the priority list entirely (a
  chapter the reader has already read is shown regardless of either toggle).
- **Chapters Unique by Volume** — `"Use volume number as well when matching chapters"`, **a
  different setting from plain version priority**: makes matching use `(volume, chapNum)` instead of
  `chapNum` alone, for a genuinely volume-structured source (Vol 1 Ch 1, Vol 2 Ch 1 are different
  chapters that happen to reuse the number 1 per volume) — the collision this section originally
  described. This is what LNORI's `description` asks users to enable. Don't reach for it to solve a
  _multi-translation-source_ scenario instead — `version` is the correct tool for that, and the two
  problems can look superficially similar while needing different settings.
- **Available Versions** — tap to reorder priority; the app defaults to prioritizing whichever
  version it considers most recently added, with no field an extension can set to force a specific
  default beyond that.
- **Record Chapter Progress** / **Show Chapter in History** — on by default, unrelated to versioning.

No `ExtensionInfo` or `Chapter` field can turn on "Chapters Unique by Volume" from the extension
side. Say it in the extension's `description` — the one surface users see before installing (see
[Extension structure](extension-structure.md#the-manifest-pbconfigts)). `version`, by contrast,
needs no user setting at all to start working — set it and the version picker populates itself.

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
- [`../NovelArchive/site-recon.md`](../NovelArchive/site-recon.md) — the concrete multi-source
  aggregator this page's `version` findings came from
