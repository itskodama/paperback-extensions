/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Persisted state the settings form renders. Everything else only reads it.
 */

const DEBUG_STATE = "comix.debug";
const THOROUGH_STATE = "comix.thoroughDescramble";
const SCRAMBLE_LOG_STATE = "comix.scrambleLog";
const TIMING_LOG_STATE = "comix.timingLog";
const LATEST_SEEN_STATE = "comix.latestSeen";

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

/**
 * Logs are one delimited string rather than an array. An array written to state
 * is not reliably preserved across the bridge, and a diagnostic write that threw
 * would take the surrounding operation down with it — which is how a chapter
 * list came back empty twice.
 */
const LOG_SEPARATOR = "\n";

function readLog(key: string): string[] {
  const stored = Application.getState(key);
  if (typeof stored !== "string" || stored.length === 0) return [];
  return stored.split(LOG_SEPARATOR).filter((line) => line.length > 0);
}

/**
 * Never throws. Diagnostics run inside the response interceptor and the WebView
 * capture, so a failure here must not be able to break the operation it measures.
 */
function appendLog(key: string, line: string): void {
  try {
    const kept = [line, ...readLog(key)].slice(0, SCRAMBLE_LOG_LIMIT);
    Application.setState(kept.join(LOG_SEPARATOR), key);
  } catch {
    // A diagnostic is never worth failing a read for.
  }
}

/** Newest first, capped. Descrambling runs inside an interceptor with nowhere to
 * report to, so without this a wrong result is invisible. */
export function recordScramble(summary: string): void {
  appendLog(SCRAMBLE_LOG_STATE, `${new Date().toISOString().slice(11, 19)} ${summary}`);
}

export function scrambleLog(): string[] {
  return readLog(SCRAMBLE_LOG_STATE);
}

/**
 * Stage timings, newest first. Recorded only while diagnostics are on: the
 * measurement is free, but writing state per image is not.
 */
export function recordTiming(summary: string): void {
  try {
    if (!debugEnabled()) return;
  } catch {
    return;
  }
  appendLog(TIMING_LOG_STATE, `${new Date().toISOString().slice(11, 19)} ${summary}`);
}

export function timingLog(): string[] {
  return readLog(TIMING_LOG_STATE);
}

/**
 * The newest chapter number last seen per series, as `hid:number` pairs in one
 * delimited string. Kept small and flat deliberately: it is read on every update
 * sweep, and structured values do not survive the bridge reliably.
 */
export function latestSeen(): Map<string, number> {
  const seen = new Map<string, number>();
  for (const entry of readLog(LATEST_SEEN_STATE)) {
    const [hid, value] = entry.split(":");
    const parsed = Number.parseFloat(value ?? "");
    if (hid && Number.isFinite(parsed)) seen.set(hid, parsed);
  }
  return seen;
}

export function rememberLatestSeen(hid: string, latestChapter: number): void {
  try {
    const seen = latestSeen();
    if (seen.get(hid) === latestChapter) return;

    seen.set(hid, latestChapter);
    const packed = [...seen].map(([id, value]) => `${id}:${value}`).join(LOG_SEPARATOR);
    Application.setState(packed, LATEST_SEEN_STATE);
  } catch {
    // Losing this only costs an extra check next sweep.
  }
}
