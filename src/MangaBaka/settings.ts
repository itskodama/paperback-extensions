/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * What the user has chosen, and what the extension has recorded about itself. Persisted in
 * `Application` state; `settingsForm.ts` renders it, and everything else just reads it.
 */

import { DEFAULT_TITLE_PREFERENCE, type TitlePreference } from "./titles.ts";

const CRYPTO_SUPPORT_STATE = "mangabaka.cryptoSupport";
const AUTO_COMPLETE_STATE = "mangabaka.autoComplete";
const TITLE_LANGUAGE_STATE = "mangabaka.titleLanguage";
const SYNC_STATUS_STATE = "mangabaka.syncStatus";
const DEBUG_STATE = "mangabaka.debug";

/** The queue must swallow its own errors, so without this a failed sync is invisible. */
export function recordSyncStatus(status: string): void {
  Application.setState(
    `${new Date().toISOString().slice(0, 19).replace("T", " ")} ${status}`,
    SYNC_STATUS_STATE,
  );
}

/** See {@link cryptoSupport}. */
export function recordCryptoSupport(support: string): void {
  Application.setState(support, CRYPTO_SUPPORT_STATE);
}

export function getCryptoSupport(): string | undefined {
  const stored = Application.getState(CRYPTO_SUPPORT_STATE);
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

export function getSyncStatus(): string | undefined {
  const stored = Application.getState(SYNC_STATUS_STATE);
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

/** Off by default: diagnostics are for reporting a problem, not for everyday reading. */
export function debugEnabled(): boolean {
  const stored = Application.getState(DEBUG_STATE);
  return typeof stored === "boolean" ? stored : false;
}

/** Defaults to on. */
export function autoCompleteEnabled(): boolean {
  const stored = Application.getState(AUTO_COMPLETE_STATE);
  return typeof stored === "boolean" ? stored : true;
}

/** Defaults to English. */
export function titlePreference(): TitlePreference {
  const stored = Application.getState(TITLE_LANGUAGE_STATE);
  return stored === "romanized" || stored === "native" || stored === "english"
    ? stored
    : DEFAULT_TITLE_PREFERENCE;
}

export const STATE_KEYS = {
  autoComplete: AUTO_COMPLETE_STATE,
  cryptoSupport: CRYPTO_SUPPORT_STATE,
  debug: DEBUG_STATE,
  syncStatus: SYNC_STATUS_STATE,
  titleLanguage: TITLE_LANGUAGE_STATE,
} as const;
