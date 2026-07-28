/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import type { Response } from "@paperback/types";

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

export async function login(email: string, password: string): Promise<AsuraSession> {
  const [status, data] = await postJson("/api/auth/login", { email, password });

  if (status === 401 || status === 403 || status === 422) {
    throw new Error("Incorrect email or password.");
  }
  if (status < 200 || status >= 300) {
    throw new Error(`Asura Scans returned HTTP ${status} for login`);
  }

  const session = buildSession(data as AuthResponse);
  saveSession(session);
  return session;
}

export async function refreshSession(session: AsuraSession): Promise<AsuraSession> {
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
