/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * What a response body actually is: the site, a Cloudflare challenge, or
 * something else. Pure, so it is exercisable offline — and shared, because two
 * layers ask the question and an earlier second copy in the interceptor was
 * weaker than this one and missed the challenge that broke the source.
 */

/**
 * The site always identifies itself by this script tag, so its presence is the
 * one reliable test. Matching on what a block looks like instead is a losing
 * game: a device saw an 8KB interstitial whose markers all sat beyond the first
 * 2000 characters, which an earlier sampled check passed straight through.
 */
const PAGE_MARKER = 'id="initial-data"';

export function looksLikeSitePage(html: string): boolean {
  return html.includes(PAGE_MARKER);
}

/**
 * Only ever applied to a body already known not to be the site, which is what
 * makes "challenge-platform" usable — Cloudflare injects that into healthy pages
 * too, so on its own it would condemn every good response.
 */
const CHALLENGE_MARKERS = [
  "_cf_chl_opt",
  "cf_chl_",
  "cf-browser-verification",
  "challenge-platform",
  "enable javascript and cookies",
  "turnstile",
];

/**
 * Cloudflare lets a site rebrand its challenge, so the body can carry no
 * recognisable script at all. comix.to serves two variants of the same
 * interstitial — one with `challenge-platform`, one 900 bytes shorter with
 * nothing — and only the title identifies both.
 *
 * A firewall block ("attention required") and the 5xx pages are deliberately
 * absent: neither is solvable by a bypass, and prompting for one is how a reader
 * ends up in a loop that cannot resolve.
 */
const CHALLENGE_TITLES = [
  "just a moment",
  "security check",
  "checking your browser",
  "verifying you are human",
  "verify you are human",
  "one more step",
  "ddos protection",
];

function pageTitle(html: string): string {
  return (/<title[^>]*>([^<]*)</i.exec(html)?.[1] ?? "").trim();
}

export function isChallengeBody(html: string): boolean {
  const title = pageTitle(html).toLowerCase();
  if (CHALLENGE_TITLES.some((known) => title.includes(known))) return true;

  const body = html.toLowerCase();
  return CHALLENGE_MARKERS.some((marker) => body.includes(marker));
}

/** Enough to tell a challenge from a block from a site change, in one line. */
export function describeBadPage(html: string): string {
  const body = html.toLowerCase();
  const hit = CHALLENGE_MARKERS.filter((marker) => body.includes(marker));
  const title = pageTitle(html).slice(0, 60) || "no title";
  return `${html.length}B "${title}" markers=[${hit.join(",") || "none"}]`;
}
