/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  LabelRow,
  Section,
  WebViewRow,
  type Cookie,
  type FormSectionElement,
} from "@paperback/types";

import { getSession, loginWithCookies, logout, type AsuraSession } from "./auth.ts";
import { loginUrl } from "./urls.ts";

/**
 * `subscription_status.status` is the billing lifecycle, not whether the subscription currently
 * grants anything — `has_subscription` already answered that, and is what gets checked above.
 * The two disagree routinely: turning auto-renew off reports `canceled` while premium keeps
 * working until the paid period ends, so printing the raw word made a working account read as a
 * broken one.
 *
 * Only states a reader can act on are named, and in plain language. Anything else — `active`
 * included, and any state Asura adds later — says nothing beyond the tier.
 */
const SUBSCRIPTION_NOTES: Record<string, string> = {
  canceled: "does not renew",
  cancelled: "does not renew",
  incomplete: "payment incomplete",
  past_due: "payment overdue",
  trialing: "trial",
  unpaid: "payment overdue",
};

export function subscriptionSubtitle(session: AsuraSession): string {
  if (!session.hasSubscription) return "No active subscription";

  const tier = session.tier ?? "premium";
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const note = SUBSCRIPTION_NOTES[(session.subscriptionStatus ?? "").toLowerCase()];

  return note ? `${label} — ${note}` : label;
}

export class AsuraScansSettingsForm extends Form {
  private busy = false;
  private error: string | undefined;

  override getSections(): FormSectionElement<unknown>[] {
    // Read live, not cached at construction, so a refresh/logout elsewhere is reflected
    const session = getSession();

    return session ? [this.accountSection(session)] : [this.loginSection()];
  }

  private accountSection(session: AsuraSession): FormSectionElement<unknown> {
    return Section(
      {
        id: "account",
        header: "Account",
        footer: "Logging out removes the stored token from this device.",
      },
      [
        LabelRow("account-status", {
          title: `Logged in as ${session.username}`,
          subtitle: subscriptionSubtitle(session),
        }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as AsuraScansSettingsForm, "handleLogout"),
        }),
      ],
    );
  }

  /**
   * Asura's own login page is what takes the credentials; it stores its tokens in ordinary
   * JavaScript cookies, which is what makes capturing them enough. The extension never sees an
   * email or a password. See docs/AsuraScans/auth.md.
   *
   * No `subtitle` on WebViewRow: `WebViewRowProps` has no such field, and an unknown key can stop
   * the row rendering on device without `tsc` objecting.
   */
  private loginSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "login",
        header: "Account",
        footer:
          "Logging in opens asurascans.com. Sign in there, then tap Done at the top right to " +
          "close the page. Paperback receives only the session token the site issues: your " +
          "password is never seen, sent, or stored by the extension.",
      },
      [
        LabelRow("account-status", {
          title: this.busy ? "Finishing login…" : "Not logged in",
          ...(this.error ? { value: { text: this.error, style: "error" as const } } : {}),
        }),
        WebViewRow("login", {
          title: "Log In",
          request: { url: loginUrl(), method: "GET" },
          onComplete: Application.Selector(this as AsuraScansSettingsForm, "handleLoginComplete"),
          onCancel: Application.Selector(this as AsuraScansSettingsForm, "handleLoginCancel"),
        }),
      ],
    );
  }

  async handleLoginComplete(cookies: Cookie[]): Promise<void> {
    if (this.busy) return;

    this.busy = true;
    this.error = undefined;
    this.reloadForm();

    try {
      await loginWithCookies(cookies);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Log in failed.";
    } finally {
      this.busy = false;
      this.reloadForm();
    }
  }

  async handleLoginCancel(): Promise<void> {
    this.busy = false;
    this.error = "Login was closed before it finished. Please try again.";
    this.reloadForm();
  }

  async handleLogout(): Promise<void> {
    await logout();
    this.reloadForm();
  }
}
