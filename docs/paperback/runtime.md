# Runtime environment

What the extension's JavaScript actually runs in, and what that costs. The environment is neither
Node nor a browser: it is the app's JavaScript engine (JavaScriptCore on iOS) plus the
`Application` namespace, and nothing more.

## Bundling

The toolchain bundles each `src/<Extension>/main.ts` with rolldown into a **single minified IIFE**
targeting `es2020`, with no `platform`, no `external`, and no injected polyfills. Everything you
import is inlined, so a dependency's cost is the whole dependency.

`Application.isResourceLimited` exists because this runs on phones — keep the bundle small. The
extensions in this repository ship with **no runtime dependencies** at ~20 KB each; adding an HTML
parser would have cost ~280 KB. Both AsuraScans and LNORI avoid one by reading structured data the
sites already embed (escaped JSON props, schema.org JSON-LD, data attributes) instead of parsing
markup. Prefer that approach; reach for a parser only when a site offers no structured alternative.

## Missing globals

- **No `setTimeout` / `setInterval`.** They do not exist in the runtime. Use
  `Application.sleep(seconds)` — note the unit is **seconds**, not milliseconds.
- **No Node builtins** — no `fs`, `Buffer`, `process`, or anything else from Node's standard
  library. Assume browser-ish ES2020 globals plus the `Application` namespace.
- Anything else you are unsure about: check before relying on it, because the Node test runner will
  happily provide globals the device lacks (see [Testing](testing.md)).

## Present globals worth knowing about

**WebCrypto is available**, despite being absent from the platform typings. Probed on device
2026-08-15 from an extension's `initialise`:

```
crypto: present, getRandomValues: yes, subtle: yes
```

So `crypto.getRandomValues` and `crypto.subtle.digest("SHA-256", …)` both work, and neither needs
a bundled implementation. MangaBaka's `crypto.ts` carried a 110-line FIPS 180-4 transcription of
SHA-256 for PKCE before this was confirmed; it now calls `subtle` and is a third of the size.

Two caveats. `subtle.digest` is **async**, so anything built on it becomes async — for MangaBaka
that meant a PKCE challenge could no longer be produced in a `Form` field initialiser and moved to
`formWillAppear`. And since none of this is typed, it has to be reached through a cast and
feature-detected, so a runtime without it fails with a clear message rather than a `TypeError`.

## Module state

Module-level variables (caches, memos) live as long as the app keeps the extension's JS context
alive. They are a legitimate place for session caches — both extensions cache parsed pages and
catalog data this way — but never assume they persist across app launches. Durable state belongs in
`Application.getState` / secure storage.

## See also

- [Networking](networking.md) — the only sanctioned way to reach the network
- [Testing](testing.md) — why "it works in `npm test`" proves less than it seems
