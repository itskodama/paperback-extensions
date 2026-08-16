/* eslint-disable @typescript-eslint/no-unused-expressions */
import { type TestLogger } from "@paperback/types";
import { expect } from "chai";

import { MangaBaka } from "../MangaBaka/main.js";
import sourceInfo from "../MangaBaka/pbconfig.js";
import { TestSuite, registerDefaultTests } from "./suite.js";

// Stable, long-running series used as fixtures. 1677 is Chainsaw Man (a manga);
// 83072 is its light-novel spin-off, which is what proves novels stay novels.
const MANGA_ID = "1677";
const NOVEL_ID = "83072";

export async function runTests(logger: TestLogger) {
  const suite = new TestSuite("MangaBaka tests", logger);

  registerDefaultTests(suite, MangaBaka, sourceInfo, {
    mangaProviding: { getMangaDetails: [MANGA_ID] },
  });

  // The default suite has no PROGRESS_PROVIDING or DISCOVER_SECTION_PROVIDING
  // coverage, so the tracker-specific surface is exercised by hand below.

  suite.test("getDiscoverSections lists every section", async () => {
    const sections = await MangaBaka.getDiscoverSections();

    expect(sections).to.have.length.greaterThan(0);
    expect(sections.map((section) => section.id)).to.include.members([
      "trending",
      "rising",
      "genres",
    ]);
  });

  suite.test("getDiscoverSectionItems returns trending titles", async () => {
    const sections = await MangaBaka.getDiscoverSections();
    const trending = sections.find((section) => section.id === "trending");
    expect(trending, "no trending section").to.exist;

    const results = await MangaBaka.getDiscoverSectionItems(trending!, undefined);

    expect(results.items).to.not.be.empty;
    for (const item of results.items) {
      expect(item.type).to.equal("simpleCarouselItem");
    }
  });

  // The regression guard for `Could not convert JSValue: Invalid URL:`. Every section
  // is exercised, because the two that broke did so for different reasons: /v2 returns
  // a flattened cover shape, and sort_by=latest surfaces entries with no artwork.
  suite.test("every discover section yields usable items", async () => {
    for (const section of await MangaBaka.getDiscoverSections()) {
      if (section.id === "genres") continue;

      const results = await MangaBaka.getDiscoverSectionItems(section, undefined);
      expect(results.items, `${section.id} returned no items`).to.not.be.empty;

      for (const item of results.items) {
        if (item.type === "genresCarouselItem") continue;

        expect(item.imageUrl, `${section.id} item ${item.mangaId} has an empty imageUrl`).to.not.be
          .empty;
        expect(item.imageUrl, `${section.id} item ${item.mangaId} imageUrl is not a URL`).to.match(
          /^https?:\/\//,
        );
        expect(item.title, `${section.id} item ${item.mangaId} has no title`).to.not.be.empty;
      }
    }
  });

  suite.test("getDiscoverSectionItems returns the genre catalog", async () => {
    const sections = await MangaBaka.getDiscoverSections();
    const genres = sections.find((section) => section.id === "genres");
    expect(genres, "no genres section").to.exist;

    const results = await MangaBaka.getDiscoverSectionItems(genres!, undefined);
    expect(results.items).to.not.be.empty;
  });

  suite.test("getMangaDetails maps a manga", async () => {
    const manga = await MangaBaka.getMangaDetails(MANGA_ID);

    expect(manga.mangaId).to.equal(MANGA_ID);
    expect(manga.mangaInfo.primaryTitle).to.not.be.empty;
    expect(manga.mangaInfo.thumbnailUrl).to.not.be.empty;
    expect(manga.mangaInfo.contentType).to.equal("comic");
  });

  // Novels are first-class entries here and are deliberately not filtered out.
  suite.test("getMangaDetails marks a novel as a novel", async () => {
    const novel = await MangaBaka.getMangaDetails(NOVEL_ID);

    expect(novel.mangaInfo.contentType).to.equal("novel");
  });

  suite.test("search returns results and pages", async () => {
    const first = await MangaBaka.getSearchResults({ title: "chainsaw" }, undefined, undefined);

    expect(first.items).to.not.be.empty;
    expect(first.items[0]?.mangaId).to.not.be.empty;

    // The last page must omit `metadata` entirely rather than set it undefined.
    if (first.metadata !== undefined) {
      expect(first.metadata).to.be.a("number");
    }
  });

  suite.test("getSortingOptions exposes the sort_by vocabulary", async () => {
    const options = await MangaBaka.getSortingOptions({ title: "" });

    expect(options).to.not.be.empty;
    expect(options.map((option) => option.id)).to.include("trending_7d");
  });

  // Logged out, every /my/* surface must fail with a message that tells the user what
  // to do — not a bare HTTP code, and not a silent empty result.
  suite.test("progress surfaces explain themselves when logged out", async () => {
    const manga = await MangaBaka.getMangaDetails(MANGA_ID);

    let message = "";
    try {
      await MangaBaka.getMangaProgress(manga);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message.toLowerCase()).to.contain("log");
  });

  // The queue contract: never throw, and never silently swallow an action. Logged out,
  // nothing is attempted, so both arrays stay empty and the app retries later.
  suite.test("processChapterReadActionQueue never throws when logged out", async () => {
    const manga = await MangaBaka.getMangaDetails(MANGA_ID);

    const result = await MangaBaka.processChapterReadActionQueue([
      {
        id: "test-action",
        sourceManga: manga,
        chapterId: "1",
        chapterSourceId: "test",
        chapterMangaId: manga.mangaId,
        chapterNum: 1,
        creationDate: new Date(),
        errorCount: 0,
      },
    ]);

    expect(result.successfulItems).to.be.an("array");
    expect(result.failedItems).to.be.an("array");
  });

  await suite.run();
}
