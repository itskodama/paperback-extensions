/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import type { Cookie, Response } from "@paperback/types";

import { ASURA_API } from "./models.ts";

const SESSION_STATE_KEY = "asurascans.session";

// Verified 15-minute access token lifetime, not the 1-day the site's own cookie claims
const EXPIRY_SAFETY_MARGIN_MS = 60_000;

export type AsuraSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  username: string;
  hasSubscription: boolean;
  tier?: string;
  subscriptionStatus?: string;
};

type AuthResponse = {
  user?: { username?: unknown; role?: unknown; premium_until?: unknown };
  access_token?: unknown;
  refresh_token?: unknown;
  expires_at?: unknown;
  subscription_status?: { has_subscription?: unknown; tier?: unknown; status?: unknown };
};

// login never returns subscription_status (only refresh does), so this — mirroring the site's
// own login-page isPremiumActive() — is the only signal available right after logging in
const STAFF_ROLES = ["staff", "moderator", "uploader", "admin"];
const PAID_ROLES = ["premium"];

function isPremiumRole(role: unknown, premiumUntil: unknown): boolean {
  if (typeof role !== "string") return false;
  if (STAFF_ROLES.includes(role)) return true;
  if (!PAID_ROLES.includes(role) || typeof premiumUntil !== "string") return false;

  const until = new Date(premiumUntil).getTime();
  return !Number.isNaN(until) && until > Date.now();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isValidSession(value: unknown): value is AsuraSession {
  if (typeof value !== "object" || value === null) return false;
  const session = value as Record<string, unknown>;

  return (
    isNonEmptyString(session.accessToken) &&
    isNonEmptyString(session.refreshToken) &&
    isNonEmptyString(session.expiresAt) &&
    isNonEmptyString(session.username) &&
    typeof session.hasSubscription === "boolean"
  );
}

export function isSessionExpired(session: AsuraSession, now: number = Date.now()): boolean {
  const expiresAt = new Date(session.expiresAt).getTime();
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - EXPIRY_SAFETY_MARGIN_MS <= now;
}

// setSecureState doesn't reliably round-trip a nested object — serialize/parse it ourselves instead
export function getSession(): AsuraSession | undefined {
  const stored = Application.getSecureState(SESSION_STATE_KEY);
  if (typeof stored !== "string" || stored.length === 0) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return undefined;
  }

  return isValidSession(parsed) ? parsed : undefined;
}

export function clearSession(): void {
  Application.setSecureState(null, SESSION_STATE_KEY);
}

function saveSession(session: AsuraSession): void {
  Application.setSecureState(JSON.stringify(session), SESSION_STATE_KEY);
}

// The API wraps successful bodies in {"data": {...}} but error bodies are flat ({"error": "..."})
export function unwrapEnvelope(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const envelope = parsed as { data?: unknown };
  return envelope.data ?? parsed;
}

export function buildSession(data: AuthResponse, fallbackRefreshToken?: string): AsuraSession {
  const username = data.user?.username;
  const accessToken = data.access_token;
  const refreshToken = data.refresh_token ?? fallbackRefreshToken;
  const expiresAt = data.expires_at;
  const hasSubscription =
    typeof data.subscription_status?.has_subscription === "boolean"
      ? data.subscription_status.has_subscription
      : isPremiumRole(data.user?.role, data.user?.premium_until);
  const tier = data.subscription_status?.tier ?? data.user?.role;
  const subscriptionStatus = data.subscription_status?.status;

  if (
    !isNonEmptyString(username) ||
    !isNonEmptyString(accessToken) ||
    !isNonEmptyString(refreshToken) ||
    !isNonEmptyString(expiresAt)
  ) {
    throw new Error("Asura Scans returned an incomplete session");
  }

  const session: AsuraSession = { accessToken, refreshToken, expiresAt, username, hasSubscription };
  if (isNonEmptyString(tier)) session.tier = tier;
  if (isNonEmptyString(subscriptionStatus)) session.subscriptionStatus = subscriptionStatus;
  return session;
}

async function postJson(path: string, body: object): Promise<[number, unknown]> {
  const [response, data] = await Application.scheduleRequest({
    url: `${ASURA_API}${path}`,
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const text = Application.arrayBufferToUTF8String(data);
  const parsed: unknown = text.length > 0 ? JSON.parse(text) : {};
  return [response.status, unwrapEnvelope(parsed)];
}

// Asura's login page writes these with document.cookie, so they are not HttpOnly. See auth.md.
const ACCESS_TOKEN_COOKIE = "access_token";
const REFRESH_TOKEN_COOKIE = "refresh_token";

export function asuraCookieValue(cookies: Cookie[], name: string): string | undefined {
  for (const cookie of cookies) {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    const onAsura = domain === "asurascans.com" || domain.endsWith(".asurascans.com");
    if (onAsura && cookie.name === name && cookie.value.length > 0) {
      return decodeURIComponent(cookie.value);
    }
  }
  return undefined;
}

// Only the refresh response states the real expiry, username and tier. See auth.md.
export async function loginWithCookies(cookies: Cookie[]): Promise<AsuraSession> {
  const refreshToken = asuraCookieValue(cookies, REFRESH_TOKEN_COOKIE);
  if (!refreshToken) {
    throw new Error(
      "No Asura Scans session was captured. Sign in fully, then close the page with Done.",
    );
  }

  const accessToken = asuraCookieValue(cookies, ACCESS_TOKEN_COOKIE) ?? "";

  try {
    return await refreshSession({
      accessToken,
      refreshToken,
      // Already expired: the next request renews rather than trusting the cookie's own claim.
      expiresAt: new Date(0).toISOString(),
      username: "",
      hasSubscription: false,
    });
  } catch {
    // refreshSession's "session expired" wording reads as nonsense to someone who just did.
    throw new Error("Asura Scans did not accept that sign-in. Please try logging in again.");
  }
}

// Asura rotates the refresh token, so a second concurrent renewal would present a spent one.
let inFlightRefresh: Promise<AsuraSession> | undefined;

export async function refreshSession(session: AsuraSession): Promise<AsuraSession> {
  const pending = inFlightRefresh;
  if (pending) return pending;

  const renewal = requestRefresh(session);
  inFlightRefresh = renewal;

  try {
    return await renewal;
  } finally {
    inFlightRefresh = undefined;
  }
}

async function requestRefresh(session: AsuraSession): Promise<AsuraSession> {
  const [status, data] = await postJson("/api/auth/refresh", {
    refresh_token: session.refreshToken,
  });

  if (status === 401) {
    clearSession();
    throw new Error("Asura Scans session expired. Please log in again.");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Asura Scans returned HTTP ${status} refreshing the session`);
  }

  const refreshed = buildSession(data as AuthResponse, session.refreshToken);
  saveSession(refreshed);
  return refreshed;
}

export async function logout(): Promise<void> {
  const session = getSession();
  if (session) {
    try {
      await postJson("/api/auth/logout", { refresh_token: session.refreshToken });
    } catch {
      // A logout that fails to reach the server still logs the user out locally
    }
  }
  clearSession();
}

export async function authorizedFetch(path: string): Promise<[Response, ArrayBuffer] | undefined> {
  let session = getSession();
  if (!session) return undefined;

  if (isSessionExpired(session)) {
    session = await refreshSession(session);
  }

  const doFetch = (accessToken: string): Promise<[Response, ArrayBuffer]> =>
    Application.scheduleRequest({
      url: `${ASURA_API}${path}`,
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
    });

  let [response, data] = await doFetch(session.accessToken);

  if (response.status === 401) {
    session = await refreshSession(session);
    [response, data] = await doFetch(session.accessToken);
  }

  return [response, data];
}
