/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2025 Inkdex */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Asura Scans",
  description: "Read manhwa, manhua, manga and light novels from asurascans.com.",
  version: "1.0.0-alpha.9",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.SETTINGS_FORM_PROVIDING,
  ],
  // Content type is the one thing the app cannot infer for the repo list: it already renders
  // badges for contentRating and for capabilities (a tracker is labelled by its lack of
  // CHAPTER_PROVIDING). Colours are the app's own — the 0.8 compat layer in @paperback/types
  // maps its legacy GREEN to #15803d and BLUE to #1E40AF, both on white.
  badges: [
    { label: "Comic", backgroundColor: "#1E40AF", textColor: "#ffffff" },
    { label: "Novel", backgroundColor: "#15803d", textColor: "#ffffff" },
  ],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
