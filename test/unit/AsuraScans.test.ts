/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import assert from "node:assert/strict";
import test from "node:test";

import { ContentRating, type Chapter } from "@paperback/types";

import { isSessionExpired, isValidSession, type AsuraSession } from "../../src/AsuraScans/auth.ts";
import { chapterIsLocked, parseChapterApiPayload } from "../../src/AsuraScans/parser.ts";

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
