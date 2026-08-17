/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import {
  chaptersFromDetail,
  chaptersFromSource,
  toFeaturedItem,
  toGenreOptions,
  toSearchResultItem,
  toSourceManga,
  type NovelJson,
} from "../../src/NovelArchive/parser.ts";

const sourceManga: SourceManga = {
  mangaId: "test",
  mangaInfo: {
    thumbnailUrl: "",
    synopsis: "",
    primaryTitle: "Test",
    secondaryTitles: [],
    contentRating: ContentRating.MATURE,
  },
};

function novel(chapterNames: string[]): NovelJson {
  return {
    id: "test",
    author: "",
    chapter_names: chapterNames,
    genres: "",
    cover_url: "",
    title: "Test",
    associated_names: [],
    description: "",
    total_chapters: String(chapterNames.length),
    release_status: "",
    views_number: 0,
    rating: 0,
    rating_count: 0,
  };
}

void test("a consistent embedded offset (Omniscient Reader's Viewpoint's 'Chapter 0') is trusted", () => {
  const chapters = chaptersFromDetail(
    novel(["Chapter 0", "Chapter 1", "Chapter 2", "Chapter 3", "Chapter 4"]),
    sourceManga,
  );
  assert.deepEqual(
    chapters.map((c) => c.chapNum),
    [0, 1, 2, 3, 4],
  );
  // chapterId always stays plain position — never the untrusted embedded number
  assert.deepEqual(
    chapters.map((c) => c.chapterId),
    ["1", "2", "3", "4", "5"],
  );
  assert.equal(chapters[0]!.additionalInfo?.offset, "-1");
});

void test("scattered offsets with no consensus (The Beginning After The End) fall back to plain position", () => {
  const chapters = chaptersFromDetail(
    novel(["Chapter 1", "Chapter 3", "Chapter 4", "Chapter 8", "Chapter 9"]),
    sourceManga,
  );
  assert.deepEqual(
    chapters.map((c) => c.chapNum),
    [1, 2, 3, 4, 5],
  );
  assert.equal(chapters[0]!.additionalInfo, undefined);
});

void test("a redundant repeated number in the title is stripped ('Chapter 1 - 1: Nightmare Begins')", () => {
  const chapters = chaptersFromDetail(novel(["Chapter 1 - 1: Nightmare Begins"]), sourceManga);
  assert.equal(chapters[0]!.title, "Nightmare Begins");
});

void test("chaptersFromSource strips a bare leading number with no 'Chapter' keyword (NovelFire)", () => {
  const chapters = chaptersFromSource(
    { id: "novelfire", label: "NovelFire" },
    { chapters: [{ number: 1, title: "1 Nightmare Begins" }] },
    sourceManga,
  );
  assert.equal(chapters[0]!.title, "Nightmare Begins");
  assert.equal(chapters[0]!.chapterId, "novelfire:1");
});

void test("chaptersFromSource drops a purely numeric title with no real text (Ranobes)", () => {
  const chapters = chaptersFromSource(
    { id: "ranobes", label: "Ranobes" },
    { chapters: [{ number: 5, title: "5" }] },
    sourceManga,
  );
  assert.equal(chapters[0]!.title, undefined);
});

void test("toGenreOptions drops the nav labels the genre endpoint mixes in", () => {
  // /api/novels/genres returns these three alongside 280 real genres. Unfiltered they
  // became selectable chips in advanced search — "Browse" offered as a genre.
  const options = toGenreOptions({
    genres: [
      { value: "action", label: "Action" },
      { value: "browse", label: "Browse" },
      { value: "completed novels", label: "Completed Novels" },
      { value: "latest novels", label: "Latest Novels" },
      { value: "romance", label: "Romance" },
    ],
  });

  assert.deepEqual(
    options.map((option) => option.value),
    ["action", "romance"],
  );
});

void test("toGenreOptions matches nav labels regardless of case or padding", () => {
  const options = toGenreOptions({ genres: [{ value: " Browse ", label: "Browse" }] });

  assert.deepEqual(options, []);
});

// formatCount is internal; toFeaturedItem is the only way in. The K form rounds, so every value
// from 999,500 up would otherwise print as "1000K" instead of rolling over to "1M".
function viewsBadge(views: number): string | undefined {
  const item = toFeaturedItem({ ...featuredNovel, views_number: views });
  assert.equal(item.type, "featuredCarouselItem");
  return item.type === "featuredCarouselItem"
    ? item.infoItems?.find((entry) => entry.symbol === "eye.fill")?.text
    : undefined;
}

const featuredNovel: NovelJson = {
  id: "counted",
  author: "Author",
  chapter_names: [],
  genres: "action",
  cover_url: "/covers/x.webp",
  title: "Counted",
  associated_names: [],
  description: "A synopsis.",
  total_chapters: "1",
  release_status: "ongoing",
  views_number: 0,
  rating: 0,
  rating_count: 0,
};

void test("toFeaturedItem rolls the view count over to M instead of printing 1000K", () => {
  assert.equal(viewsBadge(999_499), "999K");
  assert.equal(viewsBadge(999_500), "1M");
  assert.equal(viewsBadge(999_999), "1M");
  assert.equal(viewsBadge(1_000_000), "1M");
});

void test("toFeaturedItem keeps the ordinary K and M cases intact", () => {
  assert.equal(viewsBadge(999), "999");
  assert.equal(viewsBadge(255_678), "256K");
  assert.equal(viewsBadge(3_965_770), "4M");
});

// --- toSourceManga: the mapping every screen in the app renders from ---

function detail(overrides: Partial<NovelJson> = {}): NovelJson {
  return {
    ...novel(["Chapter 1: Leaving", "Chapter 2: Arrival"]),
    id: "1234/the-beginning-after-the-end",
    author: "TurtleMe",
    genres: "Action, Adventure, Fantasy",
    cover_url: "/covers/1234.jpg",
    title: "The Beginning After The End",
    associated_names: ["TBATE"],
    description: "King Grey has unrivaled strength…",
    ...overrides,
  };
}

void test("toSourceManga makes a relative cover absolute", () => {
  // An empty or host-relative imageUrl is rejected by the bridge as an invalid URL.
  const manga = toSourceManga(detail(), "1234/the-beginning-after-the-end");

  assert.ok(manga.mangaInfo.thumbnailUrl.startsWith("https://"));
  assert.deepEqual(manga.mangaInfo.artworkUrls, [manga.mangaInfo.thumbnailUrl]);
});

void test("toSourceManga leaves an already-absolute cover alone", () => {
  assert.equal(
    toSourceManga(detail({ cover_url: "https://cdn.test/x.jpg" }), "1").mangaInfo.thumbnailUrl,
    "https://cdn.test/x.jpg",
  );
});

void test("toSourceManga always declares itself a novel", () => {
  assert.equal(toSourceManga(detail(), "1").mangaInfo.contentType, "novel");
});

void test("toSourceManga substitutes text for an empty synopsis", () => {
  // "" is legal but renders as a blank panel, so the app shows a fallback instead.
  assert.equal(toSourceManga(detail({ description: "" }), "1").mangaInfo.synopsis, "No synopsis.");
});

void test("toSourceManga splits the comma-joined genre string into tags", () => {
  const tags = toSourceManga(detail(), "1").mangaInfo.tagGroups?.[0]?.tags ?? [];

  assert.deepEqual(
    tags.map((tag) => tag.title),
    ["Action", "Adventure", "Fantasy"],
  );
  // Ids must survive the bridge's charset; titles keep their display casing.
  for (const tag of tags) assert.match(tag.id, /^[a-z0-9._\-@()[\]%?#+=/&:]+$/);
});

void test("toSourceManga omits the tag group entirely when there are no genres", () => {
  assert.deepEqual(toSourceManga(detail({ genres: "" }), "1").mangaInfo.tagGroups, []);
});

void test("toSourceManga rates an adult genre ADULT and everything else MATURE", () => {
  assert.equal(
    toSourceManga(detail({ genres: "Action, Adult" }), "1").mangaInfo.contentRating,
    ContentRating.ADULT,
  );
  assert.equal(
    toSourceManga(detail({ genres: "Action, Fantasy" }), "1").mangaInfo.contentRating,
    ContentRating.MATURE,
  );
  // Case-insensitive, so a differently-cased genre still trips it.
  assert.equal(
    toSourceManga(detail({ genres: "EROTICA" }), "1").mangaInfo.contentRating,
    ContentRating.ADULT,
  );
});

void test("toSearchResultItem carries the fields a result cell needs", () => {
  const item = toSearchResultItem(detail());

  assert.equal(item.mangaId, "1234/the-beginning-after-the-end");
  assert.equal(item.title, "The Beginning After The End");
  assert.ok(item.imageUrl.startsWith("https://"));
});
