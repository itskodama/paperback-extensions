# Comix performance

What reading time is spent on, what was fixed, and every optimisation that was
tried and did not work. Measured on device across 2026-08-19/20.

Recorded because most of this looks worth trying and is not: without the
disproofs below, each avenue reads like an obvious idea nobody got round to.

## Where the time goes

| Stage                         | Cost                               |
| ----------------------------- | ---------------------------------- |
| Descrambling a scrambled page | 30-102ms                           |
| Page list (one per chapter)   | ~1.5-2.3s                          |
| Chapter list walk             | ~530-800ms per page of 20 chapters |

A chapter walk is one signed request per 20 chapters. An 8,155-chapter series is
408 requests, measured at 217s. **Per-page cost fluctuates by 30-50% between
series and between runs**, so any single measurement is a weak baseline — an
early 532ms/page reading was a favourable moment, not a fixed number.

The image pipeline was never the bottleneck. Several releases went into tuning a
stage costing under a tenth of a second while the real cost was three orders of
magnitude larger. Measure before optimising.

## What was actually fixed

Three of the four large wins were this extension getting in its own way.

| Fix                                        | Effect                                                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Stop pacing the site's own WebView traffic | Removed ~95s of sleeping per session; a chapter open had been spending ~43s asleep across five stalls              |
| Implement `processTitlesForUpdates`        | Library sweeps no longer monopolise the WebView, which had made an unrelated chapter open take 45s instead of 1.5s |
| Update checks read the newest page only    | One request instead of 408 for a changed series                                                                    |
| Re-encode descrambled pages as JPEG        | Pages were becoming multi-megabyte PNGs; chapter downloads roughly halved                                          |

## What was tried and does not work

Every route to making the walk itself faster, and the evidence that closed it.

| Attempt                                         | Result                                                                                                                                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reuse a valid signature with a larger `limit`   | `403` at 50, 100 and 500                                                                                                                                                                                                |
| Request without a signature                     | `403 {"message":"Missing token."}`                                                                                                                                                                                      |
| Recover the keystream by XOR of two ciphertexts | Not a reused stream: two ciphertexts are byte-identical across a region where their plaintexts differ                                                                                                                   |
| Forge a signature                               | Plaintext is compressed before encryption (a 108-byte query yields 105 bytes; an empty one yields 17), and the cipher lives in the obfuscated `secure.js` with a WASM module                                            |
| Call the site's own React Query fetcher         | Reachable via the React fiber, but it closes over its own `page` and `limit` — every call returns page 1 regardless of the key passed                                                                                   |
| Server-rendered `?page=N`                       | Server ignores it; `initial-data` carries `detail`, `recommended` and `groups` on every page and never chapters                                                                                                         |
| `pushState` sweep, fixed spacing                | React Query cancels the in-flight query when the key changes. Exactly alternating pages survive (2,4,6,8,10 missing), reproducibly. Spacing wide enough to avoid cancellation (450ms) is fully sequential at 627ms/page |

**Correction.** An earlier revision claimed `pushState` driven by payload arrival
was _slower_ than clicking, citing 612 and 798ms per page against a 532ms
baseline. That comparison was invalid: the 612/798 figures came from a desktop
browser while the 532ms came from the device, so they compare hardware and
networks rather than techniques.

Measured properly — both techniques, one session, one series, each waiting on the
exact payload — navigation wins:

| Technique   | Captured | Per page  |
| ----------- | -------- | --------- |
| `pushState` | 10/10    | 584-656ms |
| Clicking    | 1/10     | timeouts  |

The click arm's 1/10 is not proof that clicking is broken in general — the
shipped walk clicked through 408 pages successfully — but of a flaw in that
harness, where resetting to page 1 left the pager in a state the button finder
did not match. What it does establish is that navigation completed reliably where
a plausible click implementation did not.

**Second correction, from device measurement.** Navigation shipped in alpha.37
and was reverted in alpha.38. On device it is far slower than clicking:

| Series         | Pages | Clicking  | `pushState` |
| -------------- | ----- | --------- | ----------- |
| 8,155 chapters | 408   | 217,026ms | 375,440ms   |
| 242 chapters   | 67    | 29,293ms  | 51,908ms    |

Roughly 920ms per page against 530ms — 73-77% worse. A route change re-renders
the page and re-runs its other queries, which is cheap in a desktop browser and
expensive in the app's WebView. The desktop test could not have shown this.

The lesson is the one this page keeps relearning: **measure on device.** Two
successive conclusions about navigation, in opposite directions, were both drawn
from desktop numbers and both wrong.

## Why the walk is irreducible

Three constraints compose:

1. The API serves 20 chapters per request and `limit` is inside the signature.
2. Every request needs a token only the site's own code path mints.
3. The SPA holds one active chapter query and cancels the rest, so navigation
   cannot overlap.

Both independent implementations of this source — Mihon's at
`keiyoushi/extensions-source` and Inkdex's — click through the same pager one
page at a time. Neither requests a larger limit or calls the API directly. That
is not an oversight in either; it is the only thing the site permits.

The recurring costs are fixed. The one-time cost of walking a very long series is
not, and appears not to be fixable from outside the site.
