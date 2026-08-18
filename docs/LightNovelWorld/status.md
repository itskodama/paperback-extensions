# LightNovelWorld — deprecated

**Deprecated as of 2026-08-18.** lightnovelworld.org is merging into **chikari.moe**, and
support is being dropped rather than followed across.

## What that means in practice

- **It still works.** Nothing has been switched off and the site is up, so anyone reading through
  it can carry on.
- **It is not supported.** No new features, and no commitment to fix breakage: if the site changes
  shape and parsing stops working, that is likely where it ends rather than where a fix starts.
- **It gets removed once lightnovelworld.org is offline.** Not before — an installed extension
  pointing at a live site is doing its job.

## How users are told

`pbconfig.ts`'s `description` opens with the notice. That is deliberate and it is the only place
it can go: the description is the one surface an extension controls **before** installation
(`docs/paperback/extension-structure.md`), and it is what renders in the app's repository browser.
This extension declares no `SETTINGS_FORM_PROVIDING`, so there is no in-app screen to put a notice
on, and adding the capability purely to host one would be worse than the description.

## Removing it, when the time comes

Deleting `src/LightNovelWorld/` is enough — the deploy drops the published directory with it, and
`versioning.json` stops listing it. Note what that does **not** do: per
`docs/paperback/releasing.md`, users who already installed it keep an orphaned entry that never
updates again. That is the expected end state and not something a final release can prevent, so
there is no point trying to ship a "this is gone now" version.

Worth doing on the way out: check whether chikari.moe is a reasonable extension target in its own
right. It inherits the catalog, so the same readers are served by building for it — that would be
a **new extension** under its own directory, never a rename of this one, since the directory name
is the extension's permanent id.

## Still-open ideas, recorded rather than pursued

- The `TODO` in `parser.ts`'s `toFeaturedItem`: recommended items carry no synopsis or rating
  because that needs one extra request per item. Left as status-only data.
- `sort=rating` on `/advanced-search/` reads alphabetical rather than by rating, so it is excluded
  from `SORT_OPTIONS`. Never diagnosed; presumed a site bug.

## See also

- [`../paperback/extension-structure.md`](../paperback/extension-structure.md) — why the
  description is the surface, and why the directory name is permanent
- [`../paperback/releasing.md`](../paperback/releasing.md) — what happens to installs when an
  extension disappears from a registry
