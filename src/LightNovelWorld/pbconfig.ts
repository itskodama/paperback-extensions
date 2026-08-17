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
  // Content type is the one thing the app cannot infer for the repo list: it already renders
  // badges for contentRating and for capabilities. Green is the app's own — the 0.8 compat layer
  // in @paperback/types maps its legacy GREEN to #15803d on white.
  badges: [{ label: "Novel", backgroundColor: "#15803d", textColor: "#ffffff" }],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
