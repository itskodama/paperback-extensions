# Asura Scans

A [Paperback][paperback] 0.9 extension for reading manhwa, manhua, and manga from
[asurascans.com][asurascans].

## Installation

Add this repository as an extension source in Paperback:

```
https://itskodama.github.io/asurascans-paperback-extension/0.9/stable
```

The branch name doubles as the path: `0.9` is the Paperback API version and `stable` is the
release channel.

## Development

The repository ships a devcontainer pinned to the Node version CI uses. Open it in your editor, or
run the toolchain directly:

```sh
npm ci
npm run dev          # serve the extension to a Paperback instance, rebuilding on change
npm test             # run the extension test suite against the live site
npm run conformance  # typecheck, lint, and format check — the same gate CI runs
npm run bundle       # produce ./bundles
```

A `pre-push` hook runs `npm run conformance`.

Because the tests exercise the live site, they will fail if Asura changes its markup. That is
intentional: a scheduled workflow runs them hourly so drift surfaces before users hit it.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) before making changes — in particular, every behavioural
change must bump `version` in `pbconfig.ts` or Paperback will not offer users the update.

## Architecture

The extension uses no HTML parser. Asura is server-rendered by Astro, which embeds each component's
data as escaped JSON in the markup, so the extension reads that directly.

[`docs/site-architecture.md`](docs/site-architecture.md) documents the data model, the endpoints,
the identifier choices, and the behaviours that are easy to get wrong. Read it before changing the
parsers.

| File       | Responsibility                                                     |
| ---------- | ------------------------------------------------------------------ |
| `pbconfig` | Extension manifest; its capabilities drive the type-level contract |
| `main`     | The extension class, one method per capability                     |
| `parser`   | Maps Asura's payloads onto Paperback's types                       |
| `astro`    | Extracts and decodes the embedded island data                      |
| `network`  | Request interceptor and the redirect-following fetch               |
| `models`   | Genres, filter vocabulary, and shared types                        |
| `forms`    | The advanced search form                                           |

## Licence

GPL-3.0-or-later. Derived from Inkdex's [template-extensions][template], whose copyright notices
are retained in the files that began there.

[paperback]: https://paperback.moe
[asurascans]: https://asurascans.com
[template]: https://github.com/inkdex/template-extensions
