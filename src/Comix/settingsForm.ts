/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  NavigationRow,
  Section,
  ToggleRow,
  type FormSectionElement,
} from "@paperback/types";

import { ComixDiagnosticsForm } from "./diagnosticsForm.ts";
import { clearCloudflareState } from "./network.ts";
import {
  clearDiagnostics,
  debugEnabled,
  fullUpdateScanEnabled,
  setDebugEnabled,
  setFullUpdateScan,
  setThoroughDescramble,
  thoroughDescrambleEnabled,
} from "./settings.ts";

export class ComixSettingsForm extends Form {
  override getSections(): FormSectionElement<unknown>[] {
    return [this.updatesSection(), this.descrambleSection(), this.debugSection()];
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
          "Diagnostics are always available and include a copyable report. The toggle only " +
          "adds per-page timings, which are written on every image and so are off by default.",
      },
      [
        ToggleRow("debug", {
          title: "Record timings",
          value: debugEnabled(),
          onValueChange: Application.Selector(this as ComixSettingsForm, "handleDebugChange"),
        }),
        NavigationRow("diagnostics", {
          title: "Diagnostics",
          form: new ComixDiagnosticsForm(),
        }),
        ButtonRow("clear", {
          title: "Clear diagnostics",
          onSelect: Application.Selector(this as ComixSettingsForm, "handleClear"),
        }),
        ButtonRow("resetCloudflare", {
          title: "Forget Cloudflare clearance",
          onSelect: Application.Selector(this as ComixSettingsForm, "handleResetCloudflare"),
        }),
      ],
    );
  }

  async handleFullScanChange(value: boolean): Promise<void> {
    setFullUpdateScan(value);
  }

  async handleClear(): Promise<void> {
    clearDiagnostics();
    this.reloadForm();
  }

  /**
   * Last resort when the source has stopped loading. Dropping the clearance
   * makes the next request challenge again, which is what gives the app a fresh
   * bypass to run.
   */
  async handleResetCloudflare(): Promise<void> {
    clearCloudflareState();
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
