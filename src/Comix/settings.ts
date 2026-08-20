/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Persisted state the settings form renders. Everything else only reads it.
 */

const DEBUG_STATE = "comix.debug";
const LAST_SCRAMBLE_STATE = "comix.lastScramble";

/** Off by default: diagnostics are for reporting a problem, not everyday reading. */
export function debugEnabled(): boolean {
  const stored = Application.getState(DEBUG_STATE);
  return typeof stored === "boolean" ? stored : false;
}

export function setDebugEnabled(enabled: boolean): void {
  Application.setState(enabled, DEBUG_STATE);
}

/**
 * The most recent scrambled page's parameters. Descrambling happens inside an
 * interceptor with nowhere to report to, so without this a wrong result is
 * invisible — the page simply looks broken.
 */
export function recordScramble(summary: string): void {
  Application.setState(
    `${new Date().toISOString().slice(0, 19).replace("T", " ")} ${summary}`,
    LAST_SCRAMBLE_STATE,
  );
}

export function lastScramble(): string | undefined {
  const stored = Application.getState(LAST_SCRAMBLE_STATE);
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}
