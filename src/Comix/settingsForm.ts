/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { Form, LabelRow, Section, ToggleRow, type FormSectionElement } from "@paperback/types";

import { KNOWN_OFFSETS, learnedOffsets } from "./descramble.ts";
import { debugEnabled, lastScramble, setDebugEnabled } from "./settings.ts";

/** Long row titles are truncated on screen, so they are split across rows. */
function chunk(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.length > 0 ? lines : [text];
}

export class ComixSettingsForm extends Form {
  override getSections(): FormSectionElement<unknown>[] {
    return [this.debugSection(), ...this.diagnosticsSections()];
  }

  private debugSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "debug",
        header: "Debug",
        footer:
          "Shows the most recent scrambled page and any descramble offsets this device " +
          "worked out for itself. Turn this on before reporting a problem.",
      },
      [
        ToggleRow("debug", {
          title: "Show diagnostics",
          value: debugEnabled(),
          onValueChange: Application.Selector(this as ComixSettingsForm, "handleDebugChange"),
        }),
      ],
    );
  }

  private diagnosticsSections(): FormSectionElement<unknown>[] {
    if (!debugEnabled()) return [];

    const sections: FormSectionElement<unknown>[] = [];

    /**
     * Offsets absent from the hardcoded table are worked out on device by
     * scoring seam continuity. Anything listed here is a value the source does
     * not yet know about, and is worth reporting so it can be hardcoded.
     */
    const learned = Object.entries(learnedOffsets()).filter(([hash]) => !(hash in KNOWN_OFFSETS));

    sections.push(
      Section(
        {
          id: "offsets",
          header: "Descramble offsets learned here",
          footer:
            learned.length > 0
              ? "Report these so they can be shipped as defaults."
              : "Nothing yet. Values appear here only when a page uses a token the source " +
                "does not already know.",
        },
        learned.length > 0
          ? learned.map(([hash, offset]) =>
              LabelRow(`offset-${hash}`, { title: `${hash} = ${offset}` }),
            )
          : [LabelRow("offset-none", { title: "None" })],
      ),
    );

    const scramble = lastScramble();
    if (scramble !== undefined) {
      sections.push(
        Section(
          {
            id: "last-scramble",
            header: "Last scrambled page",
            footer: "The parameters of the most recent page that needed unscrambling.",
          },
          chunk(scramble, 58).map((line, index) => LabelRow(`scramble-${index}`, { title: line })),
        ),
      );
    }

    return sections;
  }

  async handleDebugChange(value: boolean): Promise<void> {
    setDebugEnabled(value);
    this.reloadForm();
  }
}
