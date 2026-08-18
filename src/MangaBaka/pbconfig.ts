/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "MangaBaka",
  description:
    "Track your reading progress on mangabaka.org, a manga and light novel database aggregating AniList, MyAnimeList, MangaUpdates, Kitsu, Anime-Planet, Shikimori and Anime News Network.",
  version: "1.0.0-alpha.3",
  icon: "icon.png",
  language: "en",
  // The catalog spans safe through pornographic; per-title ratings are set on each
  // SearchResultItem/MangaInfo from the series' own content_rating
  contentRating: ContentRating.MATURE,
  capabilities: [
    // No CHAPTER_PROVIDING — this is a tracker, not a source. That absence is what
    // makes the app offer it in the tracker picker rather than the source list.
    SourceIntents.PROGRESS_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.MANAGED_COLLECTION_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
