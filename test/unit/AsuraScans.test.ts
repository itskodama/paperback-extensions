/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter, type Cookie } from "@paperback/types";

import {
  asuraCookieValue,
  buildSession,
  isSessionExpired,
  isValidSession,
  unwrapEnvelope,
  type AsuraSession,
} from "../../src/AsuraScans/auth.ts";
import {
  chapterIsLocked,
  parseChapterApiPayload,
  parseChapterList,
} from "../../src/AsuraScans/comics.ts";
import { formatCount } from "../../src/AsuraScans/format.ts";
import { DEFAULT_SORT, SORT_OPTIONS } from "../../src/AsuraScans/models.ts";
import {
  novelCatalogEntry,
  novelChapterIsLocked,
  novelToSourceManga,
  parseNovelCatalog,
  parseNovelChapterApiPayload,
  parseNovelChapterDetails,
  parseNovelChapterList,
} from "../../src/AsuraScans/novels.ts";
import {
  type RankedSearchResult,
  mergeRankedResults,
  parseNovelSearchResults,
  rankedSearchResults,
} from "../../src/AsuraScans/search.ts";
import { subscriptionSubtitle } from "../../src/AsuraScans/settingsForm.ts";
import {
  isNovelMangaId,
  novelChapterUrl,
  novelSearchUrl,
  novelSlugFromMangaId,
  novelUrl,
} from "../../src/AsuraScans/urls.ts";

const LOCKED_WITH_UNLOCK_TIME = `
<astro-island props="{&quot;pages&quot;:[1,[]],&quot;chapterId&quot;:[0,173],&quot;isLocked&quot;:[0,true],&quot;isPremium&quot;:[0,true],&quot;unlockTime&quot;:[0,&quot;2026-07-28T23:10:15Z&quot;]}"></astro-island>
`;

const LOCKED_WITHOUT_UNLOCK_TIME = `
<astro-island props="{&quot;pages&quot;:[1,[]],&quot;chapterId&quot;:[0,173],&quot;isLocked&quot;:[0,true]}"></astro-island>
`;

const UNLOCKED = `
<astro-island props="{&quot;pages&quot;:[1,[]],&quot;chapterId&quot;:[0,5],&quot;isLocked&quot;:[0,false],&quot;isPremium&quot;:[0,false]}"></astro-island>
`;

void test("chapterIsLocked is true when isLocked is set, regardless of unlockTime", () => {
  assert.equal(chapterIsLocked(LOCKED_WITH_UNLOCK_TIME), true);
  assert.equal(chapterIsLocked(LOCKED_WITHOUT_UNLOCK_TIME), true);
});

void test("chapterIsLocked is false once neither isLocked nor isPremium is set", () => {
  assert.equal(chapterIsLocked(UNLOCKED), false);
});

const testChapter: Chapter = {
  chapterId: "173",
  sourceManga: {
    mangaId: "return-of-the-mount-hua-sect",
    mangaInfo: {
      thumbnailUrl: "https://cdn.asurascans.com/covers/test.webp",
      synopsis: "A test synopsis.",
      primaryTitle: "Return of the Mount Hua Sect",
      secondaryTitles: [],
      contentRating: ContentRating.MATURE,
    },
  },
  langCode: "en",
  chapNum: 173,
};

// Trimmed from a real response captured against the authenticated endpoint
const UNLOCKED_API_PAYLOAD = {
  is_locked: false,
  access_gate: "",
  unlock_time: "2026-07-28T23:10:15.108557Z",
  chapter: {
    id: 260408,
    series_id: 1943,
    number: 173,
    slug: "chapter-173",
    pages: [
      {
        url: "https://cdn.asurascans.com/asura-images/chapters/.../53fcf7.webp",
        width: 1200,
        height: 800,
      },
      {
        url: "https://cdn.asurascans.com/asura-images/chapters/.../2f8f4e60.webp",
        width: 900,
        height: 16000,
      },
    ],
    page_count: 2,
    is_premium: true,
    comments_enabled: true,
    early_access_until: "2026-07-28T23:10:15.108557Z",
    published_at: "2026-07-28T17:10:15.108557Z",
    view_count: 22391,
    created_at: "2026-07-28T17:10:15.344816Z",
    series_slug: "return-of-the-mount-hua-sect",
  },
};

const LOCKED_API_PAYLOAD = {
  is_locked: true,
  access_gate: "",
  unlock_time: "2026-07-28T23:10:15.108557Z",
  chapter: {
    id: 260408,
    series_id: 1943,
    number: 173,
    slug: "chapter-173",
    page_count: 0,
    is_premium: true,
    comments_enabled: true,
    early_access_until: "2026-07-28T23:10:15.108557Z",
    published_at: "2026-07-28T17:10:15.108557Z",
    view_count: 22391,
    created_at: "2026-07-28T17:10:15.344816Z",
    series_slug: "return-of-the-mount-hua-sect",
  },
};

void test("parseChapterApiPayload maps an unlocked authenticated response to real pages", () => {
  const details = parseChapterApiPayload(UNLOCKED_API_PAYLOAD, testChapter);
  assert.equal(details.id, "173");
  assert.equal(details.mangaId, "return-of-the-mount-hua-sect");
  assert.ok("pages" in details);
  assert.deepEqual(details.pages, [
    "https://cdn.asurascans.com/asura-images/chapters/.../53fcf7.webp",
    "https://cdn.asurascans.com/asura-images/chapters/.../2f8f4e60.webp",
  ]);
});

void test("parseChapterApiPayload throws the early-access message when still locked", () => {
  assert.throws(
    () => parseChapterApiPayload(LOCKED_API_PAYLOAD, testChapter),
    /in early access until/,
  );
});

void test("parseChapterApiPayload throws rather than returning a silently blank chapter", () => {
  const noPages = { is_locked: false, chapter: { ...UNLOCKED_API_PAYLOAD.chapter, pages: [] } };
  assert.throws(() => parseChapterApiPayload(noPages, testChapter), /served no pages/);
});

function session(overrides: Partial<AsuraSession> = {}): AsuraSession {
  return {
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    username: "ItsKodama",
    hasSubscription: true,
    ...overrides,
  };
}

void test("isSessionExpired is false for a fresh token", () => {
  assert.equal(isSessionExpired(session()), false);
});

void test("isSessionExpired is true inside the 60s safety margin", () => {
  const now = Date.now();
  const almostExpired = session({ expiresAt: new Date(now + 30_000).toISOString() });
  assert.equal(isSessionExpired(almostExpired, now), true);
});

void test("isSessionExpired is true once expiresAt is in the past", () => {
  const now = Date.now();
  const expired = session({ expiresAt: new Date(now - 1000).toISOString() });
  assert.equal(isSessionExpired(expired, now), true);
});

void test("isValidSession accepts a well-formed session", () => {
  assert.equal(isValidSession(session()), true);
});

void test("isValidSession rejects malformed or missing shapes", () => {
  assert.equal(isValidSession(undefined), false);
  assert.equal(isValidSession(null), false);
  assert.equal(isValidSession({ ...session(), accessToken: "" }), false);
  assert.equal(isValidSession({ ...session(), hasSubscription: "yes" }), false);
  const { accessToken: _unused, ...missingAccessToken } = session();
  assert.equal(isValidSession(missingAccessToken), false);
});

void test("a session survives the JSON stringify/parse round trip getSession relies on", () => {
  const original = session({ tier: "premium", subscriptionStatus: "active" });
  const roundTripped: unknown = JSON.parse(JSON.stringify(original));
  assert.ok(isValidSession(roundTripped));
  assert.deepEqual(roundTripped, original);
});

// Captured verbatim from a real POST /api/auth/login response — no subscription_status here
// (see REAL_REFRESH_RESPONSE below, where it does appear)
const REAL_LOGIN_RESPONSE = {
  data: {
    user: {
      id: 2006629,
      email: "aaronb954@gmail.com",
      username: "ItsKodama",
      role: "premium",
      premium_until: "2027-07-29T10:00:00Z",
    },
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2026-07-28T23:16:47.58917599Z",
  },
};

// Captured verbatim from a real POST /api/auth/refresh response for the same account
const REAL_REFRESH_RESPONSE = {
  data: {
    ...REAL_LOGIN_RESPONSE.data,
    subscription_status: {
      has_subscription: true,
      status: "active",
      tier: "premium",
      cancel_at_period_end: false,
      migration_required: false,
      is_banned: false,
    },
  },
};

void test("unwrapEnvelope unwraps a successful {data: ...} response", () => {
  assert.deepEqual(unwrapEnvelope(REAL_LOGIN_RESPONSE), REAL_LOGIN_RESPONSE.data);
});

void test("unwrapEnvelope passes a flat error body through unchanged", () => {
  const errorBody = { error: "invalid credentials" };
  assert.deepEqual(unwrapEnvelope(errorBody), errorBody);
});

void test("buildSession maps a real unwrapped login response end to end", () => {
  const built = buildSession(
    unwrapEnvelope(REAL_LOGIN_RESPONSE) as Parameters<typeof buildSession>[0],
  );
  assert.equal(built.username, "ItsKodama");
  assert.equal(built.accessToken, "token");
  assert.equal(built.refreshToken, "refresh");
});

void test("buildSession throws rather than silently building a session with missing fields", () => {
  assert.throws(
    () => buildSession(REAL_LOGIN_RESPONSE as unknown as Parameters<typeof buildSession>[0]),
    /incomplete session/,
  );
});

void test("login has no subscription_status, so hasSubscription falls back to role + premium_until", () => {
  const built = buildSession(
    unwrapEnvelope(REAL_LOGIN_RESPONSE) as Parameters<typeof buildSession>[0],
  );
  assert.equal(built.hasSubscription, true);
  assert.equal(built.tier, "premium");
  assert.equal(built.subscriptionStatus, undefined);
});

void test("a free user's login (role 'user', no premium_until) has no subscription", () => {
  const freeUser = {
    user: { username: "Reader", role: "user" },
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2026-07-28T23:16:47Z",
  };
  const built = buildSession(freeUser);
  assert.equal(built.hasSubscription, false);
});

void test("a premium role with a past premium_until has no active subscription", () => {
  const lapsed = {
    user: { username: "Reader", role: "premium", premium_until: "2020-01-01T00:00:00Z" },
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2026-07-28T23:16:47Z",
  };
  assert.equal(buildSession(lapsed).hasSubscription, false);
});

void test("staff roles always count as having a subscription, premium_until or not", () => {
  const staff = {
    user: { username: "Mod", role: "moderator" },
    access_token: "token",
    refresh_token: "refresh",
    expires_at: "2026-07-28T23:16:47Z",
  };
  assert.equal(buildSession(staff).hasSubscription, true);
});

void test("refresh's subscription_status is used when present, overriding the role fallback", () => {
  const built = buildSession(
    unwrapEnvelope(REAL_REFRESH_RESPONSE) as Parameters<typeof buildSession>[0],
  );
  assert.equal(built.hasSubscription, true);
  assert.equal(built.tier, "premium");
  assert.equal(built.subscriptionStatus, "active");
});

// --- Novels ---

const NOVEL_CATALOG_HTML = `
<astro-island props="{&quot;initialItems&quot;:[1,[[0,{&quot;id&quot;:[0,42],&quot;slug&quot;:[0,&quot;test-novel&quot;],&quot;title&quot;:[0,&quot;Test Novel&quot;],&quot;alternative_titles&quot;:[0,&quot;Alt One•Alt Two&quot;],&quot;description&quot;:[0,&quot;&lt;p&gt;A test synopsis.&lt;/p&gt;&quot;],&quot;cover_url&quot;:[0,&quot;https://cdn.asurascans.com/covers/test.webp&quot;],&quot;status&quot;:[0,&quot;ongoing&quot;],&quot;author&quot;:[0,&quot;Test Author&quot;],&quot;genres&quot;:[1,[[0,&quot;Psychological&quot;],[0,&quot;Fantasy&quot;]]],&quot;genre_ids&quot;:[1,[[0,7],[0,3]]],&quot;chapter_count&quot;:[0,120],&quot;rating&quot;:[0,8.5],&quot;rating_count&quot;:[0,340],&quot;bookmarks&quot;:[0,5200]}]]]}"></astro-island>
`;

void test("parseNovelCatalog extracts entries from the initialItems island", () => {
  const catalog = parseNovelCatalog(NOVEL_CATALOG_HTML);
  assert.equal(catalog.length, 1);
});

void test("novelCatalogEntry finds a matching slug and ignores the rest", () => {
  const catalog = parseNovelCatalog(NOVEL_CATALOG_HTML);
  assert.ok(novelCatalogEntry(catalog, "test-novel"));
  assert.equal(novelCatalogEntry(catalog, "nonexistent"), undefined);
});

// A fabricated already-decoded entry, same fields as the fixture above
const NOVEL_ENTRY = {
  id: 42,
  slug: "test-novel",
  title: "Test Novel",
  alternative_titles: "Alt One•Alt Two",
  description: "<p>A test synopsis.</p>",
  cover_url: "https://cdn.asurascans.com/covers/test.webp",
  status: "ongoing",
  author: "Test Author",
  genres: ["Psychological", "Fantasy"],
  genre_ids: [7, 3],
  chapter_count: 120,
  rating: 8.5,
  rating_count: 340,
  bookmarks: 5200,
  recent_chapters: [{ number: 118 }, { number: 117 }],
};

void test("novelToSourceManga maps contentType, genre ids, rating fraction, and alt titles", () => {
  const manga = novelToSourceManga(NOVEL_ENTRY);
  assert.equal(manga.mangaId, "novel:test-novel");
  assert.equal(manga.mangaInfo.contentType, "novel");
  assert.equal(manga.mangaInfo.contentRating, ContentRating.MATURE);
  assert.equal(manga.mangaInfo.primaryTitle, "Test Novel");
  assert.deepEqual(manga.mangaInfo.secondaryTitles, ["Alt One", "Alt Two"]);
  assert.equal(manga.mangaInfo.rating, 0.85);
  assert.equal(manga.mangaInfo.status, "Ongoing");
  const tags = manga.mangaInfo.tagGroups?.[0]?.tags;
  assert.deepEqual(
    tags?.map((t) => t.id),
    ["7", "3"],
  );
  assert.deepEqual(
    tags?.map((t) => t.title),
    ["Psychological", "Fantasy"],
  );
});

// A Tag.id outside the bridge's charset throws on device the moment the series page opens,
// so the genre_ids fallback can never be a raw genre name. See docs/paperback/forms.md.
void test("novelToSourceManga sanitizes the genre tag id when genre_ids is short", () => {
  const tags = novelToSourceManga({
    ...NOVEL_ENTRY,
    genres: ["Psychological", "Slice of Life", "Sci-Fi & Fantasy"],
    genre_ids: [7],
  }).mangaInfo.tagGroups?.[0]?.tags;

  assert.deepEqual(
    tags?.map((t) => t.id),
    ["7", "slice-of-life", "sci-fi-&-fantasy"],
  );
  // The display text keeps the site's own spelling either way.
  assert.deepEqual(
    tags?.map((t) => t.title),
    ["Psychological", "Slice of Life", "Sci-Fi & Fantasy"],
  );
});

void test("novelToSourceManga never emits an empty tag id", () => {
  const tags = novelToSourceManga({
    ...NOVEL_ENTRY,
    genres: ["!!!"],
    genre_ids: [],
  }).mangaInfo.tagGroups?.[0]?.tags;

  assert.deepEqual(
    tags?.map((t) => t.id),
    ["unknown"],
  );
});

void test("isNovelMangaId/novelSlugFromMangaId distinguish a novel id from a plain comic slug", () => {
  assert.equal(isNovelMangaId("novel:test-novel"), true);
  assert.equal(isNovelMangaId("test-novel"), false);
  assert.equal(novelSlugFromMangaId("novel:test-novel"), "test-novel");
  assert.equal(novelSlugFromMangaId("test-novel"), "test-novel");
});

void test("novelUrl/novelChapterUrl strip the novel: prefix when building the real site URL", () => {
  const manga = novelToSourceManga(NOVEL_ENTRY);
  assert.equal(novelUrl(manga.mangaId), "https://asurascans.com/novels/test-novel");
  const chapter: Chapter = { chapterId: "12", sourceManga: manga, langCode: "en", chapNum: 12 };
  assert.equal(novelChapterUrl(chapter), "https://asurascans.com/novels/test-novel/chapter/12");
});

const NOVEL_CHAPTERS_HTML = `
<astro-island props="{&quot;novelSlug&quot;:[0,&quot;test-novel&quot;],&quot;totalChapters&quot;:[0,2],&quot;chapters&quot;:[1,[[0,{&quot;id&quot;:[0,900],&quot;number&quot;:[0,12],&quot;title&quot;:[0,&quot;Homecoming&quot;],&quot;date&quot;:[0,&quot;4d ago&quot;],&quot;free&quot;:[0,true],&quot;shardCost&quot;:[0,0]}],[0,{&quot;id&quot;:[0,901],&quot;number&quot;:[0,13],&quot;title&quot;:[0,null],&quot;date&quot;:[0,null],&quot;free&quot;:[0,false],&quot;shardCost&quot;:[0,100]}]]]}"></astro-island>
`;

void test("parseNovelChapterList uses the chapter number as chapterId, not the row id", () => {
  const sourceManga = novelToSourceManga(NOVEL_ENTRY);
  const chapters = parseNovelChapterList(NOVEL_CHAPTERS_HTML, sourceManga);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0]!.chapterId, "12");
  assert.equal(chapters[0]!.title, "Homecoming");
  assert.equal(chapters[0]!.volume, 0);
});

void test("parseNovelChapterList parses '4d ago' into an approximate publishDate", () => {
  const sourceManga = novelToSourceManga(NOVEL_ENTRY);
  const chapters = parseNovelChapterList(NOVEL_CHAPTERS_HTML, sourceManga);
  const daysAgo = (Date.now() - chapters[0]!.publishDate!.getTime()) / 86_400_000;
  assert.ok(daysAgo > 3.9 && daysAgo < 4.1);
});

void test("parseNovelChapterList leaves title/publishDate undefined rather than throwing", () => {
  const sourceManga = novelToSourceManga(NOVEL_ENTRY);
  const chapters = parseNovelChapterList(NOVEL_CHAPTERS_HTML, sourceManga);
  assert.equal(chapters[1]!.title, undefined);
  assert.equal(chapters[1]!.publishDate, undefined);
});

const novelChapter: Chapter = {
  chapterId: "12",
  sourceManga: novelToSourceManga(NOVEL_ENTRY),
  langCode: "en",
  chapNum: 12,
};

const NOVEL_CHAPTER_LOCKED = `
<astro-island props="{&quot;paragraphs&quot;:[1,[]],&quot;isLocked&quot;:[0,true],&quot;shardCost&quot;:[0,100]}"></astro-island>
`;

const NOVEL_CHAPTER_UNLOCKED = `
<astro-island props="{&quot;paragraphs&quot;:[1,[[0,&quot;&lt;p&gt;Hello&amp;nbsp;World.&lt;/p&gt;&quot;],[0,&quot;&lt;p&gt;Second paragraph.&lt;/p&gt;&quot;]]],&quot;isLocked&quot;:[0,false],&quot;shardCost&quot;:[0,0]}"></astro-island>
`;

void test("novelChapterIsLocked reflects the anonymous isLocked flag", () => {
  assert.equal(novelChapterIsLocked(NOVEL_CHAPTER_LOCKED), true);
  assert.equal(novelChapterIsLocked(NOVEL_CHAPTER_UNLOCKED), false);
});

void test("parseNovelChapterDetails maps free-chapter paragraphs to well-formed XHTML", () => {
  const details = parseNovelChapterDetails(NOVEL_CHAPTER_UNLOCKED, novelChapter);
  assert.equal(details.type, "html");
  assert.ok(details.type === "html");
  assert.ok(details.html.startsWith('<html xmlns="http://www.w3.org/1999/xhtml">'));
  assert.ok(details.html.includes("<p>Hello&#160;World.</p>"));
  assert.ok(details.html.includes("<p>Second paragraph.</p>"));
  assert.ok(!details.html.includes("&nbsp;"));
});

void test("parseNovelChapterDetails throws the shard-cost message when locked", () => {
  assert.throws(() => parseNovelChapterDetails(NOVEL_CHAPTER_LOCKED, novelChapter), /100 shards/);
});

const UNLOCKED_NOVEL_API_PAYLOAD = {
  is_locked: false,
  content_html: "<p>Real unlocked chapter text.</p>",
  title: "Homecoming",
  number: 12,
  id: 900,
  shard_cost: 0,
  unlock_time: null,
};

const LOCKED_NOVEL_API_PAYLOAD = {
  is_locked: true,
  content_html: null,
  title: "Homecoming",
  number: 12,
  id: 900,
  shard_cost: 100,
  unlock_time: "2026-08-01T00:00:00Z",
};

void test("parseNovelChapterApiPayload maps unlocked content_html to XHTML", () => {
  const details = parseNovelChapterApiPayload(UNLOCKED_NOVEL_API_PAYLOAD, novelChapter);
  assert.ok(details.type === "html");
  assert.ok(details.html.includes("Real unlocked chapter text."));
});

void test("parseNovelChapterApiPayload throws when content_html is null", () => {
  assert.throws(
    () => parseNovelChapterApiPayload(LOCKED_NOVEL_API_PAYLOAD, novelChapter),
    /100 shards/,
  );
});

void test("novelSearchUrl omits falsy/'all' params and comma-joins multiple genres", () => {
  const url = new URL(
    novelSearchUrl({
      search: "dragon",
      genres: ["fantasy", "psychological"],
      status: "all",
      minChapters: 0,
    }),
  );
  assert.equal(url.searchParams.get("search"), "dragon");
  assert.equal(url.searchParams.get("genres"), "fantasy,psychological");
  assert.equal(url.searchParams.has("status"), false);
  assert.equal(url.searchParams.has("min_chapters"), false);
});

void test("novelSearchUrl includes min_chapters/artist even though they're currently server no-ops", () => {
  const url = new URL(novelSearchUrl({ minChapters: 50, artist: "Someone" }));
  assert.equal(url.searchParams.get("min_chapters"), "50");
  assert.equal(url.searchParams.get("artist"), "Someone");
});

void test("novelSearchUrl includes sort/order/limit and omits offset when it's 0", () => {
  const url = new URL(novelSearchUrl({ sort: "title", direction: "asc", limit: 50, offset: 0 }));
  assert.equal(url.searchParams.get("sort"), "title");
  assert.equal(url.searchParams.get("order"), "asc");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.has("offset"), false);
  assert.equal(new URL(novelSearchUrl({ offset: 20 })).searchParams.get("offset"), "20");
});

void test("parseNovelSearchResults maps entries to SearchResultItem with the novel: prefix", () => {
  const { items, total } = parseNovelSearchResults({
    data: [
      {
        id: 10,
        slug: "a-painter-who-draws-dungeons",
        title: "A Painter Who Draws Dungeons",
        cover_url: "https://cdn.asurascans.com/covers/painter.webp",
        status: "ongoing",
        recent_chapters: [{ number: 101 }, { number: 100 }],
      },
    ],
    meta: { total: 1 },
  });
  assert.equal(total, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0]!.mangaId, "novel:a-painter-who-draws-dungeons");
  assert.equal(items[0]!.title, "A Painter Who Draws Dungeons");
  assert.equal(items[0]!.subtitle, "Novel | Chapter 101");
  assert.equal(items[0]!.imageUrl, "https://cdn.asurascans.com/covers/painter.webp");
});

void test("parseNovelSearchResults falls back total to entries.length when meta is missing", () => {
  const { total } = parseNovelSearchResults({
    data: [
      { slug: "a", title: "A" },
      { slug: "b", title: "B" },
    ],
  });
  assert.equal(total, 2);
});

// `received` is what the offset advances by. Paging on items.length would stall on any page
// whose entries were dropped for having no slug, re-requesting the same offset forever.
void test("parseNovelSearchResults counts entries the API sent, not entries that parsed", () => {
  const { items, received, total } = parseNovelSearchResults({
    data: [{ slug: "a", title: "A" }, { title: "no slug" }, { slug: "c", title: "C" }],
    meta: { total: 30 },
  });

  assert.equal(items.length, 2);
  assert.equal(received, 3);
  assert.equal(total, 30);
});

void test("parseNovelSearchResults reports zero received for a page with nothing usable", () => {
  const { items, received } = parseNovelSearchResults({
    data: [{ title: "no slug" }, { title: "also no slug" }],
    meta: { total: 30 },
  });

  assert.equal(items.length, 0);
  assert.equal(received, 2);
});

void test("parseNovelSearchResults skips an entry with no slug rather than throwing", () => {
  const { items } = parseNovelSearchResults({ data: [{ title: "No Slug" }], meta: { total: 1 } });
  assert.equal(items.length, 0);
});

function ranked(overrides: Partial<RankedSearchResult> & { title: string }): RankedSearchResult {
  return {
    item: {
      mangaId: overrides.title,
      title: overrides.title,
      imageUrl: "",
      contentRating: ContentRating.MATURE,
    },
    ...overrides,
  };
}

const COMIC_BROWSE_HTML = `
<astro-island props="{&quot;initialSeries&quot;:[1,[[0,{&quot;slug&quot;:[0,&quot;test-comic&quot;],&quot;title&quot;:[0,&quot;Test Comic&quot;],&quot;cover&quot;:[0,&quot;https://cdn.asurascans.com/covers/comic.webp&quot;],&quot;rating&quot;:[0,9.0],&quot;created_at&quot;:[0,&quot;2026-07-01T00:00:00Z&quot;],&quot;last_chapter_at&quot;:[0,&quot;2026-07-28T00:00:00Z&quot;],&quot;bookmark_count&quot;:[0,500],&quot;latest_chapters&quot;:[1,[[0,{&quot;number&quot;:[0,42]}],[0,{&quot;number&quot;:[0,41]}]]]}]]],&quot;initialTotalPages&quot;:[0,1],&quot;initialCurrentPage&quot;:[0,1]}"></astro-island>
`;

void test("rankedSearchResults builds a 'Comic | Chapter N' subtitle from latest_chapters", () => {
  const { ranked, currentPage, totalPages } = rankedSearchResults(COMIC_BROWSE_HTML);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]!.item.subtitle, "Comic | Chapter 42");
  assert.equal(ranked[0]!.rating, 9);
  assert.equal(currentPage, 1);
  assert.equal(totalPages, 1);
});

// This is the exact bug the merge exists to fix: two independently-sorted lists (one per
// backend) concatenated is not one globally-sorted list
void test("mergeRankedResults interleaves two independently-sorted lists by title, not just concatenates them", () => {
  const novels = [ranked({ title: "Bravo" }), ranked({ title: "Delta" })];
  const comics = [ranked({ title: "Alpha" }), ranked({ title: "Charlie" })];
  const items = mergeRankedResults(novels, comics, "name", "asc");
  assert.deepEqual(
    items.map((i) => i.title),
    ["Alpha", "Bravo", "Charlie", "Delta"],
  );
});

void test("mergeRankedResults respects direction for a title sort", () => {
  const novels = [ranked({ title: "Bravo" })];
  const comics = [ranked({ title: "Alpha" }), ranked({ title: "Charlie" })];
  const items = mergeRankedResults(novels, comics, "name", "desc");
  assert.deepEqual(
    items.map((i) => i.title),
    ["Charlie", "Bravo", "Alpha"],
  );
});

void test("mergeRankedResults sorts by rating, missing rating sorts last (descending)", () => {
  const novels = [ranked({ title: "NoRating" }), ranked({ title: "Mid", rating: 5 })];
  const comics = [ranked({ title: "High", rating: 9 })];
  const items = mergeRankedResults(novels, comics, "rating", "desc");
  assert.deepEqual(
    items.map((i) => i.title),
    ["High", "Mid", "NoRating"],
  );
});

void test("mergeRankedResults sorts by lastUpdate for 'update'", () => {
  const novels = [ranked({ title: "Novel", lastUpdate: "2026-07-20T00:00:00Z" })];
  const comics = [ranked({ title: "Comic", lastUpdate: "2026-07-27T00:00:00Z" })];
  const items = mergeRankedResults(novels, comics, "update", "desc");
  assert.deepEqual(
    items.map((i) => i.title),
    ["Comic", "Novel"],
  );
});

void test("mergeRankedResults falls back to lastUpdate for 'newest' when createdAt is absent", () => {
  // Novels expose no distinct series-creation field — this is the documented fallback
  const novels = [ranked({ title: "Novel", lastUpdate: "2026-07-29T00:00:00Z" })];
  const comics = [ranked({ title: "Comic", createdAt: "2026-07-20T00:00:00Z" })];
  const items = mergeRankedResults(novels, comics, "newest", "desc");
  assert.deepEqual(
    items.map((i) => i.title),
    ["Novel", "Comic"],
  );
});

// The web-view login reads the tokens straight out of the captured jar, so the jar is the whole
// trust boundary: anything from another host must not be mistaken for an Asura session.
function cookie(name: string, value: string, domain = "asurascans.com"): Cookie {
  return { name, value, domain, path: "/" };
}

void test("asuraCookieValue reads a token set on the site or a subdomain", () => {
  const jar = [
    cookie("refresh_token", "refresh-value"),
    cookie("access_token", "access-value", ".www.asurascans.com"),
  ];

  assert.equal(asuraCookieValue(jar, "refresh_token"), "refresh-value");
  assert.equal(asuraCookieValue(jar, "access_token"), "access-value");
});

void test("asuraCookieValue ignores a same-named cookie from another host", () => {
  const jar = [
    cookie("refresh_token", "attacker", "notasurascans.com"),
    cookie("refresh_token", "evil", "asurascans.com.example.net"),
  ];

  assert.equal(asuraCookieValue(jar, "refresh_token"), undefined);
});

void test("asuraCookieValue percent-decodes, since the site encodes on write", () => {
  const jar = [cookie("refresh_token", "a%2Fb%2Bc%3D")];

  assert.equal(asuraCookieValue(jar, "refresh_token"), "a/b+c=");
});

void test("asuraCookieValue treats an empty cookie as absent", () => {
  assert.equal(asuraCookieValue([cookie("refresh_token", "")], "refresh_token"), undefined);
  assert.equal(asuraCookieValue([], "refresh_token"), undefined);
});

void test("formatCount rolls over at the point the smaller unit would print four digits", () => {
  assert.equal(formatCount(999_499), "999K");
  assert.equal(formatCount(999_500), "1M");
  assert.equal(formatCount(999_499_999), "999M");
  assert.equal(formatCount(999_500_000), "1B");
});

void test("formatCount keeps one decimal below ten and drops it above", () => {
  assert.equal(formatCount(1_500), "1.5K");
  assert.equal(formatCount(9_949), "9.9K");
  assert.equal(formatCount(9_950), "10K");
  assert.equal(formatCount(255_678), "256K");
  assert.equal(formatCount(3_965_770), "4M");
  assert.equal(formatCount(1_500_000_000), "1.5B");
});

void test("formatCount leaves values below a thousand alone", () => {
  assert.equal(formatCount(0), "0");
  assert.equal(formatCount(999), "999");
});

void test("DEFAULT_SORT is a real option and matches the site's own browse default", () => {
  assert.ok(SORT_OPTIONS.some((option) => option.id === DEFAULT_SORT.id));
  // Asura has no relevance sort; its /browse island reports initialOrder "update", "desc".
  assert.equal(DEFAULT_SORT.sort, "update");
  assert.equal(DEFAULT_SORT.direction, "desc");
});

// has_subscription is the access answer; subscription_status is billing lifecycle. Turning
// auto-renew off reports "canceled" while premium keeps working to the end of the paid period,
// so the raw word made a working account look broken (reported from a real account).
void test("subscriptionSubtitle does not call a working subscription canceled", () => {
  const premium = { hasSubscription: true, tier: "premium" } as AsuraSession;

  assert.equal(
    subscriptionSubtitle({ ...premium, subscriptionStatus: "canceled" }),
    "Premium — does not renew",
  );
  assert.equal(
    subscriptionSubtitle({ ...premium, subscriptionStatus: "cancelled" }),
    "Premium — does not renew",
  );
});

void test("subscriptionSubtitle says nothing extra for a healthy or unknown status", () => {
  const premium = { hasSubscription: true, tier: "premium" } as AsuraSession;

  assert.equal(subscriptionSubtitle({ ...premium, subscriptionStatus: "active" }), "Premium");
  assert.equal(
    subscriptionSubtitle({ ...premium, subscriptionStatus: "something_new" }),
    "Premium",
  );
  assert.equal(subscriptionSubtitle(premium), "Premium");
});

void test("subscriptionSubtitle surfaces states the reader can act on", () => {
  const premium = { hasSubscription: true, tier: "premium" } as AsuraSession;

  assert.equal(
    subscriptionSubtitle({ ...premium, subscriptionStatus: "past_due" }),
    "Premium — payment overdue",
  );
  assert.equal(
    subscriptionSubtitle({ ...premium, subscriptionStatus: "trialing" }),
    "Premium — trial",
  );
});

void test("subscriptionSubtitle ignores the status entirely without a subscription", () => {
  const none = { hasSubscription: false, subscriptionStatus: "canceled" } as AsuraSession;

  assert.equal(subscriptionSubtitle(none), "No active subscription");
});

// The series island and the updates feed spell the markers identically; both are ORed so one
// field going missing cannot hide a lock. Verified live: is_premium is true exactly when
// early_access_until is in the future, across 307 chapters of three series.
const SERIES_CHAPTERS = `
<astro-island props="{&quot;publicUrl&quot;:[0,&quot;/comics/test&quot;],&quot;chapters&quot;:[1,[{&quot;number&quot;:[0,3],&quot;is_premium&quot;:[0,true],&quot;early_access_until&quot;:[0,&quot;2099-01-01T00:00:00Z&quot;]},{&quot;number&quot;:[0,2],&quot;is_premium&quot;:[0,false],&quot;early_access_until&quot;:[0,&quot;2020-01-01T00:00:00Z&quot;]},{&quot;number&quot;:[0,1],&quot;is_premium&quot;:[0,false]}]]}"></astro-island>
`;

void test("parseChapterList lists every chapter, early access included, by default", () => {
  const chapters = parseChapterList(SERIES_CHAPTERS, testChapter.sourceManga);

  assert.deepEqual(
    chapters.map((chapter) => chapter.chapNum),
    [3, 2, 1],
  );
});

void test("parseChapterList drops only the still-locked chapter when asked to", () => {
  const chapters = parseChapterList(SERIES_CHAPTERS, testChapter.sourceManga, true);

  // 2 has a past early_access_until and 1 has none, so both are free and stay.
  assert.deepEqual(
    chapters.map((chapter) => chapter.chapNum),
    [2, 1],
  );
});
