# Comix payload shapes

The exact shapes `src/Comix` parses, taken from HAR captures of a real browsing session on
2026-08-19. [`site-recon.md`](site-recon.md) covers _how_ the site is reached; this page is _what
comes back_.

Trimmed samples of each shape are inlined in `test/unit/Comix.test.ts`, matching the repo's
convention of fixtures-as-literals rather than a `fixtures/` directory.

## `#initial-data` — the no-token path

Every server-rendered page embeds `<script id="initial-data">` containing
`{ queries: { "<json-array-key>": <value> } }`. Keys are **JSON array literals serialised as
strings**, e.g. `["manga","detail","qqwrm"]`, so they are matched by inspecting the parsed key, not
by a fixed lookup.

**The values are not uniformly shaped.** This is the trap:

| Key pattern                         | Value shape                            |
| ----------------------------------- | -------------------------------------- |
| `["manga","top",{…}]`               | **bare array** of manga                |
| `["manga","list",{…}]`              | `{ items[], meta }`                    |
| `["manga","detail","<hid>"]`        | a single manga object                  |
| `["manga","groups","<hid>"]`        | **bare array** of `{ id, name, slug }` |
| `["manga","recommended","<hid>",1]` | `{ items[], meta }`                    |

Any reader must handle both the bare-array and `{items}` forms. A parser assuming `{items}`
silently yields nothing for the two largest homepage sections.

`meta` is `{ total, perPage, page, lastPage, from, to, hasNext, hasPrev }` — `hasNext` and
`lastPage` both drive pagination.

## Manga object

Present in search results, discover lists and `detail` alike; `detail` carries the most fields.

Core: `id` (int), `hid` (string, **the stable id — use it as `mangaId`**), `title`, `altTitles[]`,
`type` (`manhua`/`manhwa`/`manga`/`other`), `status` (`releasing`/…), `originalLanguage`,
`poster: { medium, large }`, `latestChapter`, `finalChapter`, `hasChapters` (bool),
`contentRating` (`safe`/…), `url` (`/title/<hid>-<slug>`).

Detail adds: `synopsis`, `synopsisHtml`, `year`, `startDate`, `endDate`, `rank`, `followsTotal`,
`ratedAvg`, `ratedCount`, `links`, `firstChapterUrl`, `latestChapterUrl`, and the taxonomy arrays
`genres[]`, `demographics[]`, `formats[]`, `tags[]`, `authors[]`, `artists[]`, `publishers[]` —
each an array of `{ id, title, slug }`.

Dates arrive **pre-formatted and relative** (`chapterUpdatedAtFormatted: "3d ago"`,
`createdAtFormatted: "10mos ago"`). There is no absolute timestamp in this payload, so any
`publishDate` derived from it is an approximation — the same limitation ManhuaPlus's `.top` has.

## Endpoints

| Endpoint                                                       | Token   | Payload                                       |
| -------------------------------------------------------------- | ------- | --------------------------------------------- |
| `GET /` (HTML)                                                 | no      | `initial-data`, 7 queries                     |
| `GET /title/<hid>-<slug>` (HTML)                               | no      | `initial-data`, detail + groups + recommended |
| `GET /api/v1/manga?keyword=&limit=&content_rating[]=`          | **yes** | `{ status, result: { items[], meta } }`       |
| `GET /api/v1/manga/<hid>/groups`                               | yes     | plain array                                   |
| `GET /api/v1/manga/<hid>/chapters?page=&limit=&order[number]=` | yes     | **encrypted** `{ e }`                         |
| `GET /api/v1/chapters/<chapterId>`                             | yes     | **encrypted** `{ e }`                         |

`_` is a deterministic per-request token; `{ e }` is base64url ciphertext. Neither is reimplemented
— both are obtained by running the site's own bundle under `Application.executeInWebView` and
capturing the plaintext, per [`site-recon.md`](site-recon.md#chapters-and-pages-solved-with-applicationexecuteinwebview).

## Chapter and page shapes

These never appear in a HAR — they are encrypted in transit and exist as plaintext only inside the
page's own JavaScript. The shapes below were captured on 2026-08-19 by proxying `JSON.parse` in a
browser console, the same technique the extension uses inside `Application.executeInWebView`.

### Chapter list

`GET /api/v1/manga/<hid>/chapters` decrypts to `{ status, result: { items[], meta } }`, with `meta`
in the standard pagination shape (`perPage` observed as 30).

| Field                | Type              | Notes                                            |
| -------------------- | ----------------- | ------------------------------------------------ |
| `id`                 | int               | The chapter id — use as `chapterId`              |
| `mangaId`            | int               | Numeric series id, **not** the `hid`             |
| `number`             | int \| float      | `chapNum`. Integer in the sample; parse as float |
| `volume`             | int               | `0` when unvolumed                               |
| `name`               | string            | Chapter title, **frequently empty**              |
| `language`           | string            | `langCode`, e.g. `en`                            |
| `isOfficial`         | bool              |                                                  |
| `votes`              | int               |                                                  |
| `createdAtFormatted` | string            | Relative (`"1h ago"`, `"6mos ago"`)              |
| `groupId` / `group`  | int / `{id,name}` | Scanlation group                                 |
| `creator`            | object \| null    | Null in the sample                               |
| `url`                | string            | `/title/<hid>-<slug>/<chapterId>-chapter-<n>`    |

**`mangaId` here is the numeric id, while the site keys everything else by `hid`.** Do not conflate
them; `mangaId` in Paperback terms is the `hid`.

Multiple groups may translate the same series, so `number` is not unique — `group.name` is what
distinguishes duplicate chapter numbers, and belongs in `Chapter.version`. See
[chapters](../paperback/chapters.md#version-priority-collapses-repeated-chapnums).

### Page list

`GET /api/v1/chapters/<chapterId>` decrypts to `{ status, result: … }` where `result` carries the
same chapter fields as above **plus**:

- `pages: { baseUrl: string, items: [{ width, height, url }] }` — `baseUrl` was empty in the sample
  and `url` absolute, so treat `baseUrl` as an optional prefix rather than assuming either form.
- `prev`, `next`, `prevAny`, `nextAny` — `{ id, number, volume, url }` or null. The `*Any` variants
  ignore the group filter.

Image URLs point at sharded hosts (`jdpw.wowpic2.store` and siblings) with opaque path tokens, and
carry no extension. Width and height arrive alongside, which is what makes tile descrambling
possible without decoding the image first to learn its dimensions.
