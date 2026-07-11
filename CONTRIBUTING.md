# Contributing

## Bump the version

Every change to an extension's behaviour must bump `version` in that extension's `pbconfig.ts`, for
example [`src/AsuraScans/pbconfig.ts`](src/AsuraScans/pbconfig.ts).

Paperback compares that value against the one it has installed to decide whether an update is
available. If it does not change, users keep running the old bundle no matter what is deployed, and
the bug you just fixed stays fixed only for you.

Versions follow `1.0.0-alpha.N`, matching every other published Paperback extension. Increment `N`
once per set of changes you ship, not once per commit. The `1.0.0` stays put; the alpha counter is
the real version.

Documentation, CI, and tooling changes do not need a bump.

## Before you push

```sh
npm run conformance  # typecheck, lint, format — the gate CI runs
npm test             # the extension suite, against the live site
```

A `pre-push` hook runs `conformance` for you. It does not run the tests, because they hit the
network; run them yourself.

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

## Keep the architecture doc true

[`docs/site-architecture.md`](docs/site-architecture.md) is the record of how Asura serves its data
and which of its behaviours are traps. If you learn something new about the site, or discover the
doc is wrong, fix the doc in the same change.

It exists so the next person does not have to rediscover that locked chapters return `200` with an
empty page array.

## Add dependencies reluctantly

The bundle is a single file that runs on a phone. Everything you import is inlined into it, and
`Application.isResourceLimited` exists for a reason.

The extension currently has no runtime dependencies and bundles to roughly 18 KB. Adding an HTML
parser would have cost around 280 KB, and it is unnecessary: Asura embeds its data as escaped JSON
in the markup. Prefer reading structured data over parsing presentation.

## Commits

Write `type(Scope): summary`, for example `fix(AsuraScans): scale rating to the fraction Paperback
expects`. Types in use here: `feat`, `fix`, `refactor`, `docs`, `chore`, `ci`, `test`.

Put the reasoning in the commit body, not in a code comment. A comment explaining why a change was
made is addressed to the reviewer, and it becomes noise the moment the change merges. A comment
stating a constraint the code cannot show is worth keeping.

Split commits so each one can be reviewed and reverted on its own. Prefer a mechanical rename as its
own commit over a rename buried inside a rewrite.

Each commit should pass `conformance` and the test suite. If two changes cannot be green apart, they
belong in one commit — say so in the message rather than committing a state you know is broken.

## Licence and attribution

The project is GPL-3.0-or-later and derives from Inkdex's
[template-extensions](https://github.com/inkdex/template-extensions).

Keep the `SPDX-License-Identifier` header on every source file. Keep existing copyright notices,
including Inkdex's and including their years — a copyright year records when that holder published,
and it is not yours to change. Add your own notice below theirs.

## Branches and deployment

Version branches are named `<paperback-api-version>/<channel>`, such as `0.9/stable`.

Pushing one triggers `bundle-deploy`, which publishes the bundle to `gh-pages` under a directory
named for the branch. That is the URL users install from, so a push to a version branch ships to
users directly.
