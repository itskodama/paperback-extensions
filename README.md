# Paperback Extensions

[Paperback][paperback] 0.9 extensions, maintained by [Kodama][kodama].

## Extensions

| Extension                     | Source                                   |
| ----------------------------- | ---------------------------------------- |
| [Asura Scans](src/AsuraScans) | [asurascans.com](https://asurascans.com) |

## Installation

Add this repository as an extension source in Paperback:

```
https://itskodama.github.io/paperback-extensions/0.9/stable
```

Paperback treats the repository as one source containing every extension in it, so adding that URL
once makes all of them available.

The branch name doubles as the path: `0.9` is the Paperback API version and `stable` is the release
channel.

## Development

The repository ships a devcontainer pinned to the Node version CI uses. Open it in your editor, or
run the toolchain directly:

```sh
npm ci
npm run dev          # serve the extensions to a Paperback instance, rebuilding on change
npm test             # run the test suites against the live sites
npm run conformance  # typecheck, lint, and format check — the same gate CI runs
npm run bundle       # produce ./bundles
```

`npm test -- <Extension>` runs one extension's suite.

A `pre-push` hook runs `npm run conformance`.

Because the tests exercise live sites, they will fail when a site changes its markup. That is
intentional: a scheduled workflow runs them hourly so drift surfaces before users hit it.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before making changes — in particular, every behavioural
change must bump `version` in that extension's `pbconfig.ts` or Paperback will not offer users the
update.

## Layout

Each extension is a directory under `src/`, and its directory name is the id Paperback keys a user's
library off. Every extension has a matching doc under `docs/`, and
[`docs/paperback-development.md`](docs/paperback-development.md) collects the platform-wide gotchas
that apply to all of them.

| File       | Responsibility                                                     |
| ---------- | ------------------------------------------------------------------ |
| `pbconfig` | Extension manifest; its capabilities drive the type-level contract |
| `main`     | The extension class, one method per capability                     |
| `parser`   | Maps the site's payloads onto Paperback's types                    |
| `network`  | Request interceptor and the fetch helper                           |
| `models`   | Filter vocabulary and shared types                                 |
| `forms`    | The advanced search form                                           |

### Asura Scans

The extension uses no HTML parser. The site is server-rendered by Astro, which embeds each
component's data as escaped JSON in the markup, so the extension reads that directly — see
`astro.ts`.

[`docs/AsuraScans/site-architecture.md`](docs/AsuraScans/site-architecture.md) documents the data
model, the endpoints, the identifier choices, and the behaviours that are easy to get wrong. Read it
before changing the parsers.

## Licence

GPL-3.0-or-later. Derived from Inkdex's [template-extensions][template], whose copyright notices are
retained in the files that began there.

[paperback]: https://paperback.moe
[kodama]: https://github.com/itskodama
[template]: https://github.com/inkdex/template-extensions
