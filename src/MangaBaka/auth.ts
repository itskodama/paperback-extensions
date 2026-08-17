/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import type { Cookie } from "@paperback/types";

// Extension-ful import: test/unit/MangaBaka.test.ts loads this under Node's own resolver.
import { isText, num, str, strings } from "./decode.ts";
import {
  authorizationCode,
  exchangeCode,
  newAuthorizeSession,
  refreshTokens,
  tokensExpired,
  type AuthorizeSession,
  type FlowTrace,
  type OAuthTokens,
} from "./oauth.ts";
import { API_BASE } from "./types.ts";

// Bearer credentials go in secure (keychain-backed) state; the profile is not secret.
const TOKENS_STATE = "mangabaka.tokens";
const PROFILE_STATE = "mangabaka.profile";

/** Pre-OAuth credential, cleared on upgrade rather than left in the keychain. */
const LEGACY_API_KEY_STATE = "mangabaka.apiKey";
const TRACE_STATE = "mangabaka.loginTrace";

export type MangaBakaProfile = {
  userId: string;
  nickname: string;
  /** Score increment out of 100. Scores are always stored 0–100 whatever this is. */
  ratingSteps: number;
  /** Default state for adding something *unread*, so a chapter read does not use it. */
  libraryDefaultState: string;
  role: string;
  scopes: string[];
};

/** Defaults, not the account's settings — hence {@link isPlaceholderProfile}. */
const FALLBACK_PROFILE: MangaBakaProfile = {
  userId: "unknown",
  nickname: "your account",
  ratingSteps: 1,
  libraryDefaultState: "plan_to_read",
  role: "user",
  scopes: [],
};

/** Whether these values were invented rather than read, and so must not be displayed. */
export function isPlaceholderProfile(profile: MangaBakaProfile): boolean {
  return profile.userId === FALLBACK_PROFILE.userId;
}

export const REQUIRED_SCOPE = "library.write";

export function canWriteLibrary(profile: MangaBakaProfile | undefined): boolean {
  // An empty list means the scopes were never reported, not that none were granted.
  return profile === undefined || profile.scopes.length === 0
    ? profile !== undefined
    : profile.scopes.includes(REQUIRED_SCOPE);
}

// Stored credentials

// setSecureState does not reliably round-trip a nested object.
export function getTokens(): OAuthTokens | undefined {
  const stored = Application.getSecureState(TOKENS_STATE);
  if (!isText(stored)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }

  if (typeof parsed !== "object" || parsed === null) return undefined;
  const tokens = parsed as OAuthTokens;
  return isText(tokens.accessToken) ? tokens : undefined;
}

function saveTokens(tokens: OAuthTokens): void {
  Application.setSecureState(JSON.stringify(tokens), TOKENS_STATE);
}

export function isValidProfile(value: unknown): value is MangaBakaProfile {
  if (typeof value !== "object" || value === null) return false;
  const profile = value as Record<string, unknown>;

  return (
    isText(profile.userId) &&
    typeof profile.nickname === "string" &&
    typeof profile.ratingSteps === "number" &&
    typeof profile.libraryDefaultState === "string" &&
    typeof profile.role === "string" &&
    Array.isArray(profile.scopes)
  );
}

export function getProfile(): MangaBakaProfile | undefined {
  const stored = Application.getState(PROFILE_STATE);
  if (!isText(stored)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }

  return isValidProfile(parsed) ? parsed : undefined;
}

export function isLoggedIn(): boolean {
  return getTokens() !== undefined;
}

/**
 * A refresh token is single-use, so two renewals racing means the second presents one the first
 * already spent — a 401 that reads as "logged out" on a session that was fine. The progress queue
 * makes that reachable: it walks a batch of series, and the first two can expire together.
 * Everything that renews shares the first in-flight attempt.
 */
let inFlightRenewal: Promise<OAuthTokens> | undefined;

async function renew(refreshToken: string): Promise<OAuthTokens> {
  const pending = inFlightRenewal;
  if (pending) return pending;

  const renewal = refreshTokens(refreshToken).then((tokens) => {
    saveTokens(tokens);
    return tokens;
  });
  inFlightRenewal = renewal;

  try {
    return await renewal;
  } finally {
    inFlightRenewal = undefined;
  }
}

/** Async because an expired token is renewed before the caller ever sees it. */
export async function authHeaders(): Promise<Record<string, string> | undefined> {
  let tokens = getTokens();
  if (!tokens) return undefined;

  if (tokensExpired(tokens) && tokens.refreshToken !== undefined) {
    try {
      tokens = await renew(tokens.refreshToken);
    } catch {
      // Fall through with the stale token: a 401 is a clearer outcome than failing here.
    }
  }

  return { authorization: `Bearer ${tokens.accessToken}` };
}

/** Returns false when re-login is unavoidable. */
export async function renewTokens(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens?.refreshToken) return false;

  try {
    await renew(tokens.refreshToken);
    return true;
  } catch {
    return false;
  }
}

/**
 * Local only. MangaBaka has no connected-apps page anyone has found, so the grant itself
 * cannot be revoked from here — say nothing to the user about withdrawing it until one
 * turns up.
 */
export function logout(): void {
  Application.setSecureState(null, TOKENS_STATE);
  Application.setSecureState(null, LEGACY_API_KEY_STATE);
  Application.setState(null, PROFILE_STATE);
}

// Login

type ProfileResponse = {
  data?: {
    id?: unknown;
    nickname?: unknown;
    preferred_username?: unknown;
    rating_steps?: unknown;
    library_default_state?: unknown;
    role?: unknown;
    scopes?: unknown;
  };
  message?: unknown;
};

const RATING_STEPS = [1, 5, 10, 20, 25];

async function getJson(path: string, accessToken: string): Promise<[number, unknown]> {
  const [response, data] = await Application.scheduleRequest({
    url: `${API_BASE}${path}`,
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const text = Application.arrayBufferToUTF8String(data);

  if (text.length === 0) return [response.status, undefined];

  try {
    return [response.status, JSON.parse(text)];
  } catch {
    return [response.status, undefined];
  }
}

/**
 * Raised only by {@link assertLibraryAccess}: a 401 elsewhere may just mean that endpoint's
 * scope is missing, which says nothing about whether the token works.
 */
export class TokenRejectedError extends Error {}

/** 404 still proves the token works. See auth.md#validating-a-new-token. */
const LIBRARY_PROBE_PATH = "/v1/my/library/1";

async function assertLibraryAccess(accessToken: string): Promise<void> {
  const [status, parsed] = await getJson(LIBRARY_PROBE_PATH, accessToken);

  if (status === 200 || status === 404) return;

  const detail = str((parsed as { message?: unknown } | undefined)?.message);
  // Naming the endpoint matters: two of them answer 401 with identical wording.
  const where = `${LIBRARY_PROBE_PATH} ${status}`;
  const suffix = detail === undefined ? "" : `: ${detail}`;

  if (status === 401 || status === 403) {
    throw new TokenRejectedError(`Login refused (${where})${suffix}`);
  }
  throw new Error(`Library check failed (${where})${suffix}`);
}

/** Optional — see {@link storeSession}. */
export async function fetchProfile(accessToken: string): Promise<MangaBakaProfile> {
  const [status, parsed] = await getJson("/v1/my/profile", accessToken);

  if (status < 200 || status >= 300) {
    const detail = str((parsed as { message?: unknown } | undefined)?.message);
    throw new Error(
      `MangaBaka returned HTTP ${status} while reading your profile` +
        (detail === undefined ? "." : `: ${detail}`),
    );
  }

  const data = (parsed as ProfileResponse | undefined)?.data;

  const userId = str(data?.id);
  if (userId === undefined) {
    throw new Error("MangaBaka returned an incomplete profile.");
  }

  const ratingSteps = num(data?.rating_steps);

  return {
    userId,
    nickname: str(data?.nickname) ?? str(data?.preferred_username) ?? "your account",
    ratingSteps: ratingSteps !== undefined && RATING_STEPS.includes(ratingSteps) ? ratingSteps : 1,
    libraryDefaultState: str(data?.library_default_state) ?? "plan_to_read",
    role: str(data?.role) ?? "user",
    scopes: strings(data?.scopes),
  };
}

/** Picks up settings changed on MangaBaka without a re-login. */
export async function refreshProfile(): Promise<MangaBakaProfile | undefined> {
  const headers = await authHeaders();
  const token = headers?.authorization?.replace(/^Bearer /, "");
  if (!token) return undefined;

  const profile = await fetchProfile(token);
  Application.setState(JSON.stringify(profile), PROFILE_STATE);
  return profile;
}

/** The cookies are exchanged for tokens and never stored. */
export async function loginWithCookies(
  cookies: Cookie[],
  session?: AuthorizeSession,
): Promise<MangaBakaProfile> {
  const attempt = session ?? (await newAuthorizeSession());
  // Written either way: a failure is exactly when the trace needs reading.
  const trace: FlowTrace = [`cookies captured: ${cookies.length}`];

  try {
    const code = await authorizationCode(
      cookies,
      { challenge: attempt.challenge, state: attempt.state },
      trace,
    );
    return await finishLogin(code, attempt.verifier, trace);
  } finally {
    Application.setState(JSON.stringify(trace), TRACE_STATE);
  }
}

/** The last login attempt's redirect chain, for the diagnostics row. */
export function getLoginTrace(): string[] {
  const stored = Application.getState(TRACE_STATE);
  if (!isText(stored)) return [];

  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter(isText) : [];
  } catch {
    return [];
  }
}

export function clearLoginTrace(): void {
  Application.setState(null, TRACE_STATE);
}

async function finishLogin(
  code: string,
  verifier: string,
  trace: FlowTrace,
): Promise<MangaBakaProfile> {
  const tokens = await exchangeCode(code, verifier);
  trace.push(
    `token exchange ok (refresh: ${tokens.refreshToken === undefined ? "no" : "yes"}` +
      `, scope: ${tokens.scope ?? "unstated"})`,
  );

  return storeSession(tokens, trace);
}

/**
 * Library access is proven before anything is stored, which stops a dead token being saved
 * behind a login that claims success. The profile is a nicety, so its failures fall back
 * instead. Keep that asymmetry — reversing it rejected a working token.
 */
async function storeSession(tokens: OAuthTokens, trace: FlowTrace): Promise<MangaBakaProfile> {
  await assertLibraryAccess(tokens.accessToken);
  trace.push("library access confirmed");

  let profile: MangaBakaProfile;
  try {
    profile = await fetchProfile(tokens.accessToken);
  } catch (error) {
    trace.push(`profile unavailable: ${error instanceof Error ? error.message : "unknown"}`);
    profile = FALLBACK_PROFILE;
  }

  saveTokens(tokens);
  Application.setState(JSON.stringify(profile), PROFILE_STATE);
  // A PAT from an earlier version is now dead weight; do not leave it in the keychain.
  Application.setSecureState(null, LEGACY_API_KEY_STATE);

  return profile;
}

/**
 * For the parked `OAuthButtonRow` in settingsForm.ts; kept live so it stays type-checked.
 * That row supplies no `expires_in`, so renewal falls to the 401 retry in `network.ts`.
 */
export async function loginWithTokens(
  accessToken: string,
  refreshToken: string,
): Promise<MangaBakaProfile> {
  const trace: FlowTrace = [
    "app OAuth flow",
    `tokens received (refresh: ${refreshToken.length > 0 ? "yes" : "no"})`,
  ];
  const tokens: OAuthTokens =
    refreshToken.length > 0 ? { accessToken, refreshToken } : { accessToken };

  try {
    return await storeSession(tokens, trace);
  } finally {
    Application.setState(JSON.stringify(trace), TRACE_STATE);
  }
}
