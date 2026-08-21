# Icon provenance

`src/FreeWebNovel/static/icon.png` is generated from [`icon.svg`](icon.svg) in this directory.

## The artwork is original

**It is not the site's logo, and deliberately so.** freewebnovel.com's own wordmark is its branding;
reproducing it would put someone else's mark on a bundle published from this account. The mark here
is an open book drawn from scratch — two leaves, a spine, and four text rules per page — which says
"novels" without borrowing anything.

That also makes it robust in a way a traced logo would not be: nothing to re-sample if the site
restyles, and no colour that is a guess at a brand value.

## Colours

| Element       | Hex                        | Why                                            |
| ------------- | -------------------------- | ---------------------------------------------- |
| Backing plate | `#111827`                  | The repository's dark plate, as used by Comix  |
| Left leaf     | `#22c55e`                  | Lighter green for contrast against the right   |
| Right leaf    | `#15803d`                  | **The novel badge colour** from `pbconfig.ts`  |
| Spine         | `#0f5c2e`                  | A shade under the right leaf, to read as depth |
| Text rules    | 42% of the leaf's own dark | Legible without competing with the silhouette  |

The right leaf is the same `#15803d` this repository already uses for the green `Novel` badge, so
the icon and the badge agree on screen. Comics are blue, novels are green — see
[`extension-structure.md`](../paperback/extension-structure.md).

The plate is deliberate rather than transparent. A transparent background follows the app's theming,
which only helps when the mark has contrast to spare in both directions; a mid-green book would
muddy against a light theme.

## Legibility

The mark is drawn to survive being small — solid silhouette, one clear vertical, and only four
rules per page. At the size the app lists sources, finer detail turns to noise. Check any change at
32px, not at 512.

## The filename is a cache key

The app caches icons **by URL**, and that cache survives removing and re-adding the repository. A
version bump refetches the manifest and the bundle but not an asset whose URL is unchanged, so the
only way to make a changed icon appear on a device that has already seen one is to change its
filename.

The sharp edge: reverting to a previously-used name serves that name's **old cached bytes**. Comix
hit this — `icon.png` → `icon-v2.png` → back to `icon.png` resurrected the original placeholder.

`icon.png` is correct here because this extension has never shipped, so no install holds a cache
entry for it. If the icon changes during device testing, move to `icon-v2.png` and only rename back
before the release reaches `0.9/stable`.

## Regenerating

512x512, matching the other sources:

```sh
rsvg-convert -w 512 -h 512 -o src/FreeWebNovel/static/icon.png docs/FreeWebNovel/icon.svg
```
