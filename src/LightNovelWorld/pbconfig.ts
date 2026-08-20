/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "LightNovelWorld",
  // The only surface visible before install; see docs/LightNovelWorld/status.md.
  description:
    "DEPRECATED — lightnovelworld.org is merging into chikari.moe, and this extension is no " +
    "longer maintained or supported. It still works for now, and will be removed once the site " +
    "goes offline. Read light novels from lightnovelworld.org.",
  version: "1.0.0-alpha.3",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
  ],
  badges: [
    { label: "Deprecated", backgroundColor: "#991B1B", textColor: "#ffffff" },
    { label: "Novel", backgroundColor: "#15803d", textColor: "#ffffff" },
  ],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
