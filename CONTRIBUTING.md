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

CI runs both on the PR. See [`DEVELOPMENT.md`](DEVELOPMENT.md) for the full command reference,
devcontainer setup, and how to verify a change against the live site and on device — treat any
change touching forms, `Metadata`, or discover items as unverified until you've read that.

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
