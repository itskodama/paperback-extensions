/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Reader preferences. `settingsForm.ts` writes these; everything else only reads them. */

const HIDE_PAID_STATE = "hivetoons.hidePaidChapters";

/** Off by default: hiding chapters that exist is the surprising direction. */
export function hidePaidChaptersEnabled(): boolean {
  const stored = Application.getState(HIDE_PAID_STATE);
  return typeof stored === "boolean" ? stored : false;
}

export function setHidePaidChapters(value: boolean): void {
  Application.setState(value, HIDE_PAID_STATE);
}
