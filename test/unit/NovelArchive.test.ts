/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import {
  chaptersFromDetail,
  chaptersFromSource,
  toGenreOptions,
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
