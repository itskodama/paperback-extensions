# Icon provenance

`src/Comix/static/icon.png` is generated from [`icon.svg`](icon.svg) in this directory. Recorded
here because the colours are **sampled approximations, not brand values**, and nothing else in the
repository would say so.

## Where the artwork came from

comix.to's header logo is a single `<a class="logo">` holding **two overlaid `<svg>` elements that
share one `viewBox` of `0 0 500 122.82`**:

| Element    | Contents                                                    | Occupies                                    |
| ---------- | ----------------------------------------------------------- | ------------------------------------------- |
| First svg  | The "COMIX" wordmark **and** the frame the mark sits inside | x ≈ 1–150, then x ≈ 150–500 for the letters |
| Second svg | The X mark                                                  | x ≈ 6–132                                   |

Because both share a coordinate space, the icon is produced by keeping both paths and **cropping the
`viewBox` to the icon region** — the wordmark falls outside and is clipped automatically. An earlier
attempt used only the second svg and produced a bare X with no frame, which is wrong: the frame is
part of the mark, and it lives in the _wordmark's_ svg.

## Colours

| Element    | Hex       | Source                               |
| ---------- | --------- | ------------------------------------ |
| Frame      | `#c8d4d8` | Sampled from a screenshot            |
| X mark     | `#90ecf9` | Sampled from a screenshot            |
| Background | `#111827` | **Ours, not the site's** — see below |

The site's own paths carry no `fill`; colour comes from CSS that was not captured. Both hex values
were read off a screenshot of the rendered logo with an online colour picker, so they are close
rather than exact — and the site's blue visibly **fluctuates** (gradient or animation), meaning
there is no single correct value to recover. `#90ecf9` was chosen as a representative.

The dark background is a local decision, not part of the logo. The mark is light on both counts, so
on a transparent background it would disappear against a light app theme;
[`extension-structure.md`](../paperback/extension-structure.md) notes that transparency follows the
app's theming, which only helps when the mark has contrast to spare. A backing plate avoids that.

If the real brand values ever surface, they belong here and in `icon.svg`.

## Regenerating

512x512 to match the other sources:

```sh
rsvg-convert -w 512 -h 512 -o src/Comix/static/icon.png docs/Comix/icon.svg
```
