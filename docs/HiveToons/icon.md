# Icon provenance

`src/HiveToons/static/icon.png` is generated from [`icon.svg`](icon.svg) in this directory.

## The artwork is original

**It is not the site's logo, and deliberately so.** hivetoons.org's own wordmark is its branding;
reproducing it would put someone else's mark on a bundle published from this account. The mark here
is three honeycomb cells drawn from scratch — pointy-top hexagons on the lattice a real honeycomb
uses, sized a little under their cell so the gaps read as seams. It says "hive" without borrowing
anything.

That also makes it robust in a way a traced logo would not be: nothing to re-sample if the site
restyles, and no colour that is a guess at a brand value.

## Colours

| Element       | Hex       | Why                                                |
| ------------- | --------- | -------------------------------------------------- |
| Backing plate | `#111827` | The repository's dark plate, as used by Comix      |
| Upper-left    | `#f59e0b` | The lightest amber, so the cluster reads top-lit   |
| Upper-right   | `#d97706` | One step darker, to separate it from its neighbour |
| Lower         | `#b45309` | **The comic badge colour** from `pbconfig.ts`      |

The lower cell is the same `#b45309` the badge uses, so the icon and the badge agree on screen. The
three shades give the cluster depth without an outline, which would not survive being small.

The plate is deliberate rather than transparent. A transparent background follows the app's theming,
which only helps when the mark has contrast to spare in both directions; amber on white would lose
its edges.

## Legibility

The mark is drawn to survive being small — three solid shapes, no strokes, no interior detail. At
the size the app lists sources, finer detail turns to noise. Check any change at 32px, not at 512.

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
rsvg-convert -w 512 -h 512 -o src/HiveToons/static/icon.png docs/HiveToons/icon.svg
```
