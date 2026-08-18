/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/** Reader preferences. `settingsForm.ts` writes these; everything else only reads them. */

import { getSession } from "./auth.ts";

const HIDE_EARLY_ACCESS_STATE = "asurascans.hideEarlyAccess";

export const STATE_KEYS = { hideEarlyAccess: HIDE_EARLY_ACCESS_STATE } as const;

/** Off by default: hiding chapters a user can see is the surprising direction. */
export function hideEarlyAccessEnabled(): boolean {
  const stored = Application.getState(HIDE_EARLY_ACCESS_STATE);
  return typeof stored === "boolean" ? stored : false;
}

/** Staff and premium roles both report has_subscription, so this covers everyone with access. */
export function canReadEarlyAccess(): boolean {
  return getSession()?.hasSubscription === true;
}

/** The preference only takes effect for someone who cannot open the chapters anyway. */
export function hidesEarlyAccess(): boolean {
  return hideEarlyAccessEnabled() && !canReadEarlyAccess();
}
