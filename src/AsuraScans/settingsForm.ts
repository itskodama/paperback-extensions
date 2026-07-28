/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import { ButtonRow, Form, InputRow, LabelRow, Section } from "@paperback/types";

import { getSession, login, logout, type AsuraSession } from "./auth";

function subscriptionSubtitle(session: AsuraSession): string {
  if (!session.hasSubscription) return "No active subscription";

  const tier = session.tier ?? "premium";
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  return session.subscriptionStatus ? `${label} — ${session.subscriptionStatus}` : label;
}

export class AsuraScansSettingsForm extends Form {
  private session: AsuraSession | undefined = getSession();
  private email = "";
  private password = "";
  private busy = false;
  private error: string | undefined;

  override getSections() {
    if (this.session) {
      return [
        Section("account", [
          LabelRow("account-status", {
            title: `Logged in as ${this.session.username}`,
            subtitle: subscriptionSubtitle(this.session),
          }),
          ButtonRow("logout", {
            title: "Log Out",
            onSelect: Application.Selector(this as AsuraScansSettingsForm, "handleLogout"),
          }),
        ]),
      ];
    }

    return [
      Section("account", [
        LabelRow("account-status", {
          title: "Not logged in",
          value: this.error ? { text: this.error, style: "error" as const } : undefined,
        }),
        InputRow("email", {
          title: "Email",
          value: this.email,
          onValueChange: Application.Selector(this as AsuraScansSettingsForm, "handleEmailChange"),
        }),
        InputRow("password", {
          title: "Password",
          value: this.password,
          isSecureEntry: true,
          onValueChange: Application.Selector(
            this as AsuraScansSettingsForm,
            "handlePasswordChange",
          ),
        }),
        ButtonRow("login", {
          title: this.busy ? "Logging in…" : "Log In",
          onSelect: Application.Selector(this as AsuraScansSettingsForm, "handleLogin"),
        }),
      ]),
    ];
  }

  async handleEmailChange(value: string): Promise<void> {
    this.email = value;
  }

  async handlePasswordChange(value: string): Promise<void> {
    this.password = value;
  }

  async handleLogin(): Promise<void> {
    if (this.busy) return;

    this.busy = true;
    this.error = undefined;
    this.reloadForm();

    try {
      this.session = await login(this.email, this.password);
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Log in failed.";
    } finally {
      this.password = "";
      this.busy = false;
      this.reloadForm();
    }
  }

  async handleLogout(): Promise<void> {
    await logout();
    this.session = undefined;
    this.reloadForm();
  }
}
