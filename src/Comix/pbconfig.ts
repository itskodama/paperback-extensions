/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ContentRating, SourceIntents, type ExtensionInfo } from "@paperback/types";

export default {
  name: "Comix",
  description:
    "Read comics from comix.to. Requires solving a Cloudflare check on first use; the app will prompt.",
  version: "1.0.0-alpha.11",
  icon: "icon-v3.png",
  language: "en",
  contentRating: ContentRating.MATURE,
  capabilities: [
    SourceIntents.DISCOVER_SECTION_PROVIDING,
    SourceIntents.SEARCH_RESULT_PROVIDING,
    SourceIntents.CHAPTER_PROVIDING,
    SourceIntents.CLOUDFLARE_BYPASS_PROVIDING,
  ],
  badges: [{ label: "Comic", textColor: "#ffffff", backgroundColor: "#1E40AF" }],
  developers: [{ name: "Kodama", github: "https://github.com/itskodama" }],
} satisfies ExtensionInfo;
