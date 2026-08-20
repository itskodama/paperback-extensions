# API reference

A complete map of what `@paperback/types` actually exposes, written because three separate
"the platform can't do that" conclusions in this repository turned out to be wrong — each one an
inference from a partial grep rather than a fact read off the types.

**Verified against `@paperback/types@1.0.0-alpha.92`.** The package is the only authority; when this
page and `node_modules` disagree, `node_modules` wins. To re-check anything here:

```sh
# note: absolute path — the tool shell resets its cwd between commands
L=node_modules/@paperback/types/lib
cat $L/impl/Application.d.ts        # the global namespace
find $L -name '*.d.ts' | sort       # everything else
```

The other pages in this directory explain _why_ things behave as they do. This one is the index of
_what exists_.

## `Application` — the global namespace

Declared in `impl/Application.d.ts` as `declare global { namespace Application { … } }`, so it needs
no import.

### Environment

| Member                  | Type              | Notes                                                      |
| ----------------------- | ----------------- | ---------------------------------------------------------- |
| `isResourceLimited`     | `boolean`         | Device is constrained; keep work small                     |
| `filterAdultTitles`     | `boolean`         | User's profile setting                                     |
| `filterMatureTitles`    | `boolean`         | User's profile setting                                     |
| `getDefaultUserAgent()` | `Promise<string>` | The app's UA. Match it anywhere `cf_clearance` is involved |
| `sleep(seconds)`        | `Promise<void>`   | **Seconds, not milliseconds.** There is no `setTimeout`    |

### Networking

| Member                                    | Returns                                |
| ----------------------------------------- | -------------------------------------- |
| `scheduleRequest(request)`                | `Promise<[Response, ArrayBuffer]>`     |
| `registerInterceptor(id, reqSel, resSel)` | `void` — prefer `PaperbackInterceptor` |
| `unregisterInterceptor(id)`               | `void`                                 |
| `setRedirectHandler(selectorId)`          | `void`                                 |

Redirects are **not** followed automatically; see [Networking](networking.md).

### Encoding and hashing

`decodeHTMLEntities(str)`, `arrayBufferToUTF8String(buf)`, `arrayBufferToASCIIString(buf)`,
`arrayBufferToUTF16String(buf)`, `base64Encode(value)`, `base64Decode(value)`,
`crypto_md5Hash(value)`.

`base64Encode`/`base64Decode` take `string | ArrayBuffer` and return **`string | ArrayBuffer`** —
a UTF-8 string when the data is valid text, an `ArrayBuffer` when it is binary. Narrow the result
before using it. `crypto_md5Hash` always returns `string`.

For anything stronger than MD5, WebCrypto is present at runtime (`crypto.subtle`) though absent from
the typings — see [Runtime environment](runtime.md#present-globals-worth-knowing-about).

### State

| Member                                               | Persistence                                            |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `getState(key)` / `setState(value, key)`             | Ordinary persisted state                               |
| `getSecureState(key)` / `setSecureState(value, key)` | Keychain-backed; for tokens                            |
| `resetAllState()`                                    | Clears ordinary state; **does not clear secure state** |

Both getters return `unknown | undefined`, so every read needs narrowing. Note the **argument order
is `(value, key)`** on the setters — reversed from what most APIs do, and silent if you get it wrong.

### WebView execution

```ts
type ExecuteInWebViewContext = {
  source: {
    html: string;
    baseUrl: string;
    loadCSS: boolean;
    loadImages: boolean;
    userAgent?: string;
  };
  inject: string;
  storage: { cookies: Cookie[] };
  captureConsoleLog?: boolean;
};
type WebViewExecutionResult = { result: unknown; storage: { cookies: Cookie[] } };

function executeInWebView(context: ExecuteInWebViewContext): Promise<WebViewExecutionResult>;
```

**This is a real JavaScript engine the extension can call and read a value back from**, and it is
the single most-missed API in this package. It takes HTML you supply (not a URL — fetch the page
yourself, modify the markup, then pass it), runs it with `inject` as the returning expression, and
hands back `result` plus any cookies the page set.

That makes it the escape hatch for sites whose payloads are signed or encrypted by their own bundle:
serve the site its own HTML with a bootstrap script prepended, let its code do the signing and
decryption, and capture the plaintext from inside. Nothing has to be reimplemented, and the site
rotating its bundle does not matter.

`loadImages: false` and `loadCSS: false` keep it cheap. Pass `userAgent` explicitly when Cloudflare
clearance is in play, so the WebView matches the UA the clearance is bound to.

### Discover section registration

`registerDiscoverSection` is **deprecated** — implement `DiscoverSectionProviding` instead.
`unregisterDiscoverSection(id)`, `registeredDiscoverSections()` and `invalidateDiscoverSections()`
remain useful; the last one clears the app's cached sections.

### Selectors

`Application.Selector(obj, key)` and `Application.SelectorRegistry` produce the `SelectorID<K>`
values that form rows and interceptor registration take. A `SelectorID<K>` is `string | K`, so
passing the function directly type-checks — but the app resolves these across the bridge, so
register them properly rather than relying on that.

## Interceptors

```ts
abstract class PaperbackInterceptor {
  constructor(id: string);
  abstract interceptRequest(request: Request): Promise<Request>;
  abstract interceptResponse(
    request: Request,
    response: Response,
    data: ArrayBuffer,
  ): Promise<ArrayBuffer>;
  registerInterceptor(): void;
  unregisterInterceptor(): void;
}
```

Both methods are abstract — a subclass must implement each, even if one just returns its input.
`interceptResponse` returns the body, which makes it the place to transform image bytes.

**`BasicRateLimiter(id, { numberOfRequests, bufferInterval, ignoreImages })`** — `bufferInterval` is
in seconds.

**`CookieStorageInterceptor({ storage: 'stateManager' | 'memory' })`** — persists cookies, with
`setCookie`, `deleteCookie` and `cookiesForUrl(url)`. Domain matching follows RFC 6265, so a cookie
on `example.com` also matches `www.example.com`. Expired cookies are dropped on both read and write.

**`lock(uid)` / `unlock(uid)`** (`impl/Lock.js`) serialise concurrent work — useful for a token
refresh that several in-flight requests would otherwise trigger at once.

## Capability interfaces

`capabilities` in `pbconfig.ts` drives `ExtensionImpl<typeof config>`, a conditional type that
demands the matching interface for each flag. Manifest and implementation cannot drift.

| `SourceIntents`                | Interface required                 | Key methods                                      |
| ------------------------------ | ---------------------------------- | ------------------------------------------------ |
| _(always)_                     | `MangaProviding`                   | `getMangaDetails`, plus `initialise()`           |
| `SEARCH_RESULT_PROVIDING`      | `SearchResultsProviding`           | `getSearchResults`                               |
| `CHAPTER_PROVIDING`            | `ChapterProviding`                 | `getChapters`, `getChapterDetails`               |
| `DISCOVER_SECTION_PROVIDING`   | `DiscoverSectionProviding`         | `getDiscoverSections`, `getDiscoverSectionItems` |
| `SETTINGS_FORM_PROVIDING`      | `SettingsFormProviding`            | `getSettingsForm`                                |
| `CLOUDFLARE_BYPASS_PROVIDING`  | `CloudflareBypassRequestProviding` | `cloudflareBypassCompleted`                      |
| `MANAGED_COLLECTION_PROVIDING` | `ManagedCollectionProviding`       | collection get/commit                            |
| `PROGRESS_PROVIDING`           | `MangaProgressProviding`           | progress sync                                    |

Two members are worth knowing about specifically:

- **`ChapterProviding.processTitlesForUpdates?(updateManager, lastUpdateDate)`** — optional bulk
  update path. `UpdateManager` offers `getQueuedItems()`, `setUpdatePriority(id, 'high'|'low'|'skip')`,
  `getNumberOfChapters(id)`, `getChapters(id)` and `setNewChapters(id, chapters)`. Implement it only
  when the source can answer "what changed" in bulk more cheaply than per-title `getChapters`. Throw
  `CloudflareError` from here if the source needs a bypass.
- **`CloudflareBypassRequestProviding.cloudflareBypassCompleted(request, cookies, localStorage)`** —
  returns **`localStorage` as well as cookies**. `saveCloudflareBypassCookies` is deprecated.

`CloudflareError(resolutionRequest, message?)` is what actually raises the app's bypass banner. The
capability alone does nothing; see [`LNORI`'s notes](../LNORI/site-recon.md) for the failure mode.

### Errors do not survive the bridge as their own class

An error thrown inside an interceptor travels back out through `Application.scheduleRequest` by
crossing to Swift and back, and **does not arrive as the class it was thrown as**. So this looks
correct and silently fails:

```ts
catch (error) {
  if (error instanceof CloudflareError) throw error;   // never true for an interceptor throw
}
```

The consequence is worse than a bad log line: swallowing it means the app never receives the error
it needs in order to raise the bypass banner, so the source looks broken with no way to recover.
Test the `type` tag instead, which does survive:

```ts
(error as { type?: unknown })?.type === "cloudflareError";
```

The same applies to identifying rejections generally — see below.

### Measured runtime capabilities

Probed on device 2026-08-20 from a shipped extension:

| Global / capability              | Present | Consequence                                                  |
| -------------------------------- | ------- | ------------------------------------------------------------ |
| `canvas.toDataURL("image/jpeg")` | yes     | The one reliable re-encode target                            |
| `canvas.toDataURL("image/webp")` | **no**  | Silently yields PNG — see below                              |
| `WebAssembly`                    | yes     | Compiled modules can run; must be inlined in the bundle      |
| `createImageBitmap`              | yes     |                                                              |
| `OffscreenCanvas`                | **no**  | No `convertToBlob`, so encoded bytes come back as a data URL |
| `Blob`, `URL`                    | **no**  | Image bytes cross as `data:` URLs in both directions         |

`WebAssembly` being present does **not** mean an extension can be written in another language. The
extension is a JavaScript bundle implementing `ExtensionImpl`, and WASM cannot reach `Application`,
the canvas, or any host API — everything crosses through JS. WASM is useful only as a compute
kernel over bytes (codecs, crypto, heavy parsing) called from JS, and its binary has to be embedded
in the single-file bundle, inflating by about a third as base64.

### A canvas re-encode falls back to PNG

`HTMLCanvasElement.toDataURL(type)` returns PNG whenever the runtime cannot encode `type` (HTML
spec), and JavaScriptCore's canvas cannot encode WebP. So `toDataURL("image/webp")` silently yields
a multi-megabyte lossless PNG where the source was a small WebP — in Comix this roughly doubled
downloaded chapter size before it was found. Re-encode to `image/jpeg` at a high quality (~0.92):
it is the one format the canvas reliably produces, and on opaque page art it is visually lossless
at a fraction of the PNG size.

### `0` and `false` are the same value across the bridge

A numeric `0` written with `Application.setState` can read back as `false`. Once a value crosses to
Swift and back, `0` and `false` are indistinguishable, so any state holding a count, offset, or
other meaningful zero must coerce or filter on read rather than trust its type. Same family as the
`undefined`-in-`Metadata` crash.

### Native rejections are not `Error`s

`scheduleRequest` rejects transport failures with native error objects. They are not JS `Error`s,
so `error.message` may be absent and `String(error)` yields `"[object NSError]"`. Read `message`,
then `localizedDescription`, then fall back to fixed wording — interpolating the value directly
produces an error text that tells the user nothing.

## Content model

```ts
interface Chapter {
  chapterId: string;
  sourceManga: SourceManga;
  langCode: string;
  chapNum: number;
  title?: string;
  version?: string;
  volume?: number;
  publishDate?: Date;
  creationDate?: Date;
  sortingIndex?: number;
  additionalInfo?: Record<string, string>;
}
```

`ChapterDetails` is a **discriminated union** — get the tag right or the reader renders nothing:

| Variant | Tag               | Payload                                                |
| ------- | ----------------- | ------------------------------------------------------ |
| Images  | `type?: 'images'` | `pages: string[]` (default when omitted)               |
| Novel   | `type: 'html'`    | `html: string` — see [html chapters](html-chapters.md) |
| File    | `type: 'file'`    | `format: 'epub' \| 'pdf' \| 'cbz'`, `request: Request` |

`MangaInfo` requires `thumbnailUrl`, `synopsis`, `primaryTitle`, `secondaryTitles` and
`contentRating`; `contentType` is `'comic' | 'novel'` and defaults to `'comic'`. `SourceManga`'s
`chapterCount`/`newChapterCount`/`unreadChapterCount` are **readonly and app-owned** — writing them
does nothing.

`PagedResults<T>` is `{ items: T[]; metadata?: Metadata }`, with `EndOfPageResults` exported as the
terminator. `Metadata` is `JSONValue` — **`undefined` is not part of that union**, which is the
device-only crash documented in [the bridge](bridge.md).

`DiscoverSectionItem` is another discriminated union, tagged by `type`:
`featuredCarouselItem` (with up to two `infoItems` of `{ symbol, text }`), `simpleCarouselItem`,
`prominentCarouselItem`, `chapterUpdatesCarouselItem` (also carries `chapterId`), and the rest —
see [Discover sections](discover.md).

## Image manipulation

`PBCanvas` is a real drawing surface: `drawImage(image, x, y, w, h)`, `fillRect`, `arc`, `scale`,
`rotate`, `translate`, plus `generateImage(): PBImage` and `getRawPixelData(): ArrayBuffer`.

Paired with `interceptResponse` returning transformed bytes, that is enough to **descramble
tile-shuffled page images** — decode, blit tiles into their correct positions, re-encode. Sites that
scramble pages are therefore supportable, contrary to an earlier claim in this repository's notes.

## The polyfilled DOM

**The runtime provides browser globals that `@paperback/types` does not declare.** Confirmed on
device 2026-08-19 while implementing image descrambling:

| Global               | Present | Notes                                                  |
| -------------------- | ------- | ------------------------------------------------------ |
| `Image`              | yes     | Constructible; `onload`/`onerror`/`src`/`naturalWidth` |
| `HTMLCanvasElement`  | yes     | `getContext("2d")`, `toDataURL(type)`                  |
| `ImageData`          | yes     | `new ImageData(data, width, height)`                   |
| 2D context           | yes     | `drawImage`, `getImageData`, `putImageData`            |
| `Blob`, `URL`        | **no**  | Bytes must cross as `data:` URLs                       |
| `App.createPBCanvas` | **no**  | 0.8 compat only; absent at runtime                     |

Together these are enough to decode an image, manipulate pixels, and re-encode it — which is how a
source undoes server-side page scrambling. `PBCanvas` in the typings is a _different_, unrelated
surface with no constructor; do not go looking for a factory for it.

Two traps:

- **`getImageData`/`putImageData` use a Y-up buffer** (origin bottom-left), so rows arrive reversed
  relative to the image. Flip on the way in and out, or every pixel operation silently works on an
  upside-down image.
- None of this is typed, so reach it through `globalThis` and feature-detect, exactly as with
  [WebCrypto](runtime.md#present-globals-worth-knowing-about). A missing global then fails with a
  clear message instead of a `TypeError`.

### Check the standard name before concluding something is missing

Three capabilities in this repository were declared impossible and later found to exist:
`Application.executeInWebView`, the DOM canvas above, and `PBCanvas` itself. Each time the search
looked for an invented or legacy name — `createCanvas`, `App.createPBCanvas` — rather than the
ordinary web one. A probe that finds nothing proves only that the searched name is absent.

## Forms

`Form`, `FormSection` and the row constructors live under `impl/SettingsUI/`. Rows include
`ButtonRow`, `NavigationRow`, `WebViewRow` and the input rows. `WebViewRow(id, { title, request,
onComplete, onCancel })` opens a WebView and returns **cookies only** — for a returned _value_, use
`Application.executeInWebView`. Row ids have a restricted charset; see [Forms](forms.md).

## Things this package will not tell you

Type-checking is necessary and nowhere near sufficient. The Node test runner supplies globals the
device lacks, and the Swift bridge validates things TypeScript does not:

- `undefined` anywhere inside a `Metadata` — [bridge](bridge.md)
- illegal characters in a form row id — [forms](forms.md)
- XHTML strictness in `html` chapters — [html chapters](html-chapters.md)

All three pass every local test and fail on device.
