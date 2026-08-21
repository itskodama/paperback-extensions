/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "FreeWebNovel",
  description: "Read web novels from freewebnovel.com.",
  version: "1.0.0-alpha.3",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [{ label: "Novel", backgroundColor: "#15803d", textColor: "#ffffff" }],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
