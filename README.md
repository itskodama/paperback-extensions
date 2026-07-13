# Paperback Extensions

[Paperback][paperback] 0.9 extensions, maintained by [Kodama][kodama].

## Extensions

| Extension                     | Source                                   | Content      |
| ----------------------------- | ---------------------------------------- | ------------ |
| [Asura Scans](src/AsuraScans) | [asurascans.com](https://asurascans.com) | Comics       |
| [LNORI](src/LNORI)            | [lnori.com](https://lnori.com)           | Light novels |

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
library off. Every extension has a matching doc under `docs/`, and the
[`docs/paperback/`](docs/paperback/README.md) pages collect the platform-wide behaviours and
gotchas that apply to all of them.

| File       | Responsibility                                                     |
| ---------- | ------------------------------------------------------------------ |
| `pbconfig` | Extension manifest; its capabilities drive the type-level contract |
| `main`     | The extension class, one method per capability                     |
| `parser`   | Maps the site's payloads onto Paperback's types                    |
| `network`  | Request interceptor and the fetch helper                           |
| `models`   | Filter vocabulary and shared types (where an extension needs them) |
| `forms`    | The advanced search form (where an extension has one)              |

### Asura Scans

The extension uses no HTML parser. The site is server-rendered by Astro, which embeds each
component's data as escaped JSON in the markup, so the extension reads that directly — see
`astro.ts`.

[`docs/AsuraScans/site-architecture.md`](docs/AsuraScans/site-architecture.md) documents the data
model, the endpoints, the identifier choices, and the behaviours that are easy to get wrong. Read it
before changing the parsers.

### LNORI

A light novel source, and likewise parser-free: series and volumes describe themselves in
schema.org JSON-LD, the catalog page embeds every series as data-attributed cards (search and
genre filtering run locally over one cached fetch), and each volume's chapters come from the book
page's own table of contents. Chapters are delivered through Paperback's `html` reader, whose
strict XHTML requirements are documented in
[`docs/paperback/html-chapters.md`](docs/paperback/html-chapters.md).

Correct chapter lists need **"Chapters Unique by Volume"** enabled for the source in the app
(Manage Version Priority) — volumes restart their chapter numbering, and the app otherwise
collapses same-numbered chapters as duplicates.

[`docs/LNORI/site-recon.md`](docs/LNORI/site-recon.md) documents the site's structure, the
identifier scheme, and the cost model behind chapter listing.

## Licence

GPL-3.0-or-later. Derived from Inkdex's [template-extensions][template], whose copyright notices are
retained in the files that began there.

[paperback]: https://paperback.moe
[kodama]: https://github.com/itskodama
[template]: https://github.com/inkdex/template-extensions
