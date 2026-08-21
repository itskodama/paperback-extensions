/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import {
  applyKeystream,
  KNOWN_OFFSETS,
  parseScrambleConfig,
  tileOrder,
} from "../../src/Comix/descramble.ts";
import { isOurRequest, looksLikeChallengePage, trackOwnRequest } from "../../src/Comix/http.ts";
import {
  CONTENT_RATINGS,
  DEMOGRAPHICS,
  FORMATS,
  GENRES,
  SORT_OPTIONS,
  STATUSES,
  TYPES,
  type ChapterItem,
  type MangaDetail,
} from "../../src/Comix/models.ts";
import {
  ageToDate,
  chapterPagesRemain,
  contentRatingOf,
  extractInitialData,
  findQuery,
  mangaSummaries,
  parseChapterPayload,
  parsePagesPayload,
  posterUrl,
  queryItems,
  toChapter,
  toSearchResultItem,
  toSourceManga,
} from "../../src/Comix/parsers.ts";

// --- initial-data extraction ---

function page(queries: Record<string, unknown>): string {
  return `<html><head><script id="initial-data" type="application/json">${JSON.stringify({
    queries,
  })}</script></head><body></body></html>`;
}

void test("initial-data is read out of the script tag without an HTML parser", () => {
  const queries = extractInitialData(page({ '["manga","detail","qqwrm"]': { hid: "qqwrm" } }));
  assert.deepEqual(Object.keys(queries), ['["manga","detail","qqwrm"]']);
});

void test("a page with no initial-data fails loudly rather than yielding nothing", () => {
  assert.throws(() => extractInitialData("<html><body>challenge</body></html>"), /no initial-data/);
});

void test("query keys are matched as decoded arrays, not by substring", () => {
  const queries = extractInitialData(
    page({
      '["manga","recommended","qqwrm",1]': { items: [{ hid: "other", title: "Other" }] },
      '["manga","detail","qqwrm"]': { hid: "qqwrm", title: "Full-Time Awakening" },
    }),
  );

  const detail = findQuery(
    queries,
    (key) => key[0] === "manga" && key[1] === "detail",
  ) as MangaDetail;
  assert.equal(detail.title, "Full-Time Awakening");
});

// The two biggest homepage sections use the bare-array form; a reader that only
// understands {items} drops them silently, which is exactly how the first pass
// at this parser lost 100 titles.
void test("discover queries parse in both the bare-array and {items} shapes", () => {
  const bare = [{ hid: "a", title: "A" }];
  const wrapped = { items: [{ hid: "b", title: "B" }], meta: { page: 1 } };

  assert.deepEqual(queryItems(bare), bare);
  assert.deepEqual(queryItems(wrapped), wrapped.items);
  assert.deepEqual(queryItems(undefined), []);
  assert.deepEqual(queryItems({ nope: 1 }), []);
});

void test("entries missing hid or title are dropped rather than becoming blank rows", () => {
  const summaries = mangaSummaries([{ hid: "a", title: "A" }, { hid: "b" }, { title: "C" }, null]);
  assert.deepEqual(
    summaries.map((manga) => manga.hid),
    ["a"],
  );
});

// --- manga mapping ---

const detail: MangaDetail = {
  id: 67283,
  hid: "qqwrm",
  title: "Full-Time Awakening",
  altTitles: ["5(All) Elements", "全职觉醒"],
  status: "releasing",
  contentRating: "safe",
  synopsis: "Bai Yi is betrayed by a comrade.",
  ratedAvg: 76,
  url: "/title/qqwrm-full-time-awakening",
  poster: {
    medium: "https://static.comix.to/9c57/i/8/6d/abc@280.jpg",
    large: "https://static.comix.to/9c57/i/8/6d/abc.jpg",
  },
  genres: [{ id: 6, title: "Action", slug: "action" }],
  tags: [{ id: 98872, title: "Full Color", slug: "full-color" }],
  authors: [{ id: 2602, title: "TONY", slug: "tony" }],
  artists: [{ id: 2603, title: "TONY", slug: "tony" }],
};

void test("the large poster is preferred, falling back to medium then empty", () => {
  assert.equal(posterUrl(detail), "https://static.comix.to/9c57/i/8/6d/abc.jpg");
  assert.equal(posterUrl({ id: 1, hid: "x", title: "X", poster: { medium: "m.jpg" } }), "m.jpg");
  assert.equal(posterUrl({ id: 1, hid: "x", title: "X" }), "");
});

// Every item in every payload carries a rating, so the app's own content filter
// does the work — but only if adult material is labelled ADULT. Collapsing it
// into MATURE lets it past a filter set to exclude it.
void test("all four site ratings map onto the app's three levels", () => {
  const rated = (contentRating: string) =>
    contentRatingOf({ id: 1, hid: "x", title: "X", contentRating });

  assert.equal(rated("safe"), ContentRating.EVERYONE);
  assert.equal(rated("suggestive"), ContentRating.MATURE);
  assert.equal(rated("erotica"), ContentRating.ADULT);
  assert.equal(rated("pornographic"), ContentRating.ADULT);
});

void test("an unknown or absent rating is mature, never promoted to everyone", () => {
  assert.equal(
    contentRatingOf({ id: 1, hid: "x", title: "X", contentRating: "brand-new" }),
    ContentRating.MATURE,
  );
  assert.equal(contentRatingOf({ id: 1, hid: "x", title: "X" }), ContentRating.MATURE);
  assert.equal(contentRatingOf(detail), ContentRating.EVERYONE);
});

void test("hid is the mangaId, never the numeric id", () => {
  assert.equal(toSearchResultItem(detail).mangaId, "qqwrm");
  assert.equal(toSourceManga(detail).mangaId, "qqwrm");
});

void test("detail maps into MangaInfo with tag groups and a share url", () => {
  const manga = toSourceManga(detail);

  assert.equal(manga.mangaInfo.primaryTitle, "Full-Time Awakening");
  assert.deepEqual(manga.mangaInfo.secondaryTitles, ["5(All) Elements", "全职觉醒"]);
  assert.equal(manga.mangaInfo.author, "TONY");
  // ratedAvg is a percentage while the app renders `rating` as a 0-1 fraction.
  // Dividing by 10 rather than 100 is what showed a 93% title as 930%.
  assert.equal(manga.mangaInfo.rating, 0.76);
  assert.equal(manga.mangaInfo.shareUrl, "https://comix.to/title/qqwrm-full-time-awakening");
  assert.deepEqual(
    manga.mangaInfo.tagGroups?.map((group) => group.id),
    ["genres", "tags"],
  );
});

void test("rating is a 0-1 fraction and clamps rather than exceeding 100%", () => {
  assert.equal(toSourceManga({ ...detail, ratedAvg: 93 }).mangaInfo.rating, 0.93);
  assert.equal(toSourceManga({ ...detail, ratedAvg: 0 }).mangaInfo.rating, 0);
  assert.equal(toSourceManga({ ...detail, ratedAvg: 140 }).mangaInfo.rating, 1);
});

void test("empty taxonomies are omitted rather than emitted as blank groups", () => {
  const bare = toSourceManga({ id: 1, hid: "x", title: "X" });
  assert.equal(bare.mangaInfo.tagGroups, undefined);
  assert.equal(bare.mangaInfo.author, undefined);
  assert.equal(bare.mangaInfo.synopsis, "");
});

// --- chapters ---

const sourceManga = { mangaId: "nkye", mangaInfo: {} } as unknown as SourceManga;

function chapterItem(overrides: Partial<ChapterItem> = {}): ChapterItem {
  return {
    id: 11237384,
    mangaId: 3877,
    number: 43,
    volume: 4,
    name: "",
    language: "en",
    group: { id: 1003, name: "I Get No Females Translations" },
    ...overrides,
  };
}

void test("chapterId is the chapter's own id, and the payload's numeric mangaId is ignored", () => {
  const chapter = toChapter(chapterItem(), sourceManga);
  assert.equal(chapter.chapterId, "11237384");
  assert.equal(chapter.sourceManga.mangaId, "nkye");
});

// Several groups translate the same series, so chapNum repeats. version is what
// keeps them apart — see docs/paperback/chapters.md.
void test("the scanlation group becomes version so duplicate numbers do not collapse", () => {
  assert.equal(toChapter(chapterItem(), sourceManga).version, "I Get No Females Translations");
  assert.equal(toChapter(chapterItem({ group: null }), sourceManga).version, undefined);
});

void test("a blank chapter name yields no title rather than an empty one", () => {
  assert.equal(toChapter(chapterItem(), sourceManga).title, undefined);
  assert.equal(toChapter(chapterItem({ name: "   " }), sourceManga).title, undefined);
  assert.equal(toChapter(chapterItem({ name: "The End" }), sourceManga).title, "The End");
});

void test("decimal chapter numbers survive, including when sent as strings", () => {
  assert.equal(toChapter(chapterItem({ number: 43.5 }), sourceManga).chapNum, 43.5);
  assert.equal(toChapter(chapterItem({ number: "12.5" }), sourceManga).chapNum, 12.5);
  assert.equal(toChapter(chapterItem({ number: "oops" }), sourceManga).chapNum, 0);
});

// Omitting `volume` is what makes the app render "Vol. TBA"; an unvolumed
// chapter has to say so with an explicit 0. See src/AsuraScans/comics.ts.
void test("an unvolumed chapter sets volume 0 rather than leaving it out", () => {
  const unvolumed = toChapter(chapterItem({ volume: 0 }), sourceManga);
  assert.equal(unvolumed.volume, 0);
  assert.equal("volume" in unvolumed, true);
  assert.equal(toChapter(chapterItem({ volume: 4 }), sourceManga).volume, 4);
});

void test("optional fields other than volume are omitted when absent", () => {
  const bare = toChapter(
    chapterItem({ name: "", volume: 0, group: null, url: undefined }),
    sourceManga,
  );
  assert.deepEqual(Object.keys(bare).sort(), [
    "chapNum",
    "chapterId",
    "langCode",
    "sourceManga",
    "volume",
  ]);
});

// The reader cannot rebuild `/title/<hid>-<slug>/<id>-chapter-<n>` from the ids,
// so getChapters has to carry it forward.
void test("the chapter's own path is recorded for the page fetch", () => {
  const withUrl = toChapter(
    chapterItem({ url: "/title/nkye-kono/11237384-chapter-43" }),
    sourceManga,
  );
  assert.equal(withUrl.additionalInfo?.url, "/title/nkye-kono/11237384-chapter-43");
});

void test("pagination continues while meta says another page exists", () => {
  const meta = { total: 43, perPage: 30, page: 1, lastPage: 2, hasNext: true, hasPrev: false };
  assert.equal(chapterPagesRemain({ result: { meta } }), true);
  assert.equal(
    chapterPagesRemain({ result: { meta: { ...meta, page: 2, hasNext: false } } }),
    false,
  );
  assert.equal(chapterPagesRemain({ result: {} }), false);
});

void test("a chapter payload maps every item and tolerates an empty result", () => {
  const chapters = parseChapterPayload(
    { result: { items: [chapterItem(), chapterItem({ id: 2, number: 44 })] } },
    sourceManga,
  );
  assert.deepEqual(
    chapters.map((chapter) => chapter.chapNum),
    [43, 44],
  );
  assert.deepEqual(parseChapterPayload({}, sourceManga), []);
});

// --- pages ---

void test("absolute page urls pass through and relative ones resolve against baseUrl", () => {
  assert.deepEqual(
    parsePagesPayload({
      result: {
        pages: {
          baseUrl: "",
          items: [
            { width: 1439, height: 2045, url: "https://jdpw.wowpic2.store/i5/token-one" },
            { width: 1439, height: 2045, url: "https://jdpw.wowpic2.store/i5/token-two" },
          ],
        },
      },
    }),
    ["https://jdpw.wowpic2.store/i5/token-one", "https://jdpw.wowpic2.store/i5/token-two"],
  );

  assert.deepEqual(
    parsePagesPayload({
      result: { pages: { baseUrl: "https://cdn.example.test", items: [{ url: "/i5/token" }] } },
    }),
    ["https://cdn.example.test/i5/token"],
  );
});

void test("blank page entries are dropped and a missing payload yields no pages", () => {
  assert.deepEqual(
    parsePagesPayload({ result: { pages: { items: [{ url: "" }, { url: "https://a.test/x" }] } } }),
    ["https://a.test/x"],
  );
  assert.deepEqual(parsePagesPayload({}), []);
});

// --- image descrambling ---

void test("no scramble headers means the response is passed through untouched", () => {
  assert.equal(parseScrambleConfig({}), undefined);
  assert.equal(parseScrambleConfig({ "content-type": "image/jpeg" }), undefined);
  assert.equal(parseScrambleConfig({ "x-enc-seed": "0", "x-enc-len": "0" }), undefined);
});

// Header names are not case-normalised by the platform, so a source that reads
// them with a literal key silently sees an unscrambled image as scrambled.
void test("scramble headers are read case-insensitively", () => {
  const config = parseScrambleConfig({ "X-Enc-Seed": "12345", "X-ENC-LEN": "512" });
  assert.equal(config?.encSeed, 12345);
  assert.equal(config?.encLength, 512);
});

// The offset is no longer folded in at parse time: an unrecognised token is
// resolved against the image later, so the raw seed and token both survive.
void test("the raw seed and hash token are carried through for later resolution", () => {
  const known = parseScrambleConfig({
    "x-scramble-grid": "5x5",
    "x-scramble-seed": "1000",
    "x-scramble-hash": "03632",
  });
  assert.deepEqual([known?.scrambleSeedRaw, known?.scrambleHash], [1000, "03632"]);
  assert.equal(known?.gridded, true);

  const unknown = parseScrambleConfig({
    "x-scramble-grid": "5x5",
    "x-scramble-seed": "1000",
    "x-scramble-hash": "whatever",
  });
  assert.deepEqual([unknown?.scrambleSeedRaw, unknown?.scrambleHash], [1000, "whatever"]);
});

// Only algo 3 is 5x5-bound; the LCG variants shuffle any grid, so the
// dimensions are read from the header rather than assumed.
void test("grid dimensions are read from the header, not assumed to be 5x5", () => {
  const square = parseScrambleConfig({ "x-scramble-grid": "5x5", "x-scramble-seed": "1000" });
  assert.deepEqual([square?.cols, square?.rows], [5, 5]);

  const oblong = parseScrambleConfig({ "x-scramble-grid": "4x6", "x-scramble-seed": "1000" });
  assert.deepEqual([oblong?.cols, oblong?.rows], [4, 6]);
  assert.equal(oblong?.gridded, true);
});

void test("a malformed or seedless grid is not treated as scrambled", () => {
  assert.equal(
    parseScrambleConfig({ "x-scramble-grid": "wat", "x-scramble-seed": "1000" }),
    undefined,
  );
  assert.equal(
    parseScrambleConfig({ "x-scramble-grid": "5x5", "x-scramble-seed": "0" }),
    undefined,
  );
});

// The permutation is a pure function of the seed, so an arbitrary grid still
// produces a complete permutation of its own tile count.
void test("non-square grids still permute every tile exactly once", () => {
  const order = tileOrder(4242, undefined, 24);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, i) => i),
  );
});

// XOR against a deterministic keystream is its own inverse, which is what makes
// a round-trip the honest test: no fixture can prove the generator matches the
// site, but this proves the generator is stable and self-cancelling.
void test("both keystream generators round-trip and only touch the keyed prefix", () => {
  for (const algo of [undefined, "2"]) {
    const plain = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    const encoded = applyKeystream(plain, 987654321, 32, algo);

    assert.notDeepEqual(Array.from(encoded.slice(0, 32)), Array.from(plain.slice(0, 32)));
    assert.deepEqual(Array.from(encoded.slice(32)), Array.from(plain.slice(32)));
    assert.deepEqual(Array.from(applyKeystream(encoded, 987654321, 32, algo)), Array.from(plain));
  }
});

void test("a keyed length beyond the buffer is clamped instead of overrunning", () => {
  const plain = Uint8Array.from([1, 2, 3]);
  const encoded = applyKeystream(plain, 42, 9999);
  assert.equal(encoded.length, 3);
  assert.deepEqual(Array.from(applyKeystream(encoded, 42, 9999)), [1, 2, 3]);
});

void test("tile order is a permutation of all 25 tiles for both shuffle algorithms", () => {
  for (const algo of [undefined, "3"]) {
    const order = tileOrder(123456, algo);
    assert.equal(order.length, 25);
    assert.deepEqual(
      [...order].sort((a, b) => a - b),
      Array.from({ length: 25 }, (_, i) => i),
    );
  }
});

void test("tile order is deterministic per seed and differs between seeds", () => {
  assert.deepEqual(tileOrder(555), tileOrder(555));
  assert.notDeepEqual(tileOrder(555), tileOrder(556));
  assert.notDeepEqual(tileOrder(555), tileOrder(555, "3"));
});

// --- relative chapter ages ---

const NOW = Date.UTC(2026, 7, 19, 12, 0, 0);
const agedAt = (formatted: string) => ageToDate(formatted, NOW)?.toISOString();

// The API never sends a timestamp, only a rendered age, so publishDate is always
// an approximation — but the units have to be read correctly or the list sorts wrongly.
void test("relative ages parse to approximate dates", () => {
  assert.equal(agedAt("1h ago"), new Date(NOW - 3_600_000).toISOString());
  assert.equal(agedAt("3d ago"), new Date(NOW - 3 * 86_400_000).toISOString());
  assert.equal(agedAt("2w ago"), new Date(NOW - 2 * 604_800_000).toISOString());
  assert.equal(agedAt("1y ago"), new Date(NOW - 31_557_600_000).toISOString());
});

// `m` is minutes and `mos` is months — five orders of magnitude apart, and the
// obvious regex matches `m` first.
void test("minutes and months are not confused", () => {
  assert.equal(agedAt("8m ago"), new Date(NOW - 8 * 60_000).toISOString());
  assert.equal(agedAt("6mos ago"), new Date(NOW - 6 * 2_629_800_000).toISOString());

  const minutes = ageToDate("8m ago", NOW)?.getTime() ?? 0;
  const months = ageToDate("8mos ago", NOW)?.getTime() ?? 0;
  assert.ok(months < minutes, "8 months must be older than 8 minutes");
});

void test("an unparseable age yields no date rather than an invalid one", () => {
  assert.equal(ageToDate(undefined), undefined);
  assert.equal(ageToDate(""), undefined);
  assert.equal(ageToDate("just now"), undefined);
  assert.equal(ageToDate("ages ago"), undefined);
});

void test("a chapter carries its approximate publish date", () => {
  const chapter = toChapter(chapterItem({ createdAtFormatted: "1h ago" }), sourceManga);
  assert.ok(chapter.publishDate instanceof Date);
  assert.equal(
    "publishDate" in toChapter(chapterItem({ createdAtFormatted: "" }), sourceManga),
    false,
  );
});

// --- filter catalogue ---

// Every value here was taken from requests the site's own browse UI issued; a
// typo would fail silently as an ignored filter rather than an error.
void test("filter ids match what the site's own browse requests send", () => {
  assert.deepEqual(
    CONTENT_RATINGS.map((option) => option.id),
    ["safe", "suggestive", "erotica", "pornographic"],
  );
  assert.deepEqual(
    TYPES.map((option) => option.id),
    ["manga", "manhwa", "manhua", "other"],
  );
  assert.deepEqual(STATUSES.map((option) => option.id).sort(), [
    "discontinued",
    "finished",
    "not_yet_released",
    "on_hiatus",
    "releasing",
  ]);
  assert.deepEqual(
    DEMOGRAPHICS.map((option) => option.id),
    ["1", "2", "3", "4"],
  );
});

void test("genre and format ids are numeric and unique", () => {
  const ids = [...GENRES, ...FORMATS].map((option) => option.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^\d+$/.test(id)));
  assert.equal(GENRES.find((option) => option.title === "Isekai")?.id, "16");
  assert.equal(FORMATS.find((option) => option.title === "Long Strip")?.id, "93170");
});

// A sort id is `<field>:<direction>`; the site wants `order[<field>]=<direction>`.
void test("every sort id splits into a field and a direction", () => {
  SORT_OPTIONS.forEach((option) => {
    const [field, direction] = option.id.split(":");
    assert.ok(field && field.length > 0, `${option.id} has no field`);
    assert.ok(direction === "asc" || direction === "desc", `${option.id} has no direction`);
  });
});

// --- rate limiting scope ---

// Pacing keys off a registry of requests this extension issued, not off the URL.
// The site's page runs in the same WebView and its requests reach the same
// interceptors, so recognising ours by path meant guessing at everything the page
// might fetch — a guess that missed Cloudflare's /cdn-cgi/ scripts and cost about
// a third of every chapter walk.
void test("a request is ours only while it is in flight", () => {
  const url = "https://comix.to/title/qqwrm";
  assert.equal(isOurRequest(url), false);

  const release = trackOwnRequest(url);
  assert.equal(isOurRequest(url), true);
  release();
  assert.equal(isOurRequest(url), false);
});

void test("concurrent fetches of one url do not release it early", () => {
  const url = "https://comix.to/";
  const first = trackOwnRequest(url);
  const second = trackOwnRequest(url);

  first();
  assert.equal(isOurRequest(url), true, "still held by the second fetch");
  second();
  assert.equal(isOurRequest(url), false);
});

// Bundles, the API, avatars, Cloudflare's own scripts and page images on their
// CDNs are never paced, because this extension never issued them.
void test("nothing the page fetches for itself is ever paced", () => {
  [
    "https://comix.to/assets/build/abc/dist/main.js",
    "https://comix.to/api/v1/manga/qqwrm/chapters?page=2",
    "https://comix.to/images/avatars/84/84894.webp",
    "https://comix.to/cdn-cgi/challenge-platform/scripts/jsd/main.js",
    "https://jloo.wowpic2.store/i5/token",
    "https://static.comix.to/9c57/i/8/6d/abc.jpg",
  ].forEach((url) => assert.equal(isOurRequest(url), false, url));
});

// --- Cloudflare interstitial detection ---

void test("a challenge interstitial is recognised so the mirror gets tried", () => {
  assert.ok(looksLikeChallengePage("<html><head><title>Just a moment...</title></head>"));
  assert.ok(looksLikeChallengePage('<html><script>window._cf_chl_opt={cvId:"3"};</script>'));
  assert.ok(looksLikeChallengePage('<div class="cf-browser-verification">'));
});

void test("a healthy page carrying Cloudflare's beacon is not mistaken for a challenge", () => {
  // Cloudflare injects challenge-platform into ordinary pages; treating that as
  // an interstitial would condemn every good response and fail over forever.
  const healthy =
    "<html><head><title>Magic Emperor</title>" +
    '<script src="/cdn-cgi/challenge-platform/h/b/scripts/jsd/main.js"></script>' +
    '</head><body><script id="initial-data">{"queries":{}}</script></body></html>';
  assert.equal(looksLikeChallengePage(healthy), false);
});

void test("every known scramble offset is inside the swept search space", () => {
  // resolveOffset only sweeps [0, 2^18); a shipped offset above it could never
  // be rediscovered if the table were ever lost.
  for (const [token, offset] of Object.entries(KNOWN_OFFSETS)) {
    assert.ok(offset > 0 && offset < 1 << 18, `${token} -> ${offset} outside the sweep`);
  }
  assert.equal(KNOWN_OFFSETS["33317"], 261410);
  assert.equal(KNOWN_OFFSETS["47bc1"], 168100);
});
