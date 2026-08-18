/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";

import {
  DEFAULT_SORT,
  advancedSearchUrl,
  findSortOption,
  genreChipItems,
  matchesFilters,
  parseChapterCards,
  parseChapterContent,
  parseNovelDetails,
  parseRelativeTime,
  toFeaturedItem,
  toSearchResultItem,
  type SearchNovelJson,
} from "../../src/LightNovelWorld/parser.ts";

const CHAPTER_LIST_FIXTURE = `
<div class="chapter-card" onclick="location.href='/novel/test-novel/chapter/1/'">
  <h3 class="chapter-title">Chapter 1 - 1 - The Passage</h3>
  <p class="chapter-time">11 months, 2 weeks ago</p>
</div>
<div class="chapter-card" onclick="location.href='/novel/test-novel/chapter/102/'">
  <h3 class="chapter-title">Chapter 102 - [BOOK TWO FINALE] 102 - Naive Little Shit</h3>
  <p class="chapter-time">2 months ago</p>
</div>
<div class="chapter-card" onclick="location.href='/novel/test-novel/chapter/150/'">
  <h3 class="chapter-title">Chapter 150 - Surprise chapter drop!</h3>
  <p class="chapter-time">2 minutes ago</p>
</div>
`;

void test("chapter numbers always come from the URL, never the embedded raw number", () => {
  const cards = parseChapterCards(CHAPTER_LIST_FIXTURE);
  assert.deepEqual(
    cards.map((c) => c.number),
    [1, 102, 150],
  );
});

void test("a normal chapter title strips 'Chapter N - N - ' down to just the title", () => {
  const cards = parseChapterCards(CHAPTER_LIST_FIXTURE);
  assert.equal(cards[0]!.title, "The Passage");
});

void test("a book-boundary title survives untouched (its embedded number isn't a leading number)", () => {
  const cards = parseChapterCards(CHAPTER_LIST_FIXTURE);
  assert.equal(cards[1]!.title, "[BOOK TWO FINALE] 102 - Naive Little Shit");
});

void test("a bonus chapter with no embedded number keeps its own title", () => {
  const cards = parseChapterCards(CHAPTER_LIST_FIXTURE);
  assert.equal(cards[2]!.title, "Surprise chapter drop!");
});

const NOVEL_FIXTURE = `
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Book",
  "name": "Test Novel",
  "author": { "@type": "Person", "name": "Test Author" },
  "genre": ["Slice of Life", "Martial Arts", "Adult"],
  "description": "A test description.",
  "image": "/media/covers/test.jpg",
  "status": "Ongoing"
}
</script>
`;

void test("genre tag ids are sanitized (spaces aren't row-id-safe) while titles keep the real text", () => {
  const manga = parseNovelDetails(NOVEL_FIXTURE, "test-novel");
  const tags = manga.mangaInfo.tagGroups?.[0]?.tags;
  assert.deepEqual(
    tags?.map((t) => t.id),
    ["Slice-of-Life", "Martial-Arts", "Adult"],
  );
  assert.deepEqual(
    tags?.map((t) => t.title),
    ["Slice of Life", "Martial Arts", "Adult"],
  );
});

void test("an 'Adult' genre escalates content rating; everything else stays Mature", () => {
  const manga = parseNovelDetails(NOVEL_FIXTURE, "test-novel");
  assert.equal(manga.mangaInfo.contentRating, ContentRating.ADULT);

  const withoutAdult: SearchNovelJson = {
    id: 1,
    title: "Test",
    author: "Author",
    slug: "test",
    status: "Ongoing",
    genres: ["Fantasy", "Romance"],
    cover_path: "/media/covers/x.jpg",
    latest_chapter_number: 10,
  };
  assert.equal(toSearchResultItem(withoutAdult).contentRating, ContentRating.MATURE);
});

void test("relative image/status fields resolve to absolute URLs and pass through status", () => {
  const manga = parseNovelDetails(NOVEL_FIXTURE, "test-novel");
  assert.equal(manga.mangaInfo.thumbnailUrl, "https://lightnovelworld.org/media/covers/test.jpg");
  assert.equal(manga.mangaInfo.status, "Ongoing");
  assert.equal(manga.mangaInfo.author, "Test Author");
});

const testChapter: Chapter = {
  chapterId: "1",
  sourceManga: {
    mangaId: "test-novel",
    mangaInfo: parseNovelDetails(NOVEL_FIXTURE, "test-novel").mangaInfo,
  },
  langCode: "en",
  chapNum: 1,
};

const CHAPTER_CONTENT_FIXTURE = `
<div class="chapter-text protected-content" id="chapterText" data-protected="true">
<div class="chapter-ad-container" data-ad-position="1"><div class="ad-unit"><script>evil()</script></div></div>
<p>Hello&nbsp;World.</p><p>Second paragraph.</p>
</div>
<div class="bottom-nav">
`;

void test("chapter content strips ad markup, keeps paragraphs, and wraps in the XHTML namespace", () => {
  const details = parseChapterContent(CHAPTER_CONTENT_FIXTURE, testChapter);
  assert.equal(details.type, "html");
  assert.ok(details.type === "html");
  assert.ok(details.html.startsWith('<html xmlns="http://www.w3.org/1999/xhtml">'));
  assert.ok(details.html.includes("<p>Hello&#160;World.</p>"));
  assert.ok(details.html.includes("<p>Second paragraph.</p>"));
  assert.ok(!details.html.includes("evil()"));
  assert.ok(!details.html.includes("&nbsp;"));
});

void test("chapter content throws rather than returning a silently blank chapter", () => {
  assert.throws(() => parseChapterContent("<html><body>nothing here</body></html>", testChapter));
});

void test("parseRelativeTime sums combined units", () => {
  const now = Date.now();
  const eleven = parseRelativeTime("11 months, 2 weeks ago")!;
  const two = parseRelativeTime("2 minutes ago")!;
  assert.ok(now - eleven.getTime() > now - two.getTime());
  assert.equal(parseRelativeTime("not a time string"), undefined);
});

void test("advancedSearchUrl builds every filter and the sort+order pair correctly", () => {
  const url = new URL(
    advancedSearchUrl(
      {
        genresInclude: ["Fantasy", "Action"],
        genresExclude: ["Romance"],
        genreLogic: "OR",
        status: "completed",
        chapterRange: "<50",
      },
      findSortOption("new-desc"),
      2,
    ),
  );
  assert.deepEqual(url.searchParams.getAll("genres_include"), ["Fantasy", "Action"]);
  assert.deepEqual(url.searchParams.getAll("genres_exclude"), ["Romance"]);
  assert.equal(url.searchParams.get("genre_logic"), "OR");
  assert.equal(url.searchParams.get("status"), "completed");
  assert.equal(url.searchParams.get("chapter_range"), "<50");
  assert.equal(url.searchParams.get("sort"), "new");
  assert.equal(url.searchParams.get("order"), "desc");
  assert.equal(url.searchParams.get("page"), "2");
});

void test("advancedSearchUrl with no filters and the default sort has no query string", () => {
  const url = advancedSearchUrl(undefined, DEFAULT_SORT, 1);
  assert.equal(url, "https://lightnovelworld.org/advanced-search/");
});

void test("findSortOption falls back to Relevance for an unknown id", () => {
  assert.deepEqual(findSortOption("not-a-real-id"), DEFAULT_SORT);
  assert.equal(findSortOption("views-desc").sort, "views");
});

void test("toFeaturedItem carries chapter count and status as free info items", () => {
  const novel: SearchNovelJson = {
    id: 1,
    title: "Test",
    author: "Author",
    slug: "test",
    status: "Completed",
    genres: [],
    cover_path: "/media/covers/x.jpg",
    latest_chapter_number: 250,
  };
  const item = toFeaturedItem(novel);
  assert.equal(item.type, "featuredCarouselItem");
  assert.ok(item.type === "featuredCarouselItem");
  assert.deepEqual(item.infoItems, [
    { symbol: "book.fill", text: "250 ch" },
    { symbol: "checkmark.circle.fill", text: "Completed" },
  ]);
});

// The API spells genres with spaces and the filter vocabulary with hyphens; confirmed live
// against /api/search/, where "Slice of Life" and "Martial Arts" both come back spaced.
function apiNovel(overrides: Partial<SearchNovelJson> = {}): SearchNovelJson {
  return {
    id: 1,
    title: "A Novel",
    author: "Author",
    slug: "a-novel",
    status: "Ongoing",
    genres: ["Action", "Slice of Life", "Martial Arts"],
    cover_path: "/covers/a.jpg",
    latest_chapter_number: 420,
    ...overrides,
  };
}

void test("matchesFilters bridges the hyphen/space spelling difference", () => {
  assert.equal(matchesFilters(apiNovel(), { genresInclude: ["Slice-of-Life"] }), true);
  assert.equal(matchesFilters(apiNovel(), { genresInclude: ["Martial-Arts"] }), true);
  assert.equal(matchesFilters(apiNovel(), { genresInclude: ["Romance"] }), false);
});

void test("matchesFilters defaults included genres to AND and honours OR", () => {
  const both = { genresInclude: ["Action", "Romance"] };
  assert.equal(matchesFilters(apiNovel(), both), false);
  assert.equal(matchesFilters(apiNovel(), { ...both, genreLogic: "OR" }), true);
});

void test("matchesFilters excludes on any excluded genre", () => {
  assert.equal(matchesFilters(apiNovel(), { genresExclude: ["Romance"] }), true);
  assert.equal(matchesFilters(apiNovel(), { genresExclude: ["Slice-of-Life"] }), false);
});

void test("matchesFilters compares status case-insensitively", () => {
  assert.equal(matchesFilters(apiNovel(), { status: "ongoing" }), true);
  assert.equal(matchesFilters(apiNovel(), { status: "completed" }), false);
});

void test("matchesFilters reads the API's own chapter_range spellings", () => {
  const chapters = (n: number) => apiNovel({ latest_chapter_number: n });

  assert.equal(matchesFilters(chapters(20), { chapterRange: "<50" }), true);
  assert.equal(matchesFilters(chapters(60), { chapterRange: "<50" }), false);
  assert.equal(matchesFilters(chapters(60), { chapterRange: "50-100" }), true);
  assert.equal(matchesFilters(chapters(120), { chapterRange: "50-100" }), false);
  assert.equal(matchesFilters(chapters(2000), { chapterRange: ">1000" }), true);
  assert.equal(matchesFilters(chapters(900), { chapterRange: ">1000" }), false);
});

void test("matchesFilters passes everything through when no filters were set", () => {
  assert.equal(matchesFilters(apiNovel(), undefined), true);
  assert.equal(matchesFilters(apiNovel(), {}), true);
});

void test("genreChipItems replaces every hyphen, not just the first", () => {
  const names = genreChipItems().map((item) =>
    item.type === "genresCarouselItem" ? item.name : "",
  );

  assert.ok(names.includes("Slice of Life"), "Slice-of-Life still renders with a stray hyphen");
  assert.ok(names.includes("School Life"));
  assert.ok(!names.some((name) => name.includes("-")));
});
