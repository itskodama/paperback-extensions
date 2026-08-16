/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import {
  ContentRating,
  type SourceManga,
  type TrackedMangaChapterReadAction,
} from "@paperback/types";

import {
  base64UrlEncode,
  pkceChallenge,
  randomVerifier,
  sha256,
  utf8Bytes,
} from "../../src/MangaBaka/crypto.ts";
import { count } from "../../src/MangaBaka/decode.ts";
import {
  contentRatingOf,
  contentTypeOf,
  coverUrl,
  humanizeSlug,
  mergedTargetId,
  PLACEHOLDER_COVER,
  snapRating,
  tagSections,
  toGenreOptions,
  toId,
  toMangaInfo,
  toSearchResultItem,
  toSimpleCarouselItem,
} from "../../src/MangaBaka/mapping.ts";
import {
  authorizeUrl,
  encodeForm,
  headerValue,
  mangaBakaCookieJar,
  parseSetCookie,
  parseQuery,
  readAuthorizeResponse,
  redirectTargetFromBody,
  tokensExpired,
  CLIENT_ID,
  ISSUER,
  REDIRECT_URI,
} from "../../src/MangaBaka/oauth.ts";
import { collapseReadActions, progressChapter, today } from "../../src/MangaBaka/progress.ts";
import { primaryTitle, secondaryTitles } from "../../src/MangaBaka/titles.ts";
import type { LibraryEntry, Series } from "../../src/MangaBaka/types.ts";
import { buildQuery, searchPath } from "../../src/MangaBaka/urls.ts";

// Trimmed from the live GET /v1/series/1677 response (Chainsaw Man), keeping the
// shapes that actually bite: string counts, deprecated scalar titles alongside
// titles[], the nested cover variants, and space-bearing tag names.
const CHAINSAW_MAN: Series = {
  id: 1677,
  state: "active",
  merged_with: null,
  title: "Chainsaw Man",
  native_title: "チェンソーマン",
  romanized_title: "Chainsaw Man",
  titles: [
    { language: "en", traits: ["official"], title: "Chainsaw Man", is_primary: true },
    { language: "en", traits: ["alternative"], title: "Chain Saw Man" },
  ],
  cover: {
    raw: { url: "https://images.mangabaka.dev/raw.png", width: 759, height: 1200 },
    x150: { x1: "https://cdn.mangabaka.dev/x150@1", x2: "https://cdn.mangabaka.dev/x150@2" },
    x250: { x1: "https://cdn.mangabaka.dev/x250@1", x2: "https://cdn.mangabaka.dev/x250@2" },
    x350: { x1: "https://cdn.mangabaka.dev/x350@1", x2: "https://cdn.mangabaka.dev/x350@2" },
  },
  authors: ["Tatsuki Fujimoto"],
  artists: ["Tatsuki Fujimoto"],
  description: "Denji was a small-time devil hunter…",
  year: 2018,
  status: "completed",
  content_rating: "suggestive",
  type: "manga",
  rating: 84.6205571428572,
  total_chapters: "232",
  final_volume: "24",
  genres: ["action", "boys_love"],
  tags: ["Slice of Life", "Arts & Crafts"],
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

void test("parseCount reads the API's string counts and rejects non-counts", () => {
  // total_chapters and final_volume are strings, not numbers — the whole reason
  // this helper exists.
  assert.equal(count("232"), 232);
  assert.equal(count(" 24 "), 24);
  assert.equal(count(12), 12);

  // Absent must stay distinguishable from zero, so nothing collapses to 0 or NaN.
  assert.equal(count(null), undefined);
  assert.equal(count(undefined), undefined);
  assert.equal(count(""), undefined);
  assert.equal(count("0"), undefined);
  assert.equal(count("unknown"), undefined);
});

void test("toId coerces display names into the bridge's permitted ID charset", () => {
  // A raw name used as an id is the exact crash LightNovelWorld shipped.
  assert.equal(toId("Slice of Life"), "slice_of_life");
  assert.equal(toId("Award Winning"), "award_winning");

  // Slugs already legal are left recognisable; underscore is inside the charset.
  assert.equal(toId("boys_love"), "boys_love");

  // Nothing survivable left over still yields a usable id rather than "".
  assert.equal(toId("   "), "unknown");
});

void test("toId output only ever contains legal ID characters", () => {
  const legal = /^[a-z0-9._\-@()[\]%?#+=/&:]+$/;

  for (const name of ["Slice of Life", "Arts & Crafts", "Sci‑Fi ⚔ Fantasy", "★★★", "日常"]) {
    assert.match(toId(name), legal, `"${name}" produced an illegal id`);
  }
});

void test("humanizeSlug renders a slug without needing the genre catalog", () => {
  assert.equal(humanizeSlug("boys_love"), "Boys Love");
  assert.equal(humanizeSlug("mahou_shoujo"), "Mahou Shoujo");
  assert.equal(humanizeSlug("action"), "Action");
});

void test("buildQuery repeats keys for array values and drops undefined", () => {
  assert.equal(buildQuery({ q: "chainsaw man", page: 2 }), "?q=chainsaw%20man&page=2");
  assert.equal(buildQuery({ genre: ["action", "comedy"] }), "?genre=action&genre=comedy");
  assert.equal(buildQuery({ q: undefined }), "");
  assert.equal(buildQuery({}), "");
});

// ---------------------------------------------------------------------------
// Series mapping
// ---------------------------------------------------------------------------

void test("mergedTargetId only redirects when the series was actually merged", () => {
  assert.equal(mergedTargetId(CHAINSAW_MAN), undefined);
  assert.equal(mergedTargetId({ id: 1, state: "merged", merged_with: 42 }), "42");

  // merged_with is populated but the series is still live — do not follow it.
  assert.equal(mergedTargetId({ id: 1, state: "active", merged_with: 42 }), undefined);
  assert.equal(mergedTargetId({ id: 1, state: "merged", merged_with: null }), undefined);
});

// Trimmed from live GET /v1/series/2. The point of this fixture is that is_primary is
// true on the Korean, English AND Japanese entries simultaneously.
const MULTILINGUAL: Series = {
  id: 2,
  title: "Lunar Legend Tsukihime",
  native_title: "真月譚 月姫",
  romanized_title: "Blue Blue Glass Moon, Under The Crimson Air.",
  titles: [
    { language: "ko", is_primary: true, traits: ["official"], title: "진월담 월희" },
    { language: "ja-Latn", is_primary: false, traits: [], title: "Legend of the Lunar Princess" },
    { language: "en", is_primary: false, traits: [], title: "Lunar Legend Chronicles" },
    { language: "en", is_primary: true, traits: ["official"], title: "Lunar Legend Tsukihime" },
    { language: "ja-Latn", is_primary: true, traits: ["native"], title: "Shingetsutan Tsukihime" },
    { language: "ru", is_primary: true, traits: [], title: "Повесть о Лунной Принцессе" },
  ],
};

void test("primaryTitle picks by language, not by whichever is_primary comes first", () => {
  // The reported bug: is_primary is per-language, so find(is_primary) returned the
  // Korean title for an English-language series purely because ko sorted first.
  assert.equal(primaryTitle(MULTILINGUAL), "Lunar Legend Tsukihime");
  assert.equal(primaryTitle(MULTILINGUAL, "english"), "Lunar Legend Tsukihime");
  assert.equal(primaryTitle(MULTILINGUAL, "romanized"), "Shingetsutan Tsukihime");
  assert.equal(primaryTitle(MULTILINGUAL, "native"), "真月譚 月姫");
});

void test("primaryTitle defaults to English", () => {
  assert.equal(primaryTitle(MULTILINGUAL), primaryTitle(MULTILINGUAL, "english"));
});

void test("primaryTitle falls back across languages when the preferred one is absent", () => {
  const koreanOnly: Series = {
    id: 3,
    titles: [{ language: "ko", is_primary: true, title: "한국어 제목" }],
  };

  // No English exists anywhere, so something readable is still returned.
  assert.equal(primaryTitle(koreanOnly, "english"), "한국어 제목");

  const englishOnly: Series = { id: 4, title: "Only English" };
  assert.equal(primaryTitle(englishOnly, "native"), "Only English");
});

void test("secondaryTitles follows the preference and never repeats the primary", () => {
  for (const preference of ["english", "romanized", "native"] as const) {
    const primary = primaryTitle(MULTILINGUAL, preference);
    const secondary = secondaryTitles(MULTILINGUAL, preference);

    assert.ok(!secondary.includes(primary), `${preference}: primary leaked into secondaries`);
    assert.equal(new Set(secondary).size, secondary.length, `${preference}: duplicates`);
  }
});

void test("primaryTitle uses titles[] when language-tagged, else the scalar fields", () => {
  assert.equal(primaryTitle(CHAINSAW_MAN), "Chainsaw Man");

  // Untagged titles[] entries cannot be language-matched, so MangaBaka's own display
  // title wins rather than an arbitrary is_primary entry in an unknown language.
  assert.equal(
    primaryTitle({
      id: 1,
      title: "Scalar Fallback",
      titles: [
        { traits: ["official"], title: "Untagged Official" },
        { traits: ["alternative"], title: "Untagged Flagged", is_primary: true },
      ],
    }),
    "Scalar Fallback",
  );

  // Within one language, is_primary is the tie-breaker it was always meant to be.
  assert.equal(
    primaryTitle({
      id: 1,
      titles: [
        { language: "en", traits: ["official"], title: "English Official" },
        { language: "en", traits: [], title: "English Flagged", is_primary: true },
      ],
    }),
    "English Flagged",
  );

  // Falls back down the chain when titles[] is absent or empty.
  assert.equal(primaryTitle({ id: 1, title: "Scalar Fallback" }), "Scalar Fallback");
  assert.equal(primaryTitle({ id: 1, romanized_title: "Romanized" }), "Romanized");
  assert.equal(primaryTitle({ id: 7 }), "MangaBaka #7");
});

void test("secondaryTitles excludes the primary and de-duplicates", () => {
  const secondary = secondaryTitles(CHAINSAW_MAN);

  assert.ok(!secondary.includes("Chainsaw Man"), "primary title leaked into secondaries");
  assert.ok(secondary.includes("チェンソーマン"));
  assert.ok(secondary.includes("Chain Saw Man"));
  assert.equal(new Set(secondary).size, secondary.length, "duplicate secondary titles");
});

void test("contentRatingOf maps the four ratings and fails safe on unknown", () => {
  assert.equal(contentRatingOf({ id: 1, content_rating: "safe" }), ContentRating.EVERYONE);
  assert.equal(contentRatingOf({ id: 1, content_rating: "suggestive" }), ContentRating.MATURE);
  assert.equal(contentRatingOf({ id: 1, content_rating: "erotica" }), ContentRating.ADULT);
  assert.equal(contentRatingOf({ id: 1, content_rating: "pornographic" }), ContentRating.ADULT);

  // An unrecognised value must not be treated as safe.
  assert.equal(contentRatingOf({ id: 1, content_rating: "brand_new" }), ContentRating.MATURE);
  assert.equal(contentRatingOf({ id: 1 }), ContentRating.MATURE);
});

void test("contentTypeOf marks novels and leaves every other type a comic", () => {
  assert.equal(contentTypeOf({ id: 1, type: "novel" }), "novel");
  assert.equal(contentTypeOf({ id: 1, type: "manga" }), "comic");
  assert.equal(contentTypeOf({ id: 1, type: "manhwa" }), "comic");
  assert.equal(contentTypeOf({ id: 1, type: "oel" }), "comic");
  assert.equal(contentTypeOf({ id: 1 }), "comic");
});

void test("coverUrl picks a sized proxy for thumbnails and the original for detail", () => {
  assert.equal(coverUrl(CHAINSAW_MAN, "thumbnail"), "https://cdn.mangabaka.dev/x250@2");
  assert.equal(coverUrl(CHAINSAW_MAN, "full"), "https://images.mangabaka.dev/raw.png");

  // Falls through the variants rather than emitting a broken empty cover.
  const rawOnly: Series = { id: 1, cover: { raw: { url: "https://example.invalid/raw.png" } } };
  assert.equal(coverUrl(rawOnly, "thumbnail"), "https://example.invalid/raw.png");
  assert.equal(coverUrl({ id: 1 }, "full"), undefined);
});

void test("coverUrl reads /v2's flattened cover, where every field is a bare string", () => {
  // Regression: /v2/series/discover/rising and /hidden-gems return cover.raw and
  // cover.x250 as plain URL strings rather than /v1's nested objects. Reading only
  // the v1 shape yielded "" and the app rejected it with `Invalid URL:`.
  const v2: Series = {
    id: 5307,
    cover: {
      raw: "https://images.mangabaka.dev/flat-raw",
      x150: "https://cdn.mangabaka.dev/flat-x150",
      x250: "https://cdn.mangabaka.dev/flat-x250",
      x350: "https://cdn.mangabaka.dev/flat-x350",
    },
  };

  assert.equal(coverUrl(v2, "thumbnail"), "https://cdn.mangabaka.dev/flat-x250");
  assert.equal(coverUrl(v2, "full"), "https://images.mangabaka.dev/flat-raw");
});

void test("coverUrl treats an all-null cover object as no cover", () => {
  // Regression: sort_by=latest surfaces brand-new entries carrying the full cover
  // structure with every value null. Series 599943 was one such live case.
  const empty: Series = {
    id: 599943,
    cover: {
      raw: { url: null },
      x150: { x1: null, x2: null, x3: null },
      x250: { x1: null, x2: null, x3: null },
      x350: { x1: null, x2: null, x3: null },
    },
  };

  assert.equal(coverUrl(empty, "thumbnail"), undefined);
  assert.equal(coverUrl(empty, "full"), undefined);
});

void test("mapped items always carry a non-empty imageUrl", () => {
  // The bridge rejects "" with `Invalid URL:`, so no mapper may ever emit one.
  const coverless: Series = { id: 599943, title: "No Art Yet", cover: { raw: { url: null } } };

  assert.equal(toSearchResultItem(coverless).imageUrl, PLACEHOLDER_COVER);
  assert.equal(toSimpleCarouselItem(coverless).imageUrl, PLACEHOLDER_COVER);
  assert.equal(toMangaInfo(coverless).thumbnailUrl, PLACEHOLDER_COVER);
  assert.notEqual(toSearchResultItem(coverless).imageUrl, "");
});

void test("toMangaInfo converts MangaBaka's 0-100 rating to Paperback's 0-1 fraction", () => {
  const info = toMangaInfo(CHAINSAW_MAN);

  // Paperback renders `rating` as a percentage and expects a fraction.
  assert.ok(info.rating !== undefined);
  assert.ok(Math.abs(info.rating - 0.846205571428572) < 1e-9);

  assert.equal(info.primaryTitle, "Chainsaw Man");
  assert.equal(info.contentType, "comic");
  assert.equal(info.status, "Completed");
  assert.equal(info.author, "Tatsuki Fujimoto");
  assert.equal(info.shareUrl, "https://mangabaka.org/1677");
  assert.equal(info.additionalInfo?.Chapters, "232");
  assert.equal(info.additionalInfo?.Volumes, "24");
});

void test("toMangaInfo omits rating entirely when the series is unrated", () => {
  assert.equal(toMangaInfo({ id: 1, rating: 0 }).rating, undefined);
  assert.equal(toMangaInfo({ id: 1 }).rating, undefined);
});

void test("tagSections sanitizes tag ids while keeping the readable title", () => {
  const sections = tagSections(CHAINSAW_MAN);
  const tags = sections.find((section) => section.id === "tags");

  assert.ok(tags);
  assert.deepEqual(
    tags.tags.map((tag) => tag.id),
    ["slice_of_life", "arts_&_crafts"],
  );
  // The display text keeps its spaces; only the id is coerced.
  assert.deepEqual(
    tags.tags.map((tag) => tag.title),
    ["Slice of Life", "Arts & Crafts"],
  );

  const genres = sections.find((section) => section.id === "genres");
  assert.deepEqual(
    genres?.tags.map((tag) => tag.title),
    ["Action", "Boys Love"],
  );
});

void test("toSearchResultItem disambiguates near-duplicates by type and year", () => {
  const item = toSearchResultItem(CHAINSAW_MAN);

  assert.equal(item.mangaId, "1677");
  assert.equal(item.title, "Chainsaw Man");
  assert.equal(item.subtitle, "Manga • 2018");
  assert.equal(item.contentRating, ContentRating.MATURE);

  // A novel spin-off shares the title, so the subtitle is what tells them apart.
  assert.equal(
    toSearchResultItem({
      id: 83072,
      title: "Chainsaw Man: Buddy Stories",
      type: "novel",
      year: 2021,
    }).subtitle,
    "Novel • 2021",
  );
});

void test("toGenreOptions keeps the slug as the id and the label as the title", () => {
  assert.deepEqual(
    toGenreOptions([
      { label: "Boys Love", value: "boys_love" },
      { label: null, value: "mahou_shoujo" },
      { label: "Broken", value: null },
    ]),
    [
      { id: "boys_love", title: "Boys Love" },
      { id: "mahou_shoujo", title: "Mahou Shoujo" },
    ],
  );
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

const SOURCE_MANGA: SourceManga = {
  mangaId: "1677",
  mangaInfo: toMangaInfo(CHAINSAW_MAN),
};

void test("progressChapter synthesises a chapter from stored progress", () => {
  const entry: LibraryEntry = { progress_chapter: 42, progress_volume: 5 };
  const chapter = progressChapter(entry, SOURCE_MANGA);

  assert.equal(chapter.chapterId, "42");
  assert.equal(chapter.chapNum, 42);
  assert.equal(chapter.volume, 5);
  assert.equal(chapter.langCode, "unknown");
  assert.equal(chapter.sourceManga, SOURCE_MANGA);
});

void test("progressChapter omits volume when there is none and defaults progress to 0", () => {
  const chapter = progressChapter({ progress_chapter: null, progress_volume: 0 }, SOURCE_MANGA);

  assert.equal(chapter.chapNum, 0);
  assert.equal(chapter.volume, undefined);
});

// ---------------------------------------------------------------------------
// Read queue
// ---------------------------------------------------------------------------

function action(id: string, mangaId: string, chapterNum: number): TrackedMangaChapterReadAction {
  return {
    id,
    sourceManga: { mangaId, mangaInfo: SOURCE_MANGA.mangaInfo },
    chapterId: `c-${id}`,
    chapterSourceId: "source",
    chapterMangaId: mangaId,
    chapterNum,
    creationDate: new Date("2026-08-12T00:00:00Z"),
    errorCount: 0,
  };
}

void test("collapseReadActions keeps only the highest chapter per manga", () => {
  const collapsed = collapseReadActions([
    action("a", "1", 1),
    action("b", "1", 5),
    action("c", "1", 3),
    action("d", "2", 9),
  ]);

  assert.equal(collapsed.length, 2);

  const first = collapsed.find((entry) => entry.action.sourceManga.mangaId === "1");
  assert.equal(first?.action.id, "b");
  // The lower chapters still get acknowledged — for free, with no request.
  assert.deepEqual(first?.supersededIds.sort(), ["a", "c"]);

  const second = collapsed.find((entry) => entry.action.sourceManga.mangaId === "2");
  assert.equal(second?.action.id, "d");
  assert.deepEqual(second?.supersededIds, []);
});

void test("collapseReadActions accounts for every queued id exactly once", () => {
  // The interface contract: anything left out of both result arrays is retried
  // forever, so nothing may be dropped or double-counted.
  const actions = [
    action("a", "1", 1),
    action("b", "1", 5),
    action("c", "2", 2),
    action("d", "3", 7),
    action("e", "3", 7),
  ];

  const seen = collapseReadActions(actions).flatMap((entry) => [
    entry.action.id,
    ...entry.supersededIds,
  ]);

  assert.equal(seen.length, actions.length);
  assert.deepEqual(seen.slice().sort(), ["a", "b", "c", "d", "e"]);
});

void test("collapseReadActions preserves decimal chapter numbers", () => {
  // Decimal chapters are real, and MangaBaka accepts fractional progress — flooring
  // here would silently roll 10.5 back to 10 and re-trigger the same write forever.
  const collapsed = collapseReadActions([action("a", "1", 10), action("b", "1", 10.5)]);

  assert.equal(collapsed.length, 1);
  assert.equal(collapsed[0]?.action.chapterNum, 10.5);
});

void test("collapseReadActions handles an empty queue", () => {
  assert.deepEqual(collapseReadActions([]), []);
});

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

void test("searchPath builds a query and omits empty filters", () => {
  assert.equal(
    searchPath({ query: "chainsaw man", page: 2, limit: 30, sort: "relevance_desc" }),
    "/v1/series/search?q=chainsaw%20man&page=2&limit=30&sort_by=relevance_desc",
  );

  // Browsing with no query is legal as long as one parameter is present — verified
  // live that sort_by alone satisfies the API's "at least one param" rule.
  assert.equal(
    searchPath({ sort: "trending_7d", limit: 30 }),
    "/v1/series/search?limit=30&sort_by=trending_7d",
  );

  // An empty title must not become `q=`.
  assert.equal(searchPath({ query: "", sort: "latest" }), "/v1/series/search?sort_by=latest");
});

void test("searchPath repeats multi-value filters", () => {
  assert.equal(
    searchPath({ sort: "latest", types: ["manga", "novel"], genresExcluded: ["boys_love"] }),
    "/v1/series/search?sort_by=latest&type=manga&type=novel&genre_not=boys_love",
  );
});

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

void test("snapRating rounds onto the account's score increment", () => {
  // rating_steps is a step size out of 100, so 25 is a four-point scale. An existing
  // off-grid score must land somewhere the stepper can actually reach.
  assert.equal(snapRating(85, 25), 75);
  assert.equal(snapRating(88, 25), 100);
  assert.equal(snapRating(85, 10), 90);
  assert.equal(snapRating(85, 20), 80);

  // The default increment leaves everything untouched.
  assert.equal(snapRating(85, 1), 85);
});

void test("snapRating stays inside 0-100 and treats unrated as zero", () => {
  assert.equal(snapRating(0, 25), 0);
  assert.equal(snapRating(-5, 25), 0);
  assert.equal(snapRating(1000, 25), 100);
  assert.equal(snapRating(98, 25), 100);

  // A nonsense increment must not produce NaN.
  assert.equal(snapRating(50, 0), 50);
  assert.equal(snapRating(Number.NaN, 25), 0);
});

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

void test("mangaBakaCookieJar keeps only mangabaka.org cookies", () => {
  const jar = mangaBakaCookieJar([
    { name: "session", value: "abc", domain: "mangabaka.org" },
    { name: "pref", value: "dark", domain: ".mangabaka.org" },
    { name: "cdn", value: "x", domain: "cdn.mangabaka.dev" },
    { name: "other", value: "y", domain: "example.com" },
  ]);

  // Leading-dot and bare domains are the same site; anything else is another host's.
  assert.deepEqual(
    [...jar.entries()],
    [
      ["session", "abc"],
      ["pref", "dark"],
    ],
  );
});

void test("mangaBakaCookieJar is empty when the WebView returned nothing usable", () => {
  assert.equal(mangaBakaCookieJar([]).size, 0);
  assert.equal(mangaBakaCookieJar([{ name: "a", value: "b", domain: "example.com" }]).size, 0);
});

void test("today formats a bare YYYY-MM-DD, zero-padded", () => {
  assert.equal(today(new Date("2026-08-13T12:34:56Z")), "2026-08-13");
  assert.equal(today(new Date("2026-01-05T00:00:00Z")), "2026-01-05");
});

// ---------------------------------------------------------------------------
// PKCE crypto
// ---------------------------------------------------------------------------

function hex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

void test("sha256 matches the FIPS 180-4 vectors", async () => {
  // A wrong digest would only surface as a failed login on device, so this is
  // pinned against the published vectors rather than a self-consistent value.
  assert.equal(
    hex(await sha256(utf8Bytes(""))),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.equal(
    hex(await sha256(utf8Bytes("abc"))),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(
    hex(await sha256(utf8Bytes("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"))),
    "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
  );
});

void test("sha256 handles inputs spanning multiple blocks", async () => {
  // 1,000,000 'a' is the classic vector; 200 chars alone would never cross the
  // 64-byte block boundary the padding logic depends on.
  assert.equal(
    hex(await sha256(utf8Bytes("a".repeat(1000)))),
    "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3",
  );
});

void test("base64UrlEncode is unpadded and URL-safe", () => {
  assert.equal(base64UrlEncode(utf8Bytes("")), "");
  assert.equal(base64UrlEncode(utf8Bytes("f")), "Zg");
  assert.equal(base64UrlEncode(utf8Bytes("fo")), "Zm8");
  assert.equal(base64UrlEncode(utf8Bytes("foo")), "Zm9v");
  assert.equal(base64UrlEncode(utf8Bytes("foobar")), "Zm9vYmFy");

  // Bytes that produce + and / in standard base64 must become - and _ here.
  assert.equal(base64UrlEncode([0xfb, 0xff, 0xfe]), "-__-");
  assert.doesNotMatch(base64UrlEncode([0xfb, 0xff, 0xfe]), /[+/=]/);
});

void test("pkceChallenge matches the RFC 7636 worked example", async () => {
  // The verifier and expected challenge are lifted straight from the RFC.
  assert.equal(
    await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

void test("randomVerifier is the right length and charset", () => {
  const verifier = randomVerifier();

  // RFC 7636 requires 43-128 characters from the unreserved set.
  assert.ok(verifier.length >= 43 && verifier.length <= 128);
  assert.match(verifier, /^[A-Za-z0-9\-._~]+$/);
  assert.notEqual(verifier, randomVerifier(), "two verifiers should not collide");
});

// ---------------------------------------------------------------------------
// OAuth plumbing
// ---------------------------------------------------------------------------

void test("parseQuery reads params off a custom-scheme redirect", () => {
  const query = parseQuery("paperback://mangabaka-auth?code=abc123&state=xyz");

  assert.equal(query.code, "abc123");
  assert.equal(query.state, "xyz");
  assert.deepEqual(parseQuery("paperback://mangabaka-auth"), {});
});

void test("parseQuery decodes percent- and plus-encoding", () => {
  const query = parseQuery("x://y?error=access_denied&error_description=Not+allowed%20here");

  assert.equal(query.error, "access_denied");
  assert.equal(query.error_description, "Not allowed here");
});

void test("headerValue finds Location whatever its casing", () => {
  // The bridge does not normalise header names.
  assert.equal(headerValue({ Location: "a" }, "location"), "a");
  assert.equal(headerValue({ location: "b" }, "Location"), "b");
  assert.equal(headerValue({ LOCATION: "c" }, "location"), "c");
  assert.equal(headerValue({ other: "d" }, "location"), undefined);
});

void test("authorizeUrl carries every parameter the flow needs", () => {
  const url = authorizeUrl({ challenge: "CHAL", state: "STATE" });

  assert.ok(url.startsWith("https://mangabaka.org/auth/oauth2/authorize?"));
  const query = parseQuery(url);
  assert.equal(query.response_type, "code");
  assert.equal(query.code_challenge, "CHAL");
  assert.equal(query.code_challenge_method, "S256");
  assert.equal(query.state, "STATE");
  assert.equal(query.redirect_uri, REDIRECT_URI);
  assert.equal(query.client_id, CLIENT_ID);
  // offline_access is what yields a refresh token.
  assert.ok(query.scope?.includes("offline_access"));
  // openid is not optional: without it every /v1/my/* call answers 401 "Missing
  // required scope" against a token the exchange accepted. Dropping it silently
  // breaks library sync, so it is pinned here.
  assert.ok(query.scope?.includes("openid"));
  // Omitted entirely unless asked for — an interactive request must not say prompt=none.
  assert.equal(query.prompt, undefined);
});

void test("authorizeUrl carries prompt when one is asked for", () => {
  // prompt=none is what makes the cookie login answer on the redirect URI in one hop
  // instead of bouncing through the sign-in UI a WebViewRow cannot complete.
  assert.equal(
    parseQuery(authorizeUrl({ challenge: "C", state: "S", prompt: "none" })).prompt,
    "none",
  );
  // prompt=consent forces the screen even when a grant already exists, which is what
  // makes re-approving after a scope change possible.
  assert.equal(
    parseQuery(authorizeUrl({ challenge: "C", state: "S", prompt: "consent" })).prompt,
    "consent",
  );
});

void test("readAuthorizeResponse returns the code when state and issuer match", () => {
  const outcome = readAuthorizeResponse(
    `${REDIRECT_URI}?code=abc123&state=STATE&iss=${encodeURIComponent(ISSUER)}`,
    "STATE",
  );

  assert.deepEqual(outcome, { kind: "code", code: "abc123" });
});

void test("readAuthorizeResponse reports errors rather than throwing", () => {
  // prompt=none answers a missing session this way, and the caller turns it into
  // advice rather than a failure — so it has to survive as structured data.
  assert.deepEqual(
    readAuthorizeResponse(
      `${REDIRECT_URI}?error=login_required&error_description=authentication+required&state=S`,
      "S",
    ),
    { kind: "error", error: "login_required", description: "authentication required" },
  );

  assert.deepEqual(readAuthorizeResponse(`${REDIRECT_URI}?error=consent_required&state=S`, "S"), {
    kind: "error",
    error: "consent_required",
  });
});

void test("readAuthorizeResponse rejects a mismatched state, on errors too", () => {
  assert.throws(
    () => readAuthorizeResponse(`${REDIRECT_URI}?code=abc&state=OTHER`, "STATE"),
    /State mismatch/,
  );

  // An error response is only believable if it is bound to this attempt as well.
  assert.throws(
    () => readAuthorizeResponse(`${REDIRECT_URI}?error=access_denied&state=OTHER`, "STATE"),
    /State mismatch/,
  );
});

void test("readAuthorizeResponse rejects a foreign issuer but tolerates its absence", () => {
  // RFC 9207: the server advertises iss support and sends it, so a wrong one is a
  // mix-up attack. Absent is still accepted — nothing else about the response changes.
  assert.throws(
    () => readAuthorizeResponse(`${REDIRECT_URI}?code=abc&state=S&iss=https://evil.example`, "S"),
    /wrong issuer/,
  );

  assert.deepEqual(readAuthorizeResponse(`${REDIRECT_URI}?code=abc&state=S`, "S"), {
    kind: "code",
    code: "abc",
  });
});

void test("redirectTargetFromBody reads the destination better-auth returns as JSON", () => {
  // The device failure this exists for: authorize answered 200 with the destination in
  // the body, no Location header, and the walk gave up with "HTTP 200 and no redirect"
  // against a session that was perfectly valid.
  assert.equal(
    redirectTargetFromBody(`{"redirectURI":"${REDIRECT_URI}?code=abc&state=S"}`),
    `${REDIRECT_URI}?code=abc&state=S`,
  );

  // Three spellings, depending on which better-auth code path answered.
  assert.equal(redirectTargetFromBody('{"redirect_uri":"https://a/b"}'), "https://a/b");
  assert.equal(redirectTargetFromBody('{"url":"https://a/c"}'), "https://a/c");
});

void test("redirectTargetFromBody yields undefined rather than throwing on junk", () => {
  // An HTML sign-in page is a perfectly ordinary thing to receive here.
  assert.equal(redirectTargetFromBody("<!doctype html><html></html>"), undefined);
  assert.equal(redirectTargetFromBody(""), undefined);
  assert.equal(redirectTargetFromBody("null"), undefined);
  assert.equal(redirectTargetFromBody('{"redirectURI":null}'), undefined);
  assert.equal(redirectTargetFromBody('{"other":"x"}'), undefined);
});

void test("readAuthorizeResponse rejects a response carrying neither code nor error", () => {
  assert.throws(
    () => readAuthorizeResponse(`${REDIRECT_URI}?state=S`, "S"),
    /neither a code nor an error/,
  );
});

void test("parseSetCookie splits multiple cookies without breaking on Expires dates", () => {
  // The pending-authorization cookie arrives on the authorize response, and losing it
  // is what made the consent call fail with "missing oauth query".
  assert.deepEqual(parseSetCookie("oidc_consent_prompt=abc123; Path=/; HttpOnly"), [
    ["oidc_consent_prompt", "abc123"],
  ]);

  // A comma inside Expires must not be mistaken for a cookie separator.
  assert.deepEqual(
    parseSetCookie("a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/, b=2; Path=/"),
    [
      ["a", "1"],
      ["b", "2"],
    ],
  );

  assert.deepEqual(parseSetCookie(undefined), []);
  assert.deepEqual(parseSetCookie(""), []);
});

void test("encodeForm escapes values", () => {
  assert.equal(
    encodeForm({ grant_type: "authorization_code", redirect_uri: "paperback://cb" }),
    "grant_type=authorization_code&redirect_uri=paperback%3A%2F%2Fcb",
  );
});

void test("tokensExpired respects the refresh margin", () => {
  const now = 1_000_000;

  // No expiry known: never treated as expired.
  assert.equal(tokensExpired({ accessToken: "a" }, now), false);

  assert.equal(tokensExpired({ accessToken: "a", expiresAtMs: now + 600_000 }, now), false);
  // Inside the one-minute margin, and already past.
  assert.equal(tokensExpired({ accessToken: "a", expiresAtMs: now + 30_000 }, now), true);
  assert.equal(tokensExpired({ accessToken: "a", expiresAtMs: now - 1 }, now), true);
});
