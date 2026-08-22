/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type SourceManga } from "@paperback/types";

import {
  applySearchTerm,
  contentRatingOf,
  parseGenres,
  parseQueryResponse,
  parseSeriesDetail,
  toSearchResultItem,
} from "../../src/HiveToons/catalog.ts";
import {
  chapterIsPaid,
  cleanChapterTitle,
  isPaid,
  paidChapterError,
  parseChapterList,
  parseNovelBody,
  parsePages,
  toChapters,
} from "../../src/HiveToons/chapters.ts";
import { toPlainText, toXhtml } from "../../src/HiveToons/html.ts";
import { DEFAULT_FILTERS, DEFAULT_SORT, SORT_OPTIONS } from "../../src/HiveToons/models.ts";
import { chapterUrl, chaptersUrl, postUrl, queryUrl, seriesUrl } from "../../src/HiveToons/urls.ts";

/** The charset the Swift bridge validates every ID against — see docs/paperback/forms.md. */
const VALID_ID = /^[a-zA-Z0-9._\-@()[\]%?#+=/&:]+$/;

const SOURCE_MANGA: SourceManga = {
  mangaId: "15",
  mangaInfo: {
    primaryTitle: "A Title",
    secondaryTitles: [],
    thumbnailUrl: "",
    synopsis: "",
    contentRating: ContentRating.EVERYONE,
  },
};

const SOURCE_MANGA_CHAPTER = {
  chapterId: "chapter-71",
  sourceManga: SOURCE_MANGA,
  langCode: "en",
  chapNum: 71,
  volume: 0,
};

// --- Fixture builders ---

function post(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 15,
    slug: "a-series",
    postTitle: "A Series",
    featuredImage: "https://storage.hivetoon.com/cover.webp",
    seriesType: "MANHWA",
    seriesStatus: "ONGOING",
    hot: false,
    isPinned: false,
    genres: [{ id: 5, name: "Action" }],
    chapters: [
      { id: 1, number: 12, slug: "chapter-12", title: "", createdAt: "2026-08-20T00:00:00.000Z" },
    ],
    averageRating: 9.85,
    ...overrides,
  };
}

// --- Catalog ---

void test("parseQueryResponse keeps well-formed posts and drops malformed ones", () => {
  const parsed = parseQueryResponse({
    posts: [post(), { id: 2 }, "nonsense", null],
    totalCount: 313,
    searchTerm: "look",
  });

  assert.equal(parsed.posts.length, 1);
  assert.equal(parsed.totalCount, 313);
});

void test("an unreadable catalog response throws rather than reporting no results", () => {
  assert.throws(() => parseQueryResponse("<html>"), /unreadable catalog/);
});

// The trap: the origin's search collapses on some terms and answers with the entire catalog.
void test("a collapsed search is filtered down to what actually matches", () => {
  const { posts } = parseQueryResponse({
    posts: [
      post({ id: 1, postTitle: "The Bully In-Charge" }),
      post({ id: 2, postTitle: "Lookism" }),
      post({ id: 3, postTitle: "Together With the Gods" }),
    ],
    totalCount: 313,
  });

  assert.deepEqual(
    applySearchTerm(posts, "the").map((p) => p.postTitle),
    ["The Bully In-Charge", "Together With the Gods"],
  );
});

void test("every word of the query has to appear, in any order", () => {
  const { posts } = parseQueryResponse({
    posts: [post({ id: 1, postTitle: "The Bully In-Charge" }), post({ id: 2, postTitle: "Bully" })],
    totalCount: 2,
  });

  assert.deepEqual(
    applySearchTerm(posts, "bully the").map((p) => p.id),
    [1],
  );
});

// The origin also searches alternative titles, which the catalog response does not carry, so a
// result set that matches no title is a real alt-title hit rather than a collapse.
void test("an alternative-title match is left alone rather than filtered away", () => {
  const { posts } = parseQueryResponse({
    posts: [post({ id: 3, postTitle: "Get Schooled" })],
    totalCount: 1,
  });

  assert.deepEqual(
    applySearchTerm(posts, "True Education").map((p) => p.postTitle),
    ["Get Schooled"],
  );
});

void test("matching is case-insensitive and an empty term filters nothing", () => {
  const { posts } = parseQueryResponse({ posts: [post({ postTitle: "Lookism" })], totalCount: 1 });

  assert.equal(applySearchTerm(posts, "LOOKISM").length, 1);
  assert.equal(applySearchTerm(posts, "   ").length, 1);
});

// --- Ids ---

// Real slugs on this site contain `!` and `'`, both outside the bridge's ID charset. Keying by
// slug throws on device while passing every local test, so ids must be the numeric post id.
void test("mangaId is the numeric post id, so a hostile slug never reaches the bridge", () => {
  for (const slug of ["debut-or-die!-(novel)", "swordmanship-veteran's-game-stream"]) {
    assert.equal(VALID_ID.test(slug), false, `${slug} should be rejected as an ID`);

    const item = toSearchResultItem(
      parseQueryResponse({ posts: [post({ slug })], totalCount: 1 }).posts[0]!,
    );
    assert.equal(item.mangaId, "15");
    assert.ok(VALID_ID.test(item.mangaId));
  }
});

void test("every sort id is charset-safe, and the default is one of them", () => {
  for (const option of SORT_OPTIONS) assert.ok(VALID_ID.test(option.id), option.id);
  assert.ok(SORT_OPTIONS.some((option) => option.id === DEFAULT_SORT));
});

// Genre names carry spaces the bridge rejects in an ID; the numeric id is what the filter sends.
void test("genres parse to charset-safe ids, sorted, with junk dropped", () => {
  const options = parseGenres([
    { id: 27, name: "Slice of Life" },
    { id: 5, name: "Action" },
    { name: "no id" },
    "nonsense",
  ]);

  assert.deepEqual(
    options.map((option) => option.title),
    ["Action", "Slice of Life"],
  );
  for (const option of options) assert.ok(VALID_ID.test(option.id), option.id);
  assert.deepEqual(parseGenres({ not: "a list" }), []);
});

// The chapter endpoint is keyed by the numeric id, so that is what a chapterId has to be.
void test("chapter ids are the numeric id, and charset-safe", () => {
  const chapters = toChapters(
    parseChapterList({
      post: { chapters: [{ id: 20689, slug: "chapter-621", number: 621, price: 0 }] },
    }),
    SOURCE_MANGA,
    false,
  );

  assert.equal(chapters[0]!.chapterId, "20689");
  assert.ok(VALID_ID.test(chapters[0]!.chapterId));
});

void test("a search result carries its newest chapter as the subtitle", () => {
  const parsed = parseQueryResponse({ posts: [post()], totalCount: 1 });
  const item = toSearchResultItem(parsed.posts[0]!);

  assert.equal(item.title, "A Series");
  assert.equal(item.subtitle, "Chapter 12");
  assert.equal(item.contentRating, ContentRating.EVERYONE);
});

void test("a series with no chapters yet omits the subtitle rather than sending undefined", () => {
  const parsed = parseQueryResponse({ posts: [post({ chapters: [] })], totalCount: 1 });
  assert.equal("subtitle" in toSearchResultItem(parsed.posts[0]!), false);
});

void test("an ordinary title is EVERYONE", () => {
  assert.equal(contentRatingOf([{ id: 5, name: "Action" }]), ContentRating.EVERYONE);
  assert.equal(contentRatingOf([]), ContentRating.EVERYONE);
});

void test("mature-only genres rate MATURE", () => {
  for (const name of ["Mature", "Ecchi", "Gore"]) {
    assert.equal(
      contentRatingOf([
        { id: 5, name: "Action" },
        { id: 9, name },
      ]),
      ContentRating.MATURE,
      name,
    );
  }
});

// Shotacon was tagged on a live title and rated EVERYONE before this.
void test("explicit and sexualised-minor genres rate ADULT", () => {
  for (const name of ["Adult", "Hentai", "Smut", "Erotica", "Shotacon", "Lolicon"]) {
    assert.equal(
      contentRatingOf([
        { id: 5, name: "Action" },
        { id: 9, name },
      ]),
      ContentRating.ADULT,
      name,
    );
  }
});

void test("the strictest genre wins, whatever the order", () => {
  const mature = { id: 1, name: "Mature" };
  const adult = { id: 2, name: "Adult" };

  assert.equal(contentRatingOf([mature, adult]), ContentRating.ADULT);
  assert.equal(contentRatingOf([adult, mature]), ContentRating.ADULT);
});

// Matched on the name the site publishes, not on its arbitrary id, so a genre added later is
// still rated; and matched exactly, so an unrelated genre containing the word is not caught.
void test("rating follows the genre name, not its id, and matches exactly", () => {
  assert.equal(contentRatingOf([{ id: 99999, name: "  ADULT  " }]), ContentRating.ADULT);
  assert.equal(contentRatingOf([{ id: 19, name: "Adventure" }]), ContentRating.EVERYONE);
  assert.equal(contentRatingOf([{ id: 11, name: "Premature Ending" }]), ContentRating.EVERYONE);
});

// --- Series detail ---

void test("series details come from /api/post, and the rating is scaled to a fraction", () => {
  const manga = parseSeriesDetail(
    {
      post: {
        id: 15,
        slug: "a-series",
        postTitle: "A Series",
        postContent: "A synopsis.",
        alternativeTitles: "Another Name, A Third",
        seriesType: "MANHWA",
        seriesStatus: "HIATUS",
        featuredImage: "https://storage.hivetoon.com/cover.webp",
        artist: "An Artist",
        author: "An Author",
        averageRating: 9.85,
        genres: [
          { id: 5, name: "Action" },
          { id: 19, name: "Adult" },
        ],
      },
    },
    "15",
  );

  assert.equal(manga.mangaId, "15");
  assert.equal(manga.mangaInfo.primaryTitle, "A Series");
  assert.deepEqual(manga.mangaInfo.secondaryTitles, ["Another Name", "A Third"]);
  assert.equal(manga.mangaInfo.status, "Hiatus");
  assert.equal(manga.mangaInfo.artist, "An Artist");
  assert.equal(manga.mangaInfo.author, "An Author");
  assert.equal(manga.mangaInfo.contentType, "comic");
  // The fixture carries an Adult genre, which is the strictest level.
  assert.equal(manga.mangaInfo.contentRating, ContentRating.ADULT);
  // The app renders `rating` as a 0-1 fraction; the site rates out of ten.
  assert.equal(manga.mangaInfo.rating, 0.985);
  assert.ok(manga.mangaInfo.rating! <= 1);
});

void test("an alternative title identical to the primary is not repeated", () => {
  const manga = parseSeriesDetail(
    { post: { postTitle: "Lookism", alternativeTitles: "Lookism", genres: [] } },
    "15",
  );
  assert.deepEqual(manga.mangaInfo.secondaryTitles, []);
});

void test("a novel is typed as a novel", () => {
  const manga = parseSeriesDetail(
    { post: { postTitle: "A Novel", isNovel: true, genres: [] } },
    "7",
  );
  assert.equal(manga.mangaInfo.contentType, "novel");
});

void test("missing detail fields are omitted, never set to undefined", () => {
  const manga = parseSeriesDetail({ post: { postTitle: "Bare", genres: [] } }, "1");
  for (const key of ["status", "artist", "author", "rating", "bannerUrl", "tagGroups"]) {
    assert.equal(key in manga.mangaInfo, false, `${key} should be absent`);
  }
});

void test("an unreadable detail response throws rather than yielding an empty title", () => {
  assert.throws(() => parseSeriesDetail({}, "15"), /no series details/);
  assert.throws(() => parseSeriesDetail("<html>", "15"), /no series details/);
});

// --- Chapters ---

// price is the only trustworthy paywall signal: this exact combination served zero pages.
void test("a priced chapter is paid even when the site claims it is accessible", () => {
  const [chapter] = parseChapterList({
    post: {
      chapters: [
        { id: 2, slug: "chapter-70", number: 70, price: 100, isLocked: false, isAccessible: true },
      ],
    },
  });

  assert.equal(isPaid(chapter!), true);
});

void test("a chapter with no price field is free", () => {
  const [chapter] = parseChapterList({ post: { chapters: [{ id: 1, number: 1 }] } });
  assert.equal(chapter!.price, 0);
  assert.equal(isPaid(chapter!), false);
});

void test("paid chapters are listed by default and hidden only on request", () => {
  const entries = parseChapterList({
    post: {
      chapters: [
        { id: 71, number: 71, price: 100 },
        { id: 70, number: 70, price: 0 },
      ],
    },
  });

  assert.equal(toChapters(entries, SOURCE_MANGA, false).length, 2);
  assert.deepEqual(
    toChapters(entries, SOURCE_MANGA, true).map((c) => c.chapNum),
    [70],
  );
});

void test("decimal chapter numbers survive, and every chapter carries a volume", () => {
  const chapters = toChapters(
    parseChapterList({ post: { chapters: [{ id: 3, number: 132.5, price: 0 }] } }),
    SOURCE_MANGA,
    false,
  );

  assert.equal(chapters[0]!.chapNum, 132.5);
  // Unset renders as "Vol. TBA"; this site has no volumes.
  assert.equal(chapters[0]!.volume, 0);
});

void test("an unparseable timestamp is dropped rather than becoming an Invalid Date", () => {
  const chapters = toChapters(
    parseChapterList({
      post: {
        chapters: [
          { id: 1, number: 1, price: 0, createdAt: "2026-08-20T15:21:54.428Z" },
          { id: 2, number: 2, price: 0, createdAt: "not a date" },
        ],
      },
    }),
    SOURCE_MANGA,
    false,
  );

  assert.equal(chapters[0]!.publishDate?.toISOString(), "2026-08-20T15:21:54.428Z");
  assert.equal("publishDate" in chapters[1]!, false);
});

void test("an unreadable chapter list throws rather than reporting no chapters", () => {
  assert.throws(() => parseChapterList({}), /unreadable chapter list/);
});

// The app renders "Chapter {chapNum} - {title}", so a title carrying its own number reads twice.
// A number only labels a chapter when nothing word-like follows it, or "1st Year" loses its digit.
void test("an ordinal or number that begins a real title is left alone", () => {
  assert.equal(cleanChapterTitle("1st Year"), "1st Year");
  assert.equal(cleanChapterTitle("2nd Awakening"), "2nd Awakening");
  assert.equal(cleanChapterTitle("3D"), "3D");
});

void test("a leading chapter number is stripped from the title", () => {
  assert.equal(cleanChapterTitle("117"), undefined);
  assert.equal(cleanChapterTitle("Chapter 5 - The Fall"), "The Fall");
  assert.equal(cleanChapterTitle("5. The Fall"), "The Fall");
  assert.equal(cleanChapterTitle("Ep. 12 Beginnings"), "Beginnings");
  assert.equal(cleanChapterTitle("Gapryong Kim [12]"), "Gapryong Kim [12]");
  assert.equal(cleanChapterTitle(""), undefined);
  assert.equal(cleanChapterTitle(undefined), undefined);
});

// getChapterDetails is handed the Chapter and nothing else, so the price has to ride along on it.
void test("a paid chapter carries its price forward, and a free one carries nothing", () => {
  const entries = parseChapterList({
    post: {
      chapters: [
        { id: 71, number: 71, price: 100, unlockAt: "2026-08-28T18:10:03.668Z" },
        { id: 70, number: 70, price: 0 },
      ],
    },
  });
  const [paid, free] = toChapters(entries, SOURCE_MANGA, false);

  assert.equal(chapterIsPaid(paid!), true);
  assert.equal(paid!.additionalInfo?.unlockAt, "2026-08-28T18:10:03.668Z");
  assert.equal(chapterIsPaid(free!), false);
  assert.equal("additionalInfo" in free!, false);
});

void test("the paywall error names the unlock date when the site gives one", () => {
  const withDate = paidChapterError({
    ...SOURCE_MANGA_CHAPTER,
    additionalInfo: { price: "100", unlockAt: "2026-08-28T18:10:03.668Z" },
  });
  assert.match(withDate.message, /costs coins/);
  assert.match(withDate.message, /unlocks on/);

  const undated = paidChapterError({ ...SOURCE_MANGA_CHAPTER, additionalInfo: { price: "100" } });
  assert.match(undated.message, /costs coins/);
  assert.equal(undated.message.includes("unlocks on"), false);
});

void test("an unparseable unlock date is left out rather than printed as Invalid Date", () => {
  const error = paidChapterError({
    ...SOURCE_MANGA_CHAPTER,
    additionalInfo: { price: "100", unlockAt: "soon" },
  });
  assert.equal(error.message.includes("Invalid Date"), false);
});

// --- Chapter content ---

void test("pages are ordered by the API's own order field, not array position", () => {
  const pages = parsePages({
    chapter: {
      images: [
        { url: "https://storage.hivetoon.com/2.webp", order: 1 },
        { url: "https://storage.hivetoon.com/1.webp", order: 0 },
        { order: 2 },
      ],
    },
  });

  assert.deepEqual(pages, [
    "https://storage.hivetoon.com/1.webp",
    "https://storage.hivetoon.com/2.webp",
  ]);
});

void test("a paywalled chapter yields no pages rather than throwing", () => {
  assert.deepEqual(parsePages({ chapter: { images: [] } }), []);
  assert.deepEqual(parsePages({}), []);
});

// The site stores synopses as markup — paragraphs, styled spans pasted out of Discord — where
// MangaInfo.synopsis is plain text and would print the tags verbatim.
void test("a synopsis is reduced to plain text", () => {
  assert.equal(toPlainText("<p>One.</p><p>Two.</p>"), "One.\n\nTwo.");
  assert.equal(toPlainText("a<br>b"), "a\nb");
  assert.equal(
    toPlainText('<p><span style="color: oklab(0.85 0.01 -0.04)">Styled.</span></p>'),
    "Styled.",
  );
  assert.equal(
    toPlainText("<p><strong>Bold</strong> and <em>italic</em>.</p>"),
    "Bold and italic.",
  );
});

void test("entities in a synopsis are decoded, including numeric ones", () => {
  assert.equal(
    toPlainText("<p>&quot;Quoted&quot; &amp; &lt;bracketed&gt;</p>"),
    '"Quoted" & <bracketed>',
  );
  assert.equal(toPlainText("<p>&#8217;&#x2014;</p>"), "’—");
  assert.equal(toPlainText("<p>a&nbsp;b</p>"), "a b");
});

// A title in angle brackets is prose, not a tag, and survives intact.
void test("angle-bracketed prose is not mistaken for markup", () => {
  assert.equal(
    toPlainText("<p>The story of &lt;A Title&gt; begins.</p>"),
    "The story of <A Title> begins.",
  );
});

void test("runs of blank lines collapse, and an empty synopsis stays empty", () => {
  assert.equal(toPlainText("<p>a</p><p></p><p></p><p>b</p>"), "a\n\nb");
  assert.equal(toPlainText(""), "");
  assert.equal(toPlainText("<p></p>"), "");
});

// The reader parses `html` chapters with an XML parser, and only applies HTML semantics inside
// the XHTML namespace. Both failures are device-only. See docs/paperback/html-chapters.md.
void test("void elements are self-closed so the document parses as XML", () => {
  assert.match(toXhtml("<p>a<br>b</p>"), /<p>a<br\/>b<\/p>/);
  assert.match(toXhtml('<img src="x.png" >'), /<img src="x.png"\/>/);
  // Already self-closed markup must not gain a second slash.
  assert.match(toXhtml("<hr/>"), /<hr\/>/);
});

void test("entities beyond XML's five are resolved, and unknown ones degrade to text", () => {
  // XML predefines only these five, so they pass through untouched.
  assert.match(toXhtml("<p>&amp;&lt;&gt;&quot;&apos;</p>"), /&amp;&lt;&gt;&quot;&apos;/);
  // Anything else is fatal to an XML parser, so it becomes the character itself.
  assert.match(toXhtml("<p>&mdash;&hellip;&rsquo;</p>"), /<p>—…’<\/p>/);
  assert.equal(toXhtml("<p>&nbsp;</p>").includes("&nbsp;"), false);
  // An unmapped entity is shown rather than allowed to abort the whole chapter.
  assert.match(toXhtml("<p>&bogus;</p>"), /<p>&amp;bogus;<\/p>/);
});

void test("the fragment is wrapped in the XHTML namespace", () => {
  const doc = toXhtml("<p>x</p>");

  // Without this the XML parses but every element is anonymous, and the whole
  // chapter renders as one run-together line.
  assert.match(doc, /^<html xmlns="http:\/\/www\.w3\.org\/1999\/xhtml">/);
  assert.match(doc, /<body><p>x<\/p><\/body><\/html>$/);
});

void test("a novel body is read from the same endpoint and wrapped as XHTML", () => {
  const doc = parseNovelBody({ chapter: { content: "<p>Text.</p>" } });

  assert.match(doc!, /<body><p>Text\.<\/p><\/body>/);
  assert.equal(parseNovelBody({ chapter: {} }), undefined);
  assert.equal(parseNovelBody({}), undefined);
});

// --- URLs ---

void test("a browse url carries only the filters that are set", () => {
  const url = queryUrl({ ...DEFAULT_FILTERS, page: 2 }, DEFAULT_SORT);

  assert.ok(url.includes("page=2"));
  assert.ok(url.includes("perPage=100"));
  assert.ok(url.includes("view=archive"));
  assert.ok(url.includes("orderBy=lastChapterAddedAt"));
  assert.ok(url.includes("orderDirection=desc"));
  for (const absent of ["searchTerm", "genreIds", "seriesType", "seriesStatus", "minChapters"]) {
    assert.equal(url.includes(absent), false, `${absent} should be absent`);
  }
});

void test("included and excluded genres are sent as separate comma-separated lists", () => {
  const url = queryUrl(
    { ...DEFAULT_FILTERS, page: 1, includedGenres: ["5", "7"], excludedGenres: ["25"] },
    "totalViews:desc",
  );

  assert.ok(url.includes("genreIds=5%2C7"));
  assert.ok(url.includes("excludedGenreIds=25"));
  assert.ok(url.includes("orderBy=totalViews"));
});

void test("a search term is percent-encoded into the browse url", () => {
  const url = queryUrl({ ...DEFAULT_FILTERS, page: 1, searchTerm: "a wimp's" }, DEFAULT_SORT);
  assert.ok(url.includes("searchTerm=a%20wimp's") || url.includes("searchTerm=a%20wimp%27s"));
});

void test("a slug with url-hostile characters is encoded into the series path", () => {
  assert.equal(
    seriesUrl("debut-or-die!-(novel)").startsWith("https://hivetoons.org/series/"),
    true,
  );
  assert.equal(seriesUrl("a b").endsWith("a%20b"), true);
});

// Every read is keyed by a numeric id on the api host; the main host 404s all of these.
void test("reads are keyed by id against the api host", () => {
  for (const url of [chaptersUrl("15"), postUrl("15"), chapterUrl("20689")]) {
    assert.ok(url.startsWith("https://api.hivetoons.org/"), url);
  }
  assert.ok(chaptersUrl("15").includes("take=all"));
  assert.ok(postUrl("15").includes("postId=15"));
  assert.ok(chapterUrl("20689").includes("chapterId=20689"));
});
