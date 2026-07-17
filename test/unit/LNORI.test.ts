/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { numberTocEntries, type TocEntry } from "../../src/LNORI/parser.ts";

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
