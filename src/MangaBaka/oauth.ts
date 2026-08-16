/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import type { Cookie } from "@paperback/types";

import { base64UrlEncode, pkceChallenge, randomBytes, randomVerifier } from "./crypto.ts";
import { isText, positive, str } from "./decode.ts";
import { AUTH_BASE } from "./types.ts";

/** A public native client has no secret, so this identifies the app and nothing more. */
export const CLIENT_ID = "hyoxMCdYXysynBrsAtlzcmWZETvYwOSk";

/** Matched byte for byte; a trailing slash is rejected. Never tidy this up. See auth.md. */
export const REDIRECT_URI = "paperback://mangabaka-auth";

/**
 * `openid` is required: without it every `/v1/my/*` call answers `401 Missing required
 * scope`, and nothing fails earlier. Dropped twice already; a unit test now pins it.
 * Changing this string invalidates every existing grant. See auth.md.
 */
export const SCOPES = "library.read library.write offline_access openid";

// Exported only for the parked `OAuthButtonRow` in settingsForm.ts.
export const AUTHORIZE_ENDPOINT = `${AUTH_BASE}/oauth2/authorize`;
export const TOKEN_ENDPOINT = `${AUTH_BASE}/oauth2/token`;

export const SCOPE_LIST = SCOPES.split(" ");

/** The `iss` the server stamps on authorization responses (RFC 9207). */
export const ISSUER = AUTH_BASE;

const REFRESH_MARGIN_MS = 60_000;

const MAX_HOPS = 3;

export type OAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  scope?: string;
};

// Hand-rolled because URLSearchParams does not exist in this runtime.
export function encodeForm(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function parseQuery(url: string): Record<string, string> {
  const start = url.indexOf("?");
  if (start === -1) return {};

  const hash = url.indexOf("#", start);
  const query = url.slice(start + 1, hash === -1 ? undefined : hash);
  const out: Record<string, string> = {};

  for (const pair of query.split("&")) {
    if (pair.length === 0) continue;

    const eq = pair.indexOf("=");
    const key = decodeURIComponent((eq === -1 ? pair : pair.slice(0, eq)).replace(/\+/g, " "));
    const value = eq === -1 ? "" : decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, " "));
    out[key] = value;
  }

  return out;
}

/** Header names are not case-normalised by the bridge, so match case-insensitively. */
export function headerValue(headers: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value;
  }
  return undefined;
}

/** Commas separate cookies *and* appear inside `Expires=`, hence the lookahead. */
export function parseSetCookie(header: string | undefined): [string, string][] {
  if (header === undefined || header.length === 0) return [];

  const pairs: [string, string][] = [];

  for (const part of header.split(/,(?=\s*[A-Za-z0-9!#$%&'*+\-.^_`|~]+=)/)) {
    const first = part.split(";")[0]?.trim();
    if (first === undefined) continue;

    const eq = first.indexOf("=");
    if (eq <= 0) continue;

    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name.length > 0 && value.length > 0) pairs.push([name, value]);
  }

  return pairs;
}

// Authorization request

/**
 * `prompt`: omitted for a real browser, `none` to answer without UI, `consent` to force the
 * screen even when a grant exists. See docs/MangaBaka/auth.md#prompt-values-used.
 */
export type AuthorizeParams = {
  challenge: string;
  state: string;
  prompt?: "none" | "consent";
};

export function authorizeUrl({ challenge, state, prompt }: AuthorizeParams): string {
  return `${AUTHORIZE_ENDPOINT}?${encodeForm({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(prompt === undefined ? {} : { prompt }),
  })}`;
}

export type AuthorizeSession = { verifier: string } & AuthorizeParams;

export async function newAuthorizeSession(): Promise<AuthorizeSession> {
  const verifier = randomVerifier();
  return {
    verifier,
    challenge: await pkceChallenge(verifier),
    state: base64UrlEncode(randomBytes(16)),
  };
}

// Authorization response

export type AuthorizeOutcome =
  | { kind: "code"; code: string }
  | { kind: "error"; error: string; description?: string };

/** Errors carry `state` and `iss` too, so both are checked before one is believed. */
export function readAuthorizeResponse(target: string, state: string): AuthorizeOutcome {
  const query = parseQuery(target);

  if (isText(query.iss) && query.iss !== ISSUER) {
    throw new Error("The login response came from the wrong issuer; login aborted.");
  }
  if (query.state !== state) {
    throw new Error("State mismatch; login aborted.");
  }

  if (isText(query.error)) {
    return isText(query.error_description)
      ? { kind: "error", error: query.error, description: query.error_description }
      : { kind: "error", error: query.error };
  }
  if (isText(query.code)) {
    return { kind: "code", code: query.code };
  }

  throw new Error("The login response carried neither a code nor an error.");
}

/** better-auth answers as often with `200` and a body as with `302`. See auth.md. */
export function redirectTargetFromBody(text: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;
  const body = parsed as Record<string, unknown>;

  const target = body.redirectURI ?? body.redirect_uri ?? body.url;
  return isText(target) ? target : undefined;
}

const NEEDS_APPROVAL = new Set([
  "consent_required",
  "interaction_required",
  "access_denied",
  "invalid_scope",
]);

const NEEDS_APPROVAL_MESSAGE = "Approval needed. Open Log In again and approve access.";

// Short on purpose: these land in a form row that truncates.
function explain(outcome: { error: string; description?: string }): string {
  if (outcome.error === "login_required") {
    return "Session not recognised. Log In again and finish signing in before it closes.";
  }
  if (NEEDS_APPROVAL.has(outcome.error)) return NEEDS_APPROVAL_MESSAGE;
  return `Login refused: ${outcome.description ?? outcome.error}`;
}

// Flow

/** One line per hop, surfaced in settings so a failed login can be inspected. */
export type FlowTrace = string[];

function pathOf(url: string): string {
  const noQuery = url.split("?")[0] ?? url;
  return noQuery.replace(/^https?:\/\/[^/]+/, "") || noQuery;
}

function isInteractiveScreen(target: string): boolean {
  return /\/(auth|consent)(\?|$)/.test(target);
}

function absorbCookies(
  jar: Map<string, string>,
  response: { cookies: Cookie[]; headers: Record<string, string> },
): void {
  for (const cookie of response.cookies) jar.set(cookie.name, cookie.value);
  for (const [name, value] of parseSetCookie(headerValue(response.headers, "set-cookie"))) {
    jar.set(name, value);
  }
}

function absoluteUrl(location: string): string {
  if (location.startsWith("http")) return location;
  return `${AUTH_BASE.replace(/\/auth$/, "")}${location.startsWith("/") ? "" : "/"}${location}`;
}

/** `domain` arrives bare or leading-dot depending on how the site set it. */
export function mangaBakaCookieJar(cookies: Cookie[]): Map<string, string> {
  const jar = new Map<string, string>();

  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    if (domain === "mangabaka.org" || domain.endsWith(".mangabaka.org")) {
      jar.set(cookie.name, cookie.value);
    }
  }

  return jar;
}

/** `prompt=none` answers on the redirect URI in one hop. See auth.md#the-flow. */
export async function authorizationCode(
  cookies: Cookie[],
  params: AuthorizeParams,
  trace: FlowTrace = [],
): Promise<string> {
  const jar = mangaBakaCookieJar(cookies);

  if (jar.size === 0) {
    throw new Error("No MangaBaka session cookies were captured. Please log in again.");
  }

  trace.push(`cookies: ${[...jar.keys()].join(", ").slice(0, 200)}`);

  let url = authorizeUrl({ ...params, prompt: "none" });

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const [response, data] = await Application.scheduleRequest({
      url,
      method: "GET",
      headers: {
        cookie: [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; "),
        accept: "application/json, text/html",
      },
    });

    absorbCookies(jar, response);

    let target = headerValue(response.headers, "location");
    if (target === undefined) {
      const text = Application.arrayBufferToUTF8String(data);
      target = redirectTargetFromBody(text);
      if (target === undefined) trace.push(`   body[${text.length}]: ${text.slice(0, 120)}`);
    }

    trace.push(
      `${hop + 1}. GET ${pathOf(url)} -> ${response.status}` +
        (target === undefined ? "" : ` -> ${pathOf(target)}`),
    );

    if (target === undefined) {
      throw new Error(`Login stopped at HTTP ${response.status}. See Login diagnostics.`);
    }

    if (target.startsWith(REDIRECT_URI)) {
      const outcome = readAuthorizeResponse(target, params.state);
      if (outcome.kind === "code") return outcome.code;

      trace.push(
        `   error: ${outcome.error}${outcome.description ? ` (${outcome.description})` : ""}`,
      );
      throw new Error(explain(outcome));
    }

    if (isInteractiveScreen(target)) throw new Error(NEEDS_APPROVAL_MESSAGE);

    url = absoluteUrl(target);
  }

  throw new Error("Too many redirects. See Login diagnostics below.");
}

// Token endpoint

type TokenResponse = {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  expires_at?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function toTokens(parsed: TokenResponse): OAuthTokens {
  if (!isText(parsed.access_token)) {
    const detail = isText(parsed.error_description)
      ? parsed.error_description
      : isText(parsed.error)
        ? parsed.error
        : "no access token returned";
    throw new Error(`MangaBaka rejected the login: ${detail}`);
  }

  const tokens: OAuthTokens = { accessToken: parsed.access_token };

  const refreshToken = str(parsed.refresh_token);
  if (refreshToken !== undefined) tokens.refreshToken = refreshToken;

  const scope = str(parsed.scope);
  if (scope !== undefined) tokens.scope = scope;

  // Prefer the relative value: an absolute one is skewed by a wrong device clock.
  const expiresIn = positive(parsed.expires_in);
  const expiresAtMs = positive(parsed.expires_at);
  if (expiresIn !== undefined) tokens.expiresAtMs = Date.now() + expiresIn * 1000;
  else if (expiresAtMs !== undefined) tokens.expiresAtMs = expiresAtMs * 1000;

  return tokens;
}

async function postForm(body: Record<string, string>): Promise<TokenResponse> {
  const [response, data] = await Application.scheduleRequest({
    url: TOKEN_ENDPOINT,
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: encodeForm(body),
  });

  const text = Application.arrayBufferToUTF8String(data);
  try {
    return JSON.parse(text) as TokenResponse;
  } catch {
    throw new Error(`MangaBaka returned an unreadable token response (HTTP ${response.status})`);
  }
}

export async function exchangeCode(code: string, verifier: string): Promise<OAuthTokens> {
  return toTokens(
    await postForm({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
    }),
  );
}

export async function refreshTokens(refreshToken: string): Promise<OAuthTokens> {
  const tokens = toTokens(
    await postForm({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  );

  // Some servers omit the refresh token on renewal, meaning "keep using the old one".
  if (tokens.refreshToken === undefined) tokens.refreshToken = refreshToken;
  return tokens;
}

export function tokensExpired(tokens: OAuthTokens, now: number = Date.now()): boolean {
  if (tokens.expiresAtMs === undefined) return false;
  return tokens.expiresAtMs - REFRESH_MARGIN_MS <= now;
}
