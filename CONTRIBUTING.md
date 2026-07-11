# Contributing

## How changes land

Every change reaches the version branch (`0.9/stable`) through a pull request. Do not commit to it
directly: a commit on the version branch is published to users immediately by `bundle-deploy`.

Branch off the version branch, push the branch, open a PR against it, and **Squash and merge**.
Squashing keeps the version branch at one commit per PR, while the PR retains the individual commits
and its description — together they are the changelog. Conformance and the test suite run on the PR.

## Bump the version

Every change to an extension's behaviour must bump `version` in that extension's `pbconfig.ts`, for
example [`src/AsuraScans/pbconfig.ts`](src/AsuraScans/pbconfig.ts).

Paperback compares that value against the one it has installed to decide whether an update is
available. If it does not change, users keep running the old bundle no matter what is deployed, and
the bug you just fixed stays fixed only for you.

Versions follow `1.0.0-alpha.N`, matching every other published Paperback extension. Increment `N`
once per release PR, not once per commit. The `1.0.0` stays put; the alpha counter is the real
version.

Documentation, CI, and tooling changes do not need a bump.

## Before you open a PR

```sh
npm run conformance  # typecheck, lint, format — the gate CI runs
npm test             # the extension suite, against the live site
```

CI runs both on the PR. A `pre-push` hook also runs `conformance` locally on every push; it does not
run the tests, because they hit the network, so run those yourself.

Use the devcontainer if you can. It pins the Node version CI uses, so "works on my machine" and
"passes CI" mean the same thing.

## Verify against the live site

This extension scrapes a site nobody here controls. The type system will not catch a field that
changed shape, and a test that passes only asserts the shape it was given.

Read what actually comes back. Two bugs during the initial port were invisible to both the compiler
and the test suite:

- `alt_titles` is an array on the browse endpoint and a bullet-joined string on the series page.
  Reading only the string shape silently dropped every search subtitle.
- `MangaInfo.rating` is an undocumented bare `number`, but Paperback renders it as a percentage.
  Passing Asura's ten-point rating through unchanged displayed 922%.

Neither failed a test. Both were found by printing the values and looking at them.

A whole class of bug goes further: the test runner is Node, so anything only the on-device bridge
validates — `undefined` inside a `Metadata`, an illegal character in a form row id — passes every
test and still crashes in the app. Those and the rest of the platform's sharp edges are collected in
[`docs/paperback-development.md`](docs/paperback-development.md); read it before touching forms,
search metadata, or discover items, and verify those on device.

## Never put `undefined` inside a `Metadata`

`Metadata` — the type of `SearchQuery.metadata`, `PagedResults.metadata`, and the return of
`getSearchQueryMetadata` — crosses into the app as a raw `JSValue`. An `undefined` property becomes
`nil` there, and the app throws:

```
Expected value of type `JSValue`, found `nil` instead.
```

Build these objects by assigning only the keys you have, or omit the field entirely. Do not write
`{ status: condition ? value : undefined }`.

Typed values are safe by contrast: `Chapter.title`, `SearchResultItem.subtitle`, and the other
optional struct fields are decoded rather than bridged, and tolerate `undefined`. The rule applies
to `Metadata` alone.

Nothing catches this locally. The test runner is Node, which has no such bridge, so a suite that
passes can still crash on device.

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

## Commits and pull requests

Commits on a branch use `type(Scope): summary`, for example `fix(AsuraScans): scale rating to the
fraction Paperback expects`. Types in use here: `feat`, `fix`, `refactor`, `docs`, `chore`, `ci`,
`test`.

The squash-merge title is what lands on the version branch, so it takes one of two forms:

- A **release** — a PR shipping a new extension version — is titled `<Extension> vX.Y.Z-alpha.N`,
  for example `AsuraScans v1.0.0-alpha.4`, and bumps that extension's version. Its description is
  the release changelog. GitHub appends the PR number on merge.
- **Any other PR** (docs, CI, tooling, a refactor that ships no version) uses `type(Scope): summary`
  and does not bump.

Put the reasoning in the commit body, not in a code comment. A comment explaining why a change was
made is addressed to the reviewer, and it becomes noise the moment the change merges. A comment
stating a constraint the code cannot show is worth keeping.

Split commits so each one can be reviewed and reverted on its own; prefer a mechanical rename as its
own commit over one buried in a rewrite. Each commit should pass `conformance` and the test suite —
if two changes cannot be green apart, they belong in one commit — say so in the message rather than
committing a state you know is broken.

## Licence and attribution

The project is GPL-3.0-or-later and derives from Inkdex's
[template-extensions](https://github.com/inkdex/template-extensions).

Keep the `SPDX-License-Identifier` header on every source file. Keep existing copyright notices,
including Inkdex's and including their years — a copyright year records when that holder published,
and it is not yours to change. Add your own notice below theirs.

## Branches and deployment

Version branches are named `<paperback-api-version>/<channel>`, such as `0.9/stable`, and double as
deploy branches. Squash-merging a PR into one triggers `bundle-deploy`, which publishes the bundle
to `gh-pages` under a directory named for the branch — the URL users install from. Nothing else
should push to a version branch, since any commit on it ships.
