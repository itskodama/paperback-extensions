/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import {
  numberTocEntries,
  searchLibrary,
  toSearchResultItem,
  volumeChapters,
  type LibraryEntry,
  type TocEntry,
} from "../../src/LNORI/parser.ts";

function toc(...titles: string[]): TocEntry[] {
  return titles.map((title, index) => ({ anchor: `page${index + 1}`, title }));
}

void test("explicit chapter numbers keep their own number and subtitle", () => {
  const result = numberTocEntries(toc("Chapter 1: The Passage", "Chapter 2: Invasion"));
  assert.deepEqual(
    result.map((r) => [r.chapNum, r.title]),
    [
      [1, "The Passage"],
      [2, "Invasion"],
    ],
  );
});

void test("unnumbered front/back matter interpolates as decimals around explicit chapters", () => {
  const result = numberTocEntries(
    toc("Prologue", "Chapter 1: Start", "Interlude", "Chapter 2: Next"),
  );
  assert.deepEqual(
    result.map((r) => r.chapNum),
    [0.1, 1, 1.1, 2],
  );
});

void test("a fully unnumbered TOC falls back to plain ordinals (Bookworm case)", () => {
  const result = numberTocEntries(toc("Prologue", "Beginning", "The Choice", "Epilogue"));
  assert.deepEqual(
    result.map((r) => r.chapNum),
    [1, 2, 3, 4],
  );
});

// --- searchLibrary: the catalog is fetched once and filtered in memory ---

const library: LibraryEntry[] = [
  {
    mangaId: "1/mushoku-tensei",
    title: "Mushoku Tensei",
    author: "Rifujin na Magonote",
    imageUrl: "https://example.test/1.jpg",
    tags: ["Isekai", "Slice of Life"],
    popularity: 100,
  },
  {
    mangaId: "2/overlord",
    title: "Overlord",
    author: "Kugane Maruyama",
    imageUrl: "https://example.test/2.jpg",
    tags: ["Isekai", "Dark Fantasy"],
    popularity: 90,
  },
  {
    mangaId: "3/spice-and-wolf",
    title: "Spice and Wolf",
    imageUrl: "https://example.test/3.jpg",
    tags: ["Romance"],
    popularity: 80,
  },
];

void test("searchLibrary matches on title, case-insensitively and on a substring", () => {
  assert.deepEqual(
    searchLibrary(library, "over").map((entry) => entry.mangaId),
    ["2/overlord"],
  );
  assert.deepEqual(
    searchLibrary(library, "WOLF").map((entry) => entry.mangaId),
    ["3/spice-and-wolf"],
  );
});

void test("searchLibrary matches on author, and tolerates entries without one", () => {
  assert.deepEqual(
    searchLibrary(library, "maruyama").map((entry) => entry.mangaId),
    ["2/overlord"],
  );
  // Spice and Wolf has no author; searching must not throw on the missing field.
  assert.deepEqual(searchLibrary(library, "rifujin").length, 1);
});

void test("searchLibrary filters by genre before the title needle", () => {
  assert.deepEqual(
    searchLibrary(library, undefined, "Isekai").map((entry) => entry.mangaId),
    ["1/mushoku-tensei", "2/overlord"],
  );
  assert.deepEqual(
    searchLibrary(library, "over", "Isekai").map((entry) => entry.mangaId),
    ["2/overlord"],
  );
  // A genre that matches nothing yields nothing, rather than falling back to everything.
  assert.deepEqual(searchLibrary(library, undefined, "Mecha"), []);
});

void test("searchLibrary with no query returns the whole catalog", () => {
  assert.equal(searchLibrary(library, undefined).length, 3);
  assert.equal(searchLibrary(library, "   ").length, 3);
});

void test("toSearchResultItem omits nothing the bridge requires", () => {
  const item = toSearchResultItem(library[0]!);

  assert.equal(item.mangaId, "1/mushoku-tensei");
  assert.equal(item.title, "Mushoku Tensei");
  assert.equal(item.contentRating, ContentRating.MATURE);
  assert.ok(item.imageUrl.length > 0);
});

// --- volumeChapters: a volume with no TOC still has to yield one readable chapter ---

const sourceManga: SourceManga = {
  mangaId: "1/mushoku-tensei",
  mangaInfo: {
    thumbnailUrl: "",
    synopsis: "",
    primaryTitle: "Mushoku Tensei",
    secondaryTitles: [],
    contentRating: ContentRating.MATURE,
  },
};

void test("a volume with no TOC becomes a single chapter covering the whole book", () => {
  const chapters = volumeChapters(
    { path: "/book/1", position: 3, name: "Volume 3" },
    [],
    undefined,
    sourceManga,
  );

  assert.equal(chapters.length, 1);
  assert.equal(chapters[0]?.chapterId, "/book/1");
  assert.equal(chapters[0]?.chapNum, 1);
  assert.equal(chapters[0]?.volume, 3);
});

void test("TOC entries carry the next anchor, so the reader knows where to stop", () => {
  const chapters = volumeChapters(
    { path: "/book/1", position: 1 },
    [
      { anchor: "p1", title: "Chapter 1: Start" },
      { anchor: "p2", title: "Chapter 2: Next" },
    ],
    undefined,
    sourceManga,
  );

  assert.equal(chapters[0]?.additionalInfo?.anchor, "p1");
  assert.equal(chapters[0]?.additionalInfo?.nextAnchor, "p2");
  // The last chapter runs to the end of the book, so it has no next anchor.
  assert.equal(chapters[1]?.additionalInfo?.nextAnchor, undefined);
  assert.equal(chapters[1]?.chapterId, "/book/1#p2");
});

void test("a publish date is attached when known and omitted when not", () => {
  const withDate = volumeChapters(
    { path: "/book/1", position: 1 },
    [{ anchor: "p1", title: "Chapter 1" }],
    new Date("2024-01-15T00:00:00Z"),
    sourceManga,
  );
  assert.ok(withDate[0]?.publishDate instanceof Date);

  const without = volumeChapters(
    { path: "/book/1", position: 1 },
    [{ anchor: "p1", title: "Chapter 1" }],
    undefined,
    sourceManga,
  );
  // Absent rather than undefined: an undefined date crossing the bridge throws.
  assert.equal("publishDate" in (without[0] ?? {}), false);
});

// Two chapters sharing a chapNum are treated by the app as duplicate *versions* of one chapter
// (docs/paperback/chapters.md), so one of them disappears behind version priority. A run of ten
// or more unnumbered entries used to step 0.1 at a time straight onto the next real number.
void test("a long unnumbered run never reaches the next real chapter number", () => {
  const interludes = Array.from({ length: 11 }, (_, i) => `Interlude ${i + 1}`);
  const result = numberTocEntries(toc("Chapter 5", ...interludes, "Chapter 6"));
  const numbers = result.map((entry) => entry.chapNum);

  assert.equal(numbers[0], 5);
  assert.equal(numbers.at(-1), 6);
  // Strictly inside the gap, and strictly increasing throughout.
  for (const value of numbers.slice(1, -1)) {
    assert.ok(value > 5 && value < 6, `${value} escaped the 5..6 gap`);
  }
  for (let i = 1; i < numbers.length; i++) {
    assert.ok(numbers[i]! > numbers[i - 1]!, `not increasing at ${i}`);
  }
  assert.equal(new Set(numbers).size, numbers.length, "chapter numbers collided");
});

void test("a short unnumbered run keeps the plain 0.1 spacing", () => {
  const result = numberTocEntries(toc("Chapter 5", "Interlude", "Afterword", "Chapter 6"));

  assert.deepEqual(
    result.map((entry) => entry.chapNum),
    [5, 5.1, 5.2, 6],
  );
});

void test("nine unnumbered entries still fit at 0.1 without compressing", () => {
  const result = numberTocEntries(
    toc("Chapter 1", ...Array.from({ length: 9 }, (_, i) => `Extra ${i + 1}`)),
  );

  assert.deepEqual(
    result.map((entry) => entry.chapNum),
    [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9],
  );
});

void test("front matter before the first numbered chapter stays below it", () => {
  const result = numberTocEntries(toc("Prologue", "Cast of Characters", "Chapter 1: Departure"));
  const numbers = result.map((entry) => entry.chapNum);

  assert.ok(numbers[0]! > 0 && numbers[0]! < 1);
  assert.ok(numbers[1]! > numbers[0]! && numbers[1]! < 1);
  assert.equal(numbers[2], 1);
});
