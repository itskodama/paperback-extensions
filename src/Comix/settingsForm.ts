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

import { canEncode } from "./canvas.ts";
import { KNOWN_OFFSETS, learnedOffsets } from "./descramble.ts";
import {
  clearDiagnostics,
  debugEnabled,
  fullUpdateScanEnabled,
  setFullUpdateScan,
  scrambleLog,
  timingLog,
  setDebugEnabled,
  setThoroughDescramble,
  thoroughDescrambleEnabled,
} from "./settings.ts";

/** Long row titles are truncated on screen, so they are split across rows. */
function chunk(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.length > 0 ? lines : [text];
}

export class ComixSettingsForm extends Form {
  override getSections(): FormSectionElement<unknown>[] {
    return [
      this.updatesSection(),
      this.descrambleSection(),
      this.debugSection(),
      ...this.diagnosticsSections(),
    ];
  }

  /**
   * Chapters are listed newest-number first, so an update check normally reads
   * only that first page. A series translated by several groups can gain a
   * chapter numbered below one already published, which that page cannot show.
   */
  private updatesSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "updates",
        header: "Library updates",
        footer:
          "Update checks normally read only the newest page of chapters, which is one " +
          "request. A full scan reads every page instead, catching a chapter numbered " +
          "below one already published — which happens when several groups translate the " +
          "same series. It is far slower: a long series can take minutes per check.",
      },
      [
        ToggleRow("fullScan", {
          title: "Full chapter scan on update",
          value: fullUpdateScanEnabled(),
          onValueChange: Application.Selector(this as ComixSettingsForm, "handleFullScanChange"),
        }),
      ],
    );
  }

  /**
   * The site's scramble token rotates per response, so nearly every value is
   * one-off and means "use the seed unmodified". Assuming that is right almost
   * always and costs nothing; verifying it means decoding and scoring each page
   * to confirm what was already assumed.
   */
  private descrambleSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "descramble",
        header: "Page unscrambling",
        footer:
          "Some pages arrive with their tiles shuffled and are reassembled automatically. " +
          "Thorough mode verifies each one instead of assuming the usual arrangement, which " +
          "is slower but catches a page the shipped values do not cover. Leave it off unless " +
          "pages look jumbled.",
      },
      [
        ToggleRow("thorough", {
          title: "Thorough mode",
          value: thoroughDescrambleEnabled(),
          onValueChange: Application.Selector(this as ComixSettingsForm, "handleThoroughChange"),
        }),
      ],
    );
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
        ButtonRow("clear", {
          title: "Clear diagnostics",
          onSelect: Application.Selector(this as ComixSettingsForm, "handleClear"),
        }),
      ],
    );
  }

  /**
   * What this build of the app can actually do. Recorded because two decisions
   * hinge on it: whether a re-encode can keep a page in its original format, and
   * whether a compiled encoder could ever be shipped to make it.
   */
  private capabilityRows(): string[] {
    const present = (name: string): string =>
      (globalThis as Record<string, unknown>)[name] ? "yes" : "no";

    return [
      `canvas encodes webp: ${canEncode("image/webp") ? "yes" : "no"}`,
      `canvas encodes jpeg: ${canEncode("image/jpeg") ? "yes" : "no"}`,
      `WebAssembly: ${present("WebAssembly")}`,
      `createImageBitmap: ${present("createImageBitmap")}`,
      `OffscreenCanvas: ${present("OffscreenCanvas")}`,
    ];
  }

  private diagnosticsSections(): FormSectionElement<unknown>[] {
    if (!debugEnabled()) return [];

    const sections: FormSectionElement<unknown>[] = [];

    sections.push(
      Section(
        {
          id: "capabilities",
          header: "Runtime capabilities",
          footer:
            "What this build of the app supports. Pages are re-encoded as JPEG only because " +
            "the canvas cannot produce WebP; if that ever reads yes, they can keep their " +
            "original format instead.",
        },
        this.capabilityRows().map((row, index) => LabelRow(`capability-${index}`, { title: row })),
      ),
    );

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
              : "Nothing yet. Only values that differ from the usual arrangement are kept, " +
                "and finding one requires Thorough mode.",
        },
        learned.length > 0
          ? learned.map(([hash, offset]) =>
              LabelRow(`offset-${hash}`, { title: `${hash} = ${offset}` }),
            )
          : [LabelRow("offset-none", { title: "None" })],
      ),
    );

    const timings = timingLog();
    if (timings.length > 0) {
      sections.push(
        Section(
          {
            id: "timings",
            header: `Recent operations (${timings.length})`,
            footer:
              "How long each step took. These cover the extension's own work only — an " +
              "image's download time is not included, so if pages feel slow while these " +
              "read fast, the wait is the network rather than the source.",
          },
          timings.flatMap((entry, index) =>
            chunk(entry, 58).map((line, part) =>
              LabelRow(`timing-${index}-${part}`, { title: line }),
            ),
          ),
        ),
      );
    }

    // One slot is not enough: with roughly one page in twelve scrambled, the
    // interesting entry is overwritten before anyone reads it.
    const recent = scrambleLog();
    if (recent.length > 0) {
      sections.push(
        Section(
          {
            id: "recent-scrambles",
            header: `Recent scrambled pages (${recent.length})`,
            footer: "Newest first. Each line is one page that needed unscrambling.",
          },
          recent.flatMap((entry, index) =>
            chunk(entry, 58).map((line, part) =>
              LabelRow(`scramble-${index}-${part}`, { title: line }),
            ),
          ),
        ),
      );
    }

    return sections;
  }

  async handleFullScanChange(value: boolean): Promise<void> {
    setFullUpdateScan(value);
  }

  async handleClear(): Promise<void> {
    clearDiagnostics();
    this.reloadForm();
  }

  async handleThoroughChange(value: boolean): Promise<void> {
    setThoroughDescramble(value);
  }

  async handleDebugChange(value: boolean): Promise<void> {
    setDebugEnabled(value);
    this.reloadForm();
  }
}
