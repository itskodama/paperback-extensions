/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  LabelRow,
  Section,
  ToggleRow,
  WebViewRow,
  type Cookie,
  type FormItemElement,
  type FormSectionElement,
} from "@paperback/types";

import { getSession, loginWithCookies, logout, type AsuraSession } from "./auth.ts";
import { runConnectionTests, type ProbeResult } from "./diagnostics.ts";
import { STATE_KEYS, canReadEarlyAccess, hideEarlyAccessEnabled } from "./settings.ts";
import { loginUrl } from "./urls.ts";

// `status` is billing lifecycle, not access: auto-renew off reports `canceled` while premium
// still works. Only states worth acting on are named. See auth.md#subscription-status.
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
  private showDiagnostics = false;
  private testing = false;
  private testResults: ProbeResult[] = [];

  override getSections(): FormSectionElement<unknown>[] {
    // Read live, not cached at construction, so a refresh/logout elsewhere is reflected
    const session = getSession();

    const account = session ? this.accountSection(session) : this.loginSection();

    // A subscription can open every early access chapter, so the toggle would do nothing
    const sections = canReadEarlyAccess() ? [account] : [account, this.chaptersSection()];
    return [...sections, this.debugSection()];
  }

  private debugSection(): FormSectionElement<unknown> {
    const rows: FormItemElement<unknown>[] = [
      ToggleRow("debug", {
        title: "Show connection tests",
        value: this.showDiagnostics,
        onValueChange: Application.Selector(this as AsuraScansSettingsForm, "handleDebugChange"),
      }),
    ];

    if (this.showDiagnostics) {
      rows.push(
        ButtonRow("run-tests", {
          title: this.testing ? "Testing…" : "Run connection tests",
          onSelect: Application.Selector(this as AsuraScansSettingsForm, "handleRunTests"),
        }),
        ...this.testResults.map((result, index) =>
          LabelRow(`test-${index}`, {
            title: result.title,
            value: result.outcome,
            ...(result.detail ? { subtitle: result.detail } : {}),
          }),
        ),
      );
    }

    return Section(
      {
        id: "debug",
        header: "Debug",
        footer:
          "Sends one request per change made since alpha.10, to show which one fixed loading. " +
          "The stored Cloudflare cookie can no longer be tested: alpha.15 removed it.",
      },
      rows,
    );
  }

  async handleDebugChange(value: boolean): Promise<void> {
    this.showDiagnostics = value;
    this.reloadForm();
  }

  async handleRunTests(): Promise<void> {
    if (this.testing) return;

    this.testing = true;
    this.reloadForm();
    try {
      this.testResults = await runConnectionTests();
    } finally {
      this.testing = false;
      this.reloadForm();
    }
  }

  private chaptersSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "chapters",
        header: "Chapters",
        footer:
          "Early access chapters stay in the list until they unlock, where opening one explains " +
          "when it will. Turn this on to leave them out of series and Latest Updates instead.",
      },
      [
        ToggleRow("hide-early-access", {
          title: "Hide early access chapters",
          value: hideEarlyAccessEnabled(),
          onValueChange: Application.Selector(
            this as AsuraScansSettingsForm,
            "handleHideEarlyAccessChange",
          ),
        }),
      ],
    );
  }

  async handleHideEarlyAccessChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.hideEarlyAccess);
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

  // No `subtitle`: WebViewRowProps has no such field, and an unknown key can stop the row
  // rendering on device without tsc objecting.
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
