/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Connection tests for the settings Debug section: one request per change made since alpha.10,
 * so a device can show which of them actually matters. Temporary; remove once decided.
 */

import { type Response } from "@paperback/types";

import { authorizedFetch, getSession } from "./auth.ts";
import { ASURA_API } from "./models.ts";
import { isChallenge, setHeaderOverride } from "./network.ts";
import { seriesUrl } from "./urls.ts";

// Long-running and unlikely to be removed; any public series would do
const PROBE_SERIES = "logging-10000-years-into-the-future-f212c582";
const PROBE_CHAPTER = "1";

// What the interceptor sent up to alpha.10
const ALPHA_10_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ALPHA_10_HEADERS = { "user-agent": ALPHA_10_USER_AGENT, referer: "" };

export type ProbeResult = { title: string; outcome: string; detail?: string };

type Probe = {
  title: string;
  url: string;
  headers?: Record<string, string>;
};

const SERIES_API = `${ASURA_API}/api/series/${PROBE_SERIES}`;
const CHAPTER_API_PATH = `/api/series/${PROBE_SERIES}/chapters/${PROBE_CHAPTER}`;

const PROBES: Probe[] = [
  { title: "API, as now", url: SERIES_API },
  { title: "API, no referer", url: SERIES_API, headers: { referer: "" } },
  {
    title: "API, alpha.10 user-agent",
    url: SERIES_API,
    headers: { "user-agent": ALPHA_10_USER_AGENT },
  },
  { title: "API, alpha.10 headers", url: SERIES_API, headers: ALPHA_10_HEADERS },
  { title: "Page, as now", url: seriesUrl(PROBE_SERIES) },
  { title: "Page, exactly alpha.10", url: seriesUrl(PROBE_SERIES), headers: ALPHA_10_HEADERS },
  { title: "Chapter API, anonymous", url: `${ASURA_API}${CHAPTER_API_PATH}` },
];

function describe(response: Response, data: ArrayBuffer, startedAtMs: number): string {
  const html = Application.arrayBufferToUTF8String(data);
  const verdict = isChallenge(response, html) ? " challenged" : "";
  return `${response.status}${verdict} · ${Date.now() - startedAtMs}ms`;
}

function failure(title: string, error: unknown): ProbeResult {
  const message = error instanceof Error ? error.message : String(error);
  return { title, outcome: "failed", detail: message.slice(0, 58) };
}

// Sequential on purpose: the overrides are keyed by URL, and several probes share one
async function runProbe(probe: Probe): Promise<ProbeResult> {
  const startedAtMs = Date.now();
  setHeaderOverride(probe.url, probe.headers);
  try {
    const [response, data] = await Application.scheduleRequest({ url: probe.url, method: "GET" });
    return { title: probe.title, outcome: describe(response, data, startedAtMs) };
  } catch (error) {
    return failure(probe.title, error);
  } finally {
    setHeaderOverride(probe.url, undefined);
  }
}

async function runLoggedInProbe(): Promise<ProbeResult> {
  const title = "Chapter API, logged in";
  if (!getSession()) return { title, outcome: "not logged in" };

  const startedAtMs = Date.now();
  try {
    const result = await authorizedFetch(CHAPTER_API_PATH);
    if (!result) return { title, outcome: "not logged in" };
    const [response, data] = result;
    return { title, outcome: describe(response, data, startedAtMs) };
  } catch (error) {
    return failure(title, error);
  }
}

export async function runConnectionTests(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const probe of PROBES) results.push(await runProbe(probe));
  results.push(await runLoggedInProbe());
  return results;
}
