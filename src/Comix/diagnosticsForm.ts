/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { Form, InputRow, LabelRow, Section, type FormSectionElement } from "@paperback/types";

import { canEncode } from "./canvas.ts";
import { KNOWN_OFFSETS, learnedOffsets } from "./descramble.ts";
import { origin } from "./http.ts";
import { fetchIssueLog, scrambleLog, timingLog } from "./settings.ts";

/**
 * Diagnostics on their own screen, reached from a single row in the settings.
 *
 * They used to sit inline, where a handful of log lines became thirty rows and
 * pushed every actual setting off the page. Space is free here, so the detail is
 * readable and the whole report is offered as one selectable field — the only
 * way to get text off a device, since a LabelRow cannot be copied from.
 */
export class ComixDiagnosticsForm extends Form {
  override getSections(): FormSectionElement<unknown>[] {
    return [this.reportSection(), this.connectionSection(), ...this.detailSections()];
  }

  /**
   * Everything above, flattened into one value. A text field can be selected and
   * copied; the rows below it cannot, so without this a report has to be
   * transcribed from screenshots by hand.
   */
  private reportSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "report",
        header: "Report",
        footer: "Press and hold the field, then Select All and Copy.",
      },
      [
        InputRow("report", {
          title: "Everything",
          value: this.report(),
          onValueChange: Application.Selector(this as ComixDiagnosticsForm, "handleReportEdit"),
        }),
      ],
    );
  }

  private report(): string {
    const learned = Object.entries(learnedOffsets()).filter(([hash]) => !(hash in KNOWN_OFFSETS));
    const parts = [
      `origin=${origin()}`,
      `webp=${canEncode("image/webp") ? "y" : "n"} jpeg=${canEncode("image/jpeg") ? "y" : "n"}`,
      learned.length > 0
        ? `offsets=${learned.map(([hash, offset]) => `${hash}:${offset}`).join(",")}`
        : "offsets=none",
      ...fetchIssueLog().map((line) => `fetch! ${line}`),
      ...scrambleLog().map((line) => `scramble ${line}`),
      ...timingLog().map((line) => `timing ${line}`),
    ];
    return parts.join(" | ");
  }

  private connectionSection(): FormSectionElement<unknown> {
    const issues = fetchIssueLog();

    return Section(
      {
        id: "connection",
        header: "Connection",
        footer:
          issues.length > 0
            ? "Pages that came back without their data payload. `markers` names what the " +
              "body matched: a Cloudflare challenge lists them, a site or network problem " +
              "reads none."
            : "No failed page loads recorded.",
      },
      [
        LabelRow("origin", { title: "Domain in use", subtitle: origin() }),
        ...issues.map((line, index) => LabelRow(`issue-${index}`, { title: line })),
      ],
    );
  }

  private detailSections(): FormSectionElement<unknown>[] {
    const sections: FormSectionElement<unknown>[] = [];

    const learned = Object.entries(learnedOffsets()).filter(([hash]) => !(hash in KNOWN_OFFSETS));
    if (learned.length > 0) {
      sections.push(
        Section(
          {
            id: "offsets",
            header: "Descramble offsets learned here",
            footer: "Values the source does not ship yet. Report these so they can be defaults.",
          },
          learned.map(([hash, offset]) =>
            LabelRow(`offset-${hash}`, { title: hash, subtitle: String(offset) }),
          ),
        ),
      );
    }

    const scrambles = scrambleLog();
    if (scrambles.length > 0) {
      sections.push(
        Section(
          { id: "scrambles", header: `Recent scrambled pages (${scrambles.length})` },
          scrambles.map((line, index) => LabelRow(`scramble-${index}`, { title: line })),
        ),
      );
    }

    const timings = timingLog();
    if (timings.length > 0) {
      sections.push(
        Section(
          {
            id: "timings",
            header: `Recent operations (${timings.length})`,
            footer:
              "The extension's own work only. An image's download time is not included, so " +
              "if pages feel slow while these read fast, the wait is the network.",
          },
          timings.map((line, index) => LabelRow(`timing-${index}`, { title: line })),
        ),
      );
    }

    /**
     * What this build of the app can actually do. Recorded because two decisions
     * hinge on it: whether a re-encode can keep a page in its original format,
     * and whether a compiled encoder could ever be shipped to make it.
     */
    const present = (name: string): string =>
      (globalThis as Record<string, unknown>)[name] ? "yes" : "no";

    sections.push(
      Section(
        {
          id: "capabilities",
          header: "Runtime capabilities",
          footer:
            "Pages are re-encoded as JPEG only because the canvas cannot produce WebP. If " +
            "that ever reads yes, they can keep their original format instead.",
        },
        [
          LabelRow("cap-webp", {
            title: "Canvas encodes WebP",
            subtitle: canEncode("image/webp") ? "yes" : "no",
          }),
          LabelRow("cap-jpeg", {
            title: "Canvas encodes JPEG",
            subtitle: canEncode("image/jpeg") ? "yes" : "no",
          }),
          LabelRow("cap-wasm", { title: "WebAssembly", subtitle: present("WebAssembly") }),
          LabelRow("cap-bitmap", {
            title: "createImageBitmap",
            subtitle: present("createImageBitmap"),
          }),
          LabelRow("cap-offscreen", {
            title: "OffscreenCanvas",
            subtitle: present("OffscreenCanvas"),
          }),
        ],
      ),
    );

    return sections;
  }

  /** The field exists to be copied from, so an edit is undone rather than kept. */
  async handleReportEdit(): Promise<void> {
    this.reloadForm();
  }
}
