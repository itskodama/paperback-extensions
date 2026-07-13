# Releasing

How a merged change becomes something a user's app actually installs or updates.

## Version semantics

`version` in `pbconfig.ts` is what the app compares to decide whether an update exists. Two
consequences:

- **A behavioural change that does not bump `version` never reaches users**, even after deploying.
  The bump belongs in every release, as its own final commit
  (`chore(Scope): bump to X.Y.Z-alpha.N`).
- **Comparison is one-directional.** The app never replaces an installed version with a lower one,
  so renumbering releases downward (e.g. collapsing dev iterations into a smaller stable number)
  strands any device that installed the higher number until numbering catches up — a delete and
  reinstall is the reset.

## The registry

Pushing to a version branch (`0.9/stable`, `0.9/dev`, …) bundles the extensions and publishes them
to GitHub Pages under the branch's own path. The URL users add to Paperback:

```
https://itskodama.github.io/paperback-extensions/0.9/<channel>
```

What the registry serves:

- `versioning.json` — the repository's display name and description (taken from `package.json`;
  the deploy labels non-stable channels "— dev" so two added repos are distinguishable in the app)
  plus each extension's `id`, `name`, `description`, and `version`.
- One directory per extension — bundled `index.js`, `info.json`, and `static/` — keyed by the
  **extension id**, which is the `src/` directory name. Renaming that directory publishes a new
  extension; see [Extension structure](extension-structure.md#extension-identity-is-the-directory-name).

Adding the repository once makes every extension in it available; the app checks the registry for
version changes per extension.

## Channels

`0.9/stable` deploys to users — nothing lands on it except reviewed PRs, and every behavioural
merge carries a version bump. `0.9/dev` is the device-testing channel: push work there directly to
get it installable on a phone without touching users, then PR the same branch into stable once it
passes ([Testing](testing.md#device-verification)). Deleting a version branch automatically removes
its published directory.

The repository-level mechanics — PR flow, squash titles, when to bump — live in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).

## See also

- [Extension structure](extension-structure.md) — the manifest fields the registry surfaces
- [Testing](testing.md) — what must pass before a release is real
