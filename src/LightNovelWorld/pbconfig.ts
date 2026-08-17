/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "LightNovelWorld",
  // The description is the only surface a user sees before installing, so the wind-down goes
  // here rather than anywhere inside the app. See docs/LightNovelWorld/status.md.
  description:
    "NO LONGER MAINTAINED — lightnovelworld.org is merging into chikari.moe. This extension " +
    "still works and still receives fixes for breakage, but it will be removed once the site " +
    "goes offline. Read light novels from lightnovelworld.org.",
  version: "1.0.0-alpha.1",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
