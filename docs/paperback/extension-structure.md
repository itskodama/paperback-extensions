# Extension structure

How an extension declares itself, and how those declarations become compile-time and runtime
contracts.

## The manifest: `pbconfig.ts`

Each extension exports an `ExtensionInfo`:

```ts
export default {
  name: "LNORI",
  description: "Read light novels from lnori.com. …",
  version: "1.0.0-alpha.2",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [],
  developers: [{ name: "Kodama", github: "https://github.com/itskodama" }],
} satisfies ExtensionInfo;
```

Fields worth thinking about:

- **`version`** is what the app compares to decide whether an update exists. Comparison is
  one-directional: the app never offers a lower version than what is installed, so renumbering a
  release downward strands existing installs until the numbering catches up. See
  [Releasing](releasing.md).
- **`description`** renders in the app when a user browses the repository — it is the only
  user-facing surface an extension controls _before_ installation. Use it for anything the user
  must do for the extension to work correctly (LNORI directs users to enable "Chapters Unique by
  Volume"; see [Chapters](chapters.md#version-priority-collapses-repeated-chapnums)).
- **`icon`** resolves against the extension's `static/` directory. A square PNG; a transparent
  background follows the app's theming, but check a dark surface if the mark itself is dark.
- **`contentRating`** gates visibility by the user's profile settings: `EVERYONE`, `MATURE`, or
  `ADULT`. If any subset of the source's content is mature, declare `MATURE`.

## Extension identity is the directory name

The directory under `src/` — not `name` — is the extension's **id**: it keys the registry entry,
the published bundle path, and the user's library. Renaming the directory ships a _new_ extension;
users of the old id keep an orphaned entry and never see another update. Treat the directory name
as permanent once a version has reached users.

## Capabilities are type-enforced

`capabilities` drives an `ExtensionImpl<typeof config>` conditional type that requires the matching
interface for each flag — declare `CHAPTER_PROVIDING` and the compiler demands
`getChapters`/`getChapterDetails`. The manifest and the implementation cannot drift; adding a
capability is a compile-time contract, not just metadata.

The mapping:

| Capability                     | Interface required                                       |
| ------------------------------ | -------------------------------------------------------- |
| `SEARCH_RESULT_PROVIDING`      | `SearchResultsProviding` — see [Search](search.md)       |
| `CHAPTER_PROVIDING`            | `ChapterProviding` — see [Chapters](chapters.md)         |
| `DISCOVER_SECTION_PROVIDING`   | `DiscoverSectionProviding` — see [Discover](discover.md) |
| `SETTINGS_FORM_PROVIDING`      | `SettingsFormProviding` — see [Forms](forms.md)          |
| `CLOUDFLARE_BYPASS_PROVIDING`  | `CloudflareBypassRequestProviding`                       |
| `MANAGED_COLLECTION_PROVIDING` | `ManagedCollectionProviding`                             |
| `PROGRESS_PROVIDING`           | `MangaProgressProviding`                                 |

Two things hold regardless of capabilities:

- **`MangaProviding` is always required.** `Extension` includes `getMangaDetails` and
  `initialise()` unconditionally.
- Several `SourceIntents` members are deprecated aliases (`MANGA_CHAPTERS`, `SETTINGS_UI`, …); use
  the `_PROVIDING` names.

## The extension class

`main.ts` implements the class and exports an instance:

```ts
export class LNORIExtension implements ExtensionImpl<typeof LNORIConfig> {
  async initialise(): Promise<void> {
    this.mainRateLimiter.registerInterceptor();
    this.mainInterceptor.registerInterceptor();
  }
  // one method per declared capability…
}

export const LNORI = new LNORIExtension();
```

`initialise()` runs before anything else; register interceptors and rate limiters there.

## See also

- [Releasing](releasing.md) — how the manifest surfaces in the registry users install
- [Testing](testing.md) — the conformance gate that keeps manifest and implementation in sync
