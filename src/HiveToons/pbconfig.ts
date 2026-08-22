/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "HiveToons",
  description: "Read manhwa, manga and web novels from hivetoons.org.",
  version: "1.0.0-alpha.2",
  icon: "icon-v2.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  badges: [{ label: "Comic", textColor: "#ffffff", backgroundColor: "#B45309" }],
  developers: [{ name: "Kodama", github: "https://github.com/itskodama" }],
} satisfies ExtensionInfo;
