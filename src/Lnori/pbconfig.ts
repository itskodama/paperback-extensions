/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "LNORI",
  description: "Read light novels from lnori.com.",
  version: "1.0.0-alpha.0",
  icon: "icon.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [SourceIntents.SEARCH_RESULT_PROVIDING, SourceIntents.CHAPTER_PROVIDING],
  badges: [],
  developers: [
    {
      name: "Kodama",
      github: "https://github.com/itskodama",
    },
  ],
} satisfies ExtensionInfo;
