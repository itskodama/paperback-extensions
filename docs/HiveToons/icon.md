# Icon provenance

`src/HiveToons/static/icon-v2.png` is the site's own logo, composited onto the repository's plate.

## Where the artwork came from

hivetoons.org serves two variants of one mark — a red disc carrying a black flame — and swaps
between them by theme:

| Variant | Element                              | Source                                            |
| ------- | ------------------------------------ | ------------------------------------------------- |
| Light   | `class="… dark:hidden"`, 1024x1053   | `storage.hivetoon.com/public/upload/2026/03/25/…` |
| Dark    | `class="hidden dark:block"`, 512x527 | `storage.hivetoon.com/public/upload/2026/03/30/…` |

The **light** variant is the one used here: both are the same mark, but it ships at twice the
resolution, and its outer edge is red rather than black, which is what keeps it from dissolving
into the dark plate. Both arrive with a transparent background, so the mark composites directly.

This is the site's mark, not an original drawing — the same approach `docs/Comix/icon.md` records
for comix.to. It identifies which source the extension reads, which is the whole job of the icon in
the app's source list.

## The plate

512x512 to match the other sources, `#111827` — the repository's dark plate, as used by Comix and
FreeWebNovel — with a 96px corner radius, and the mark inset to 400px so it does not crowd the
corners.

The plate is deliberate rather than transparent. A transparent background follows the app's
theming, which only helps when the mark has contrast to spare in both directions; the logo's black
flame would close up against a dark theme with nothing behind it.

## The filename is a cache key

The app caches icons **by URL**, and that cache survives removing and re-adding the repository. A
version bump refetches the manifest and the bundle but not an asset whose URL is unchanged, so the
only way to make a changed icon appear on a device that has already seen one is to change its
filename.

This extension shipped `icon.png` to `0.9/dev` first, carrying a placeholder, so that name is burnt
on any device that installed it — hence `icon-v2.png`. **Do not rename back to `icon.png`**:
reverting to a previously-used name serves that name's _old cached bytes_, which is how Comix
resurrected its original placeholder. `0.9/stable` has never served either name, so `icon-v2.png`
is safe to ship there as it stands.

## Regenerating

```sh
magick -size 512x512 xc:none -fill '#111827' \
  -draw 'roundrectangle 0,0,511,511,96,96' plate.png
magick <logo>.webp -trim +repage -resize 400x400 \
  -background none -gravity center -extent 512x512 mark.png
magick plate.png mark.png -composite src/HiveToons/static/icon-v2.png
```
