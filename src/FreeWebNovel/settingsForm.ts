/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  LabelRow,
  Section,
  ToggleRow,
  type FormSectionElement,
} from "@paperback/types";

import {
  cachedRatingCount,
  clearRatingCache,
  setVerifyRatings,
  verifyRatingsEnabled,
} from "./settings.ts";

export class FreeWebNovelSettingsForm extends Form {
  private verify = verifyRatingsEnabled();

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section("ratings", [
        ToggleRow("verify", {
          title: "Verify content ratings",
          value: this.verify,
          onValueChange: Application.Selector(
            this as FreeWebNovelSettingsForm,
            "handleVerifyChange",
          ),
        }),
        LabelRow("explanation", {
          title: this.verify ? "On" : "Off",
          subtitle: this.verify
            ? "Search and browse check each novel's own page for its rating, so adult titles are blurred or filtered as you chose. The first browse after an update is slower; ratings are then remembered."
            : "Search and browse use only the two genres a listing shows. Most adult novels do not show one, so they will appear unmarked.",
        }),
      ]),
      Section("cache", [
        LabelRow("remembered", {
          title: "Ratings remembered",
          value: String(cachedRatingCount()),
        }),
        ButtonRow("clear", {
          title: "Forget remembered ratings",
          onSelect: Application.Selector(this as FreeWebNovelSettingsForm, "handleClearCache"),
        }),
      ]),
    ];
  }

  async handleVerifyChange(value: boolean): Promise<void> {
    this.verify = value;
    setVerifyRatings(value);
    // The explanation below the toggle states the consequence, so it has to redraw.
    this.reloadForm();
  }

  async handleClearCache(): Promise<void> {
    clearRatingCache();
    this.reloadForm();
  }
}
