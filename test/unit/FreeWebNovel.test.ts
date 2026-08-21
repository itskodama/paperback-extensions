/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import { balancedDiv, removeDivs, safeId, toXhtmlDocument } from "../../src/FreeWebNovel/html.ts";
import {
  genreChipItems,
  matchesFilters,
  toChapters,
  toSearchResultItem,
  toSourceManga,
} from "../../src/FreeWebNovel/mappers.ts";
import { GENRES } from "../../src/FreeWebNovel/models.ts";
import {
  parseChapterBody,
  parseChapterList,
  parseListing,
  parseNovelDetail,
  parseRelativeTime,
  stripChapterNumber,
} from "../../src/FreeWebNovel/parsers.ts";
import { advancedSearchUrl, genreUrl, searchUrl, sortUrl } from "../../src/FreeWebNovel/urls.ts";

const sourceManga: SourceManga = {
  mangaId: "apocalypse-gachapon",
  mangaInfo: {
    thumbnailUrl: "https://freewebnovel.com/files/article/image/3/3612/3612s.jpg",
    synopsis: "",
    primaryTitle: "Apocalypse Gachapon",
    secondaryTitles: [],
    contentRating: ContentRating.MATURE,
    contentType: "novel",
  },
};

// --- Chapter numbering: the URL index is the only monotonic number on this site ---

// Trimmed from a live `?ajax=chapters` response. The point of this fixture is that
// the title numbers (2185, 2213) disagree with the URL indices (2401, 2429) by an
// amount that is not constant — across the full novel it takes 428 distinct values.
const CHAPTER_LIST_JSON = {
  code: 200,
  page: 13,
  pageSize: 200,
  totalPage: 13,
  totalChapters: 2429,
  html: [
    '<li><a href="/novel/apocalypse-gachapon/chapter-2401" title="Chapter 2185: First stage benefits" class="con">x</a></li>',
    '<li><a href="/novel/apocalypse-gachapon/chapter-2402" title="Chapter 2186: Fusion Method" class="con">x</a></li>',
    '<li><a href="/novel/apocalypse-gachapon/chapter-2429" title="Chapter 2213 - 40 closeness" class="con">x</a></li>',
  ].join(""),
};

void test("chapNum follows the URL index, not the number embedded in the title", () => {
  const page = parseChapterList(CHAPTER_LIST_JSON);
  assert.deepEqual(
    page.entries.map((entry) => [entry.index, entry.title]),
    [
      [2401, "First stage benefits"],
      [2402, "Fusion Method"],
      [2429, "40 closeness"],
    ],
  );
  assert.equal(page.totalPage, 13);
  assert.equal(page.totalChapters, 2429);
});

void test("chapter numbers stay unique and increasing so version priority cannot collapse them", () => {
  const chapters = toChapters(parseChapterList(CHAPTER_LIST_JSON).entries, sourceManga);
  const numbers = chapters.map((chapter) => chapter.chapNum);

  assert.deepEqual(numbers, [2401, 2402, 2429]);
  assert.equal(new Set(numbers).size, numbers.length, "chapter numbers collided");
  for (let i = 1; i < numbers.length; i++) {
    assert.ok(numbers[i]! > numbers[i - 1]!, `not increasing at ${i}`);
  }
});

void test("chapterId round-trips into the chapter URL", () => {
  const chapters = toChapters([{ index: 2429, title: "40 closeness" }], sourceManga);
  assert.equal(chapters[0]!.chapterId, "2429");
});

// `volume` unset renders as "Vol. TBA"; this site has no volume concept.
void test("every chapter declares volume 0", () => {
  const chapters = toChapters([{ index: 1 }, { index: 2 }], sourceManga);
  for (const chapter of chapters) assert.equal(chapter.volume, 0);
});

// A numbered title with nothing after the number leaves no title at all, and the
// key must be absent rather than undefined.
void test("a chapter with no title text omits the key entirely", () => {
  const chapters = toChapters([{ index: 7 }], sourceManga);
  assert.equal("title" in chapters[0]!, false);
});

// --- Title stripping: the app already renders "Chapter {chapNum} - {title}" ---

void test("the three title shapes this site emits all lose their leading number", () => {
  assert.equal(stripChapterNumber("Chapter 1: Return", 1), "Return");
  assert.equal(
    stripChapterNumber("Chapter 3160 Rushing Towards a Nightmare", 3160),
    "Rushing Towards a Nightmare",
  );
  assert.equal(stripChapterNumber("c-1: Prologue: Start", 1), "Prologue: Start");
});

// A bare leading number that equals the index is the "1 Nightmare Begins" case from
// docs/paperback/chapters.md — it would otherwise read "Chapter 1 - 1 Nightmare Begins".
void test("a bare leading number equal to the index is stripped", () => {
  assert.equal(stripChapterNumber("1 Nightmare Begins", 1), "Nightmare Begins");
});

// "Chapter 2213 - 40 closeness" at index 2429: the 40 is the site's own sub-numbering,
// not a duplicate of the chapter number, so eating it would lose real title text.
void test("a leading number that is not the index survives", () => {
  assert.equal(stripChapterNumber("Chapter 2213 - 40 closeness", 2429), "40 closeness");
});

void test("a title carrying no number at all is left alone", () => {
  assert.equal(stripChapterNumber("Book", 425), "Book");
  assert.equal(stripChapterNumber("Book Hider (2)", 2169), "Book Hider (2)");
});

void test("a title that is only its own number yields no title", () => {
  assert.equal(stripChapterNumber("Chapter 88", 88), undefined);
});

// --- Listings: one markup serves search, filtered search, /sort and /genre ---

// Trimmed from a live /sort/most-popular page. Note the row prints two genres where
// the novel has five — that truncation is why inclusion filtering cannot run here.
const LISTING_HTML = `
<div class="ul-list1 ul-list1-2 ss-custom rank-list">
  <div class="li-row"><div class="li"><div class="con">
    <div class="pic"><a href="/novel/shadow-slave"><picture><source srcset="/cache/cover-webp/1/1991/x.webp 100w"><img src="/files/article/image/1/1991/1991s.jpg" alt="Shadow Slave"></picture></a></div>
    <div class="txt">
      <h3 class="tit"><a href="/novel/shadow-slave" title="Shadow Slave">Shadow Slave</a></h3>
      <div class="core"><span>4.6</span><i></i></div>
      <div class="desc">
        <div class="item"><div class="right"><em class="e1"><a href="/sort/latest-release/english-novel" class="novel" title="English Novel">English Novel</a></em></div></div>
        <div class="item"><div class="right"><a href="/genre/Action" class="novel" title="Action Novels">Action</a>, <a href="/genre/Smut" class="novel" title="Smut Novels">Smut</a></div></div>
        <div class="item"><div class="right"><a href="/novel/shadow-slave/chapter-3160" class="chapter" title="Chapter 3160"><span class="s1">3160 Chapters</span></a></div></div>
      </div>
    </div>
  </div></div></div>
</div>
<div class="pages advanced-pages"><ul><li><span class="jump-pc"><a href="/x">1</a><strong>1</strong><a href="/x/2">2</a><a href="/x/5">&gt;&gt;</a><a href="/x/5">5</a></span></li></ul></div>
`;

void test("a listing row yields every field the search screen renders", () => {
  const listing = parseListing(LISTING_HTML);
  assert.equal(listing.rows.length, 1);
  assert.deepEqual(listing.rows[0], {
    slug: "shadow-slave",
    title: "Shadow Slave",
    thumbnailUrl: "https://freewebnovel.com/files/article/image/1/1991/1991s.jpg",
    genres: ["Action", "Smut"],
    language: "English",
    rating: 4.6,
    chapterCount: 3160,
  });
});

// /search-adv styles its pager `pages advanced-pages`; an exact class match missed it
// and reported every filtered search as a single page.
void test("the last page is read off the pager, including the advanced-search variant", () => {
  assert.equal(parseListing(LISTING_HTML).lastPage, 5);
});

void test("an empty result list is not mistaken for page one of many", () => {
  assert.deepEqual(parseListing('<div class="rank-list"></div>'), { rows: [], lastPage: 0 });
});

// An empty or host-relative imageUrl is rejected by the bridge as an invalid URL.
void test("thumbnails are absolute", () => {
  const item = toSearchResultItem(parseListing(LISTING_HTML).rows[0]!);
  assert.ok(item.imageUrl.startsWith("https://"));
});

void test("an adult genre lifts the row's rating to ADULT", () => {
  const item = toSearchResultItem(parseListing(LISTING_HTML).rows[0]!);
  assert.equal(item.contentRating, ContentRating.ADULT);
});

// --- Filters the server could not apply ---

const row = parseListing(LISTING_HTML).rows[0]!;

void test("a row printing an excluded genre is dropped", () => {
  assert.equal(matchesFilters(row, { genresExclude: ["Smut"] }), false);
});

// A row prints only its first two genres, so a missing genre proves nothing. Checking
// inclusions here would drop correct results whose match was the third genre.
void test("inclusions are not re-checked against the truncated genre list", () => {
  assert.equal(matchesFilters(row, { genresInclude: ["Romance"] }), true);
});

void test("a rating below the requested minimum is dropped", () => {
  assert.equal(matchesFilters(row, { rating: "4.5" }), true);
  assert.equal(matchesFilters(row, { rating: "5" }), false);
});

// --- Novel detail comes from og:novel meta tags ---

const NOVEL_HTML = `
<meta property="og:novel:novel_name" content="Apocalypse Gachapon">
<meta property="og:image" content="https://freewebnovel.com/files/article/image/3/3612/3612s.jpg">
<meta property="og:novel:category" content="Chinese Novel">
<meta property="og:novel:genre" content="Action, Harem, Mature, Romance, Sci-fi">
<meta property="og:novel:author" content="Xuan Huang">
<meta property="og:novel:status" content="OnGoing">
<div class="main" id="indexListPage" data-page-size="40" data-total-page="61" data-total-chapters="2429">
<div class="txt"><div class="item"><span title="Alternative names"></span><div class="right"><span class="s1">Alt One, Alt Two</span></div></div></div>
<div class="m-desc"><h1 class="tit">Apocalypse Gachapon</h1><div class="inner"><p>First line.</p><p>Second line.</p></div></div>
<p class="vote">3.5 / 5 ( 73 votes )</p>
`;

void test("the novel record is read from meta tags plus the three fields that have none", () => {
  const detail = parseNovelDetail(NOVEL_HTML, "apocalypse-gachapon");
  assert.equal(detail.title, "Apocalypse Gachapon");
  assert.equal(detail.author, "Xuan Huang");
  assert.equal(detail.status, "OnGoing");
  // "Chinese Novel" is the site's label for the original language.
  assert.equal(detail.language, "Chinese");
  assert.deepEqual(detail.genres, ["Action", "Harem", "Mature", "Romance", "Sci-fi"]);
  assert.deepEqual(detail.alternativeTitles, ["Alt One", "Alt Two"]);
  assert.equal(detail.rating, 3.5);
  assert.equal(detail.synopsis, "First line.\n\nSecond line.");
});

// The count that makes the update sweep one request instead of thirty-seven.
void test("the chapter total is read off the page root", () => {
  assert.equal(parseNovelDetail(NOVEL_HTML, "x").totalChapters, 2429);
});

void test("the site's OnGoing is normalised to the spelling every other source uses", () => {
  assert.equal(toSourceManga(parseNovelDetail(NOVEL_HTML, "x")).mangaInfo.status, "Ongoing");
});

void test("a novel page with nothing readable raises rather than returning a blank record", () => {
  assert.throws(() => parseNovelDetail("<html></html>", "missing"), /FreeWebNovel/);
});

// --- Ids must survive the bridge ---

const ID_CHARSET = /^[a-z0-9._\-@()[\]%?#+=/&:]+$/;

void test("genre tag ids are slugged; titles keep their display casing", () => {
  const tags = toSourceManga(parseNovelDetail(NOVEL_HTML, "x")).mangaInfo.tagGroups![0]!.tags;
  for (const tag of tags) assert.match(tag.id, ID_CHARSET);
});

// "Slice of Life" as a raw id throws the moment it is decoded — this repository has
// shipped that crash twice.
void test("every genre in the vocabulary slugs to a legal id", () => {
  for (const genre of GENRES) assert.match(safeId(genre), ID_CHARSET);
  assert.equal(safeId("Slice of Life"), "slice-of-life");
  assert.equal(safeId("Sci-fi"), "sci-fi");
});

void test("genre chips carry filters with no undefined values in the metadata", () => {
  for (const chip of genreChipItems()) {
    assert.equal(chip.type, "genresCarouselItem");
    if (chip.type !== "genresCarouselItem") continue;
    for (const value of Object.values(chip.searchQuery.metadata as Record<string, unknown>)) {
      assert.notEqual(value, undefined);
    }
  }
});

// --- URLs ---

// `/genre/Gender%20Bender` returns an empty body where `/genre/Gender+Bender` works.
void test("a multi-word genre path uses + rather than percent-encoding", () => {
  assert.equal(genreUrl("Gender Bender", 1), "https://freewebnovel.com/genre/Gender+Bender");
});

void test("browse pages are a path segment, and page one is the bare path", () => {
  assert.equal(sortUrl("most-popular", 1), "https://freewebnovel.com/sort/most-popular");
  assert.equal(sortUrl("most-popular", 3), "https://freewebnovel.com/sort/most-popular/3");
});

// Without apply=1 the page renders an empty result list and a placeholder, which
// looks exactly like "no matches".
void test("the filter endpoint always carries apply=1", () => {
  assert.match(advancedSearchUrl({}, "popular", 1), /[?&]apply=1(&|$)/);
});

// The site 301s an explicit page=1 as non-canonical, and this runtime does not
// follow redirects — so sending one fails the search rather than costing a hop.
void test("no listing URL sends an explicit page=1", () => {
  assert.equal(
    searchUrl("shadow slave", 1),
    "https://freewebnovel.com/search?keyword=shadow%20slave",
  );
  assert.doesNotMatch(advancedSearchUrl({}, "popular", 1), /page=/);

  assert.match(searchUrl("shadow", 2), /[?&]page=2(&|$)/);
  assert.match(advancedSearchUrl({}, "popular", 2), /[?&]page=2(&|$)/);
});

void test("exclusions ride alone when nothing is included, and yield to inclusions when both exist", () => {
  const excludeOnly = advancedSearchUrl({ genresExclude: ["Smut"] }, "popular", 1);
  assert.match(excludeOnly, /genre%5B%5D=Smut/);
  assert.match(excludeOnly, /genre_match=exclude/);

  const both = advancedSearchUrl(
    { genresInclude: ["Fantasy"], genresExclude: ["Smut"], genreMatch: "any" },
    "popular",
    1,
  );
  assert.match(both, /genre%5B%5D=Fantasy/);
  assert.doesNotMatch(both, /Smut/);
  assert.match(both, /genre_match=any/);
});

// --- Chapter bodies ---

// The ad blocks the site injects sit mid-article and are the reason a non-greedy
// `<div id="article">([\s\S]*?)</div>` truncates a chapter at its first ad.
const CHAPTER_HTML = `
<div class="txt"><div id="article"> <h4>Chapter 2: Level 1 Gachapon</h4>
<p>First paragraph.</p>
<div class="reader-ad-skip" translate="no"><div id="bg-ssp-6327"><script>var x = 1;</script></div></div>
<p>Second paragraph with AT&T and a &nbsp; space.</p>
<p></p>
<p>Third paragraph.</p>
</div></div>
<p>Not part of the chapter.</p>
`;

void test("the article survives its own inlined ad blocks", () => {
  const html = parseChapterBody(CHAPTER_HTML, "probe");
  assert.equal((html.match(/<p>/g) ?? []).length, 3);
  assert.doesNotMatch(html, /reader-ad-skip|bg-ssp|var x/);
  assert.doesNotMatch(html, /Not part of the chapter/);
});

// The h4 duplicates what the app already renders above the reader.
void test("the article's own heading is dropped", () => {
  assert.doesNotMatch(parseChapterBody(CHAPTER_HTML, "probe"), /Level 1 Gachapon/);
});

void test("a chapter is served as a complete namespaced XHTML document", () => {
  const html = parseChapterBody(CHAPTER_HTML, "probe");
  assert.ok(html.startsWith('<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'));
  assert.ok(html.endsWith("</body></html>"));
});

// A chapter with zero paragraphs renders as a silently blank reader.
void test("an empty article raises instead of returning a blank chapter", () => {
  assert.throws(() => parseChapterBody('<div id="article"></div>', "locked"), /FreeWebNovel/);
  assert.throws(() => parseChapterBody("<html></html>", "missing"), /FreeWebNovel/);
});

// Only amp/lt/gt/quot/apos are predefined in XML; everything else is fatal.
void test("entities and bare ampersands are made XML-safe", () => {
  const html = parseChapterBody(CHAPTER_HTML, "probe");
  assert.match(html, /AT&amp;T/);
  assert.match(html, /&#160;/);
  assert.doesNotMatch(html, /&nbsp;/);
});

void test("an unknown entity degrades to visible text rather than breaking the parse", () => {
  assert.equal(
    toXhtmlDocument("<p>&bogus;</p>"),
    '<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body><p>&amp;bogus;</p></body></html>',
  );
});

void test("void elements are self-closed", () => {
  assert.match(toXhtmlDocument("<p>a<br>b<hr></p>"), /<br\/>b<hr\/>/);
});

// --- html.ts primitives ---

void test("a balanced slice spans nested divs where a non-greedy match would not", () => {
  const html = '<div id="a">one<div>two</div>three</div>after';
  assert.equal(balancedDiv(html, /<div id="a">/), '<div id="a">one<div>two</div>three</div>');
});

void test("removing a div takes its whole subtree with it", () => {
  const html = '<p>keep</p><div class="ad"><div>inner</div></div><p>also keep</p>';
  assert.equal(removeDivs(html, /<div class="ad">/), "<p>keep</p><p>also keep</p>");
});

void test("an unclosed div does not swallow the rest of the page", () => {
  assert.equal(balancedDiv('<div id="a">dangling', /<div id="a">/), undefined);
});

// --- The release feed is the only place per-chapter timing exists ---

void test("relative release times resolve against a known now", () => {
  const now = new Date("2026-08-20T12:00:00Z");
  assert.deepEqual(parseRelativeTime("3 mins ago", now), new Date("2026-08-20T11:57:00Z"));
  assert.deepEqual(parseRelativeTime("2 hours ago", now), new Date("2026-08-20T10:00:00Z"));
  assert.equal(parseRelativeTime("just now", now), undefined);
});
