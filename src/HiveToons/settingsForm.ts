/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { Form, LabelRow, Section, ToggleRow, type FormSectionElement } from "@paperback/types";

import { hidePaidChaptersEnabled, setHidePaidChapters } from "./settings.ts";

export class HiveToonsSettingsForm extends Form {
  private hidePaid = hidePaidChaptersEnabled();

  override getSections(): FormSectionElement<unknown>[] {
    return [
      Section("chapters", [
        ToggleRow("hidePaid", {
          title: "Hide paid chapters",
          value: this.hidePaid,
          onValueChange: Application.Selector(
            this as HiveToonsSettingsForm,
            "handleHidePaidChange",
          ),
        }),
        LabelRow("explanation", {
          title: this.hidePaid ? "On" : "Off",
          subtitle: this.hidePaid
            ? "Chapters that cost coins are left out of the chapter list entirely."
            : "Chapters that cost coins are listed. Opening one explains that it is paid, because this extension reads the site anonymously and cannot unlock it.",
        }),
      ]),
    ];
  }

  async handleHidePaidChange(value: boolean): Promise<void> {
    this.hidePaid = value;
    setHidePaidChapters(value);
    // The explanation below the toggle states the consequence, so it has to redraw.
    this.reloadForm();
  }
}
