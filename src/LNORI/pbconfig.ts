/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "LNORI",
  description:
    "Read light novels from lnori.com. Enable 'Chapters Unique by Volume' under Manage Version Priority for correct chapter lists.",
  version: "1.0.0-alpha.3",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
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
