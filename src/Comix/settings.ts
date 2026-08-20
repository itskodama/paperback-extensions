/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Persisted state the settings form renders. Everything else only reads it.
 */

const DEBUG_STATE = "comix.debug";
const THOROUGH_STATE = "comix.thoroughDescramble";
const SCRAMBLE_LOG_STATE = "comix.scrambleLog";

/** How many scrambled pages to keep. One is not enough: with roughly one page in
 * twelve scrambled, a single slot is overwritten long before anyone reads it. */
const SCRAMBLE_LOG_LIMIT = 10;

/** Off by default: diagnostics are for reporting a problem, not everyday reading. */
export function debugEnabled(): boolean {
  const stored = Application.getState(DEBUG_STATE);
  return typeof stored === "boolean" ? stored : false;
}

export function setDebugEnabled(enabled: boolean): void {
  Application.setState(enabled, DEBUG_STATE);
}

/**
 * Off by default. The site's scramble token rotates per response, so almost every
 * value is one-off and means "use the seed unmodified" — checking each one costs
 * work to confirm what was already the assumption. Turning this on verifies
 * instead of assuming, and is the only mode that can discover a real offset.
 */
export function thoroughDescrambleEnabled(): boolean {
  const stored = Application.getState(THOROUGH_STATE);
  return typeof stored === "boolean" ? stored : false;
}

export function setThoroughDescramble(enabled: boolean): void {
  Application.setState(enabled, THOROUGH_STATE);
}

/** Newest first, capped. Descrambling runs inside an interceptor with nowhere to
 * report to, so without this a wrong result is invisible. */
export function recordScramble(summary: string): void {
  const stamped = `${new Date().toISOString().slice(0, 19).replace("T", " ")} ${summary}`;
  Application.setState(
    [stamped, ...scrambleLog()].slice(0, SCRAMBLE_LOG_LIMIT),
    SCRAMBLE_LOG_STATE,
  );
}

export function scrambleLog(): string[] {
  const stored = Application.getState(SCRAMBLE_LOG_STATE);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry): entry is string => typeof entry === "string");
}
