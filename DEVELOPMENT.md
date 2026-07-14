# Development

How to build, run, and verify changes in this repo. For PR/commit conventions and how a change
lands on `0.9/stable`, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Setup

The repository ships a devcontainer pinned to the Node version CI uses. Open it in your editor, or
run the toolchain directly:

```sh
npm ci
```

Use the devcontainer if you can — it pins the same Node version CI uses, so "works on my machine"
and "passes CI" mean the same thing.

## Scripts

```sh
npm run dev          # serve the extensions to a Paperback instance, rebuilding on change
npm run serve         # serve once, no watch
npm run bundle        # produce ./bundles
npm run logcat        # stream logs from a connected Paperback instance
npm run conformance   # typecheck, lint, format check — the same gate CI runs
npm test              # the extension suites, against the live sites
```

`npm test -- <Extension>` runs one extension's suite.

A `pre-push` hook runs `npm run conformance` on every push; it does not run `npm test`, because the
suites hit the network, so run those yourself before opening a PR.

Because the tests exercise live sites, they will fail when a site changes its markup. That is
intentional: a scheduled workflow runs them hourly so drift surfaces before users hit it.

## Verify against the live site

Extensions scrape or call sites nobody here controls. The type system will not catch a field that
changed shape, and a test that passes only asserts the shape it was given.

Read what actually comes back. Two bugs during AsuraScans' initial port were invisible to both the
compiler and the test suite:

- `alt_titles` is an array on the browse endpoint and a bullet-joined string on the series page.
  Reading only the string shape silently dropped every search subtitle.
- `MangaInfo.rating` is an undocumented bare `number`, but Paperback renders it as a percentage.
  Passing Asura's ten-point rating through unchanged displayed 922%.

Neither failed a test. Both were found by printing the values and looking at them — see
[`docs/paperback/testing.md`](docs/paperback/testing.md#throwaway-deep-tests) for the throwaway-test
pattern used to do that.

A whole class of bug goes further: the test runner is Node, so anything only the on-device bridge
validates — an `undefined` inside a `Metadata` (see
[`docs/paperback/bridge.md`](docs/paperback/bridge.md)), an illegal character in a form row id —
passes every test and still crashes in the app. Those and the rest of the platform's sharp edges are
collected in [`docs/paperback/`](docs/paperback/README.md); read the relevant pages before touching
forms, search metadata, or discover items, and verify those on device.

## Keep the architecture doc true

Each extension has a doc under `docs/<Extension>/`, mirroring its directory under `src/`. For Asura
Scans that is [`docs/AsuraScans/site-architecture.md`](docs/AsuraScans/site-architecture.md): a
record of how the site serves its data and which of its behaviours are traps.

If you learn something new about a site, or discover the doc is wrong, fix the doc in the same
change. It exists so the next person does not have to rediscover that locked chapters return `200`
with an empty page array.

## Adding an extension

Create `src/<Extension>/` containing at least `pbconfig.ts`, `main.ts`, and `static/icon.png`. The
bundler picks up any directory under `src/` holding both `pbconfig.ts` and `main.ts`, so nothing
needs registering.

The directory name becomes the extension's `id` in `versioning.json`, and Paperback keys a user's
library off it. **Do not rename a shipped extension's directory** — it orphans every saved title.

Generate its tests with `npx paperback-cli test --generate <Extension>`, and give it a doc at
`docs/<Extension>/`.

## Add dependencies reluctantly

The bundle is a single file per extension that runs on a phone. Everything you import is inlined
into it, and `Application.isResourceLimited` exists for a reason.

Asura Scans has no runtime dependencies and bundles to roughly 18 KB. Adding an HTML parser would
have cost around 280 KB, and it was unnecessary: the site embeds its data as escaped JSON in the
markup. Prefer reading structured data over parsing presentation.
