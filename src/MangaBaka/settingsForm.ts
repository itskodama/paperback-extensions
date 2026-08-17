/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

import {
  ButtonRow,
  Form,
  LabelRow,
  Section,
  SelectRow,
  ToggleRow,
  WebViewRow,
  type Cookie,
  type FormSectionElement,
} from "@paperback/types";

import {
  canWriteLibrary,
  clearLoginTrace,
  getLoginTrace,
  getProfile,
  isPlaceholderProfile,
  loginWithCookies,
  logout,
  refreshProfile,
  type MangaBakaProfile,
} from "./auth";
import { humanizeSlug } from "./mapping";
import { clearCache } from "./network";
import { authorizeUrl, newAuthorizeSession } from "./oauth";
import {
  autoCompleteEnabled,
  debugEnabled,
  getCryptoSupport,
  getSyncStatus,
  STATE_KEYS,
  titlePreference,
} from "./settings";
import { TITLE_PREFERENCES } from "./titles";
import { LIBRARY_STATES, SITE_BASE } from "./types";

/** Long row titles are truncated on screen, so they are split across rows. */
function chunk(text: string, width: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.length > 0 ? lines : [text];
}

export class MangaBakaSettingsForm extends Form {
  // Built in formWillAppear because the PKCE challenge is now an async WebCrypto digest.
  // `prompt=consent` so the screen still appears when a grant exists. The code this URL
  // yields is discarded; the login completes from the cookies the web view returns.
  private authorizeUrl: string | undefined;

  private busy = false;
  private error: string | undefined;
  private refreshing = false;
  private refreshError: string | undefined;

  override formWillAppear(): void {
    if (this.authorizeUrl !== undefined) return;

    void newAuthorizeSession()
      .then((session) => {
        this.authorizeUrl = authorizeUrl({ ...session, prompt: "consent" });
      })
      .catch((error: unknown) => {
        this.error = error instanceof Error ? error.message : "Could not prepare sign-in.";
      })
      .finally(() => {
        this.reloadForm();
      });
  }

  override getSections(): FormSectionElement<unknown>[] {
    // Read live, so logging out elsewhere is reflected without rebuilding the form.
    const profile = getProfile();

    // The debug toggle sits directly above the sections it reveals, so turning it on
    // grows the screen downwards from it rather than pushing it out of view.
    return profile
      ? [
          this.accountSection(profile),
          // Invented values must not be shown as the user's own settings.
          ...(isPlaceholderProfile(profile) ? [] : [this.mangaBakaSection(profile)]),
          this.titleSection(),
          this.syncSection(),
          this.debugSection(),
          ...this.diagnosticsSections(),
          this.aboutSection(),
        ]
      : [
          this.loginSection(),
          this.titleSection(),
          this.debugSection(),
          ...this.diagnosticsSections(),
          this.aboutSection(),
        ];
  }

  /**
   * The web view signs the user in and takes their consent; its cookies are enough for the
   * extension to finish OAuth itself. See docs/MangaBaka/auth.md.
   *
   * No `subtitle`: `WebViewRowProps` has no such field, and an unknown key can stop the row
   * rendering on device without `tsc` objecting.
   */
  private loginSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "login",
        header: "Account",
        footer:
          "Logging in opens mangabaka.org: clear the Cloudflare check, sign in, then tap " +
          "Grant Access. The page that follows says it is redirecting you back to the " +
          "app but never will — tap Done at the top right to close it, and you are " +
          "signed in. Paperback only receives a token limited to reading and writing " +
          "your library: it cannot change your account, email or password, and your " +
          "password is never seen or saved.",
      },
      [
        LabelRow("login-status", {
          title: this.busy ? "Finishing login…" : "Not logged in",
          ...(this.error ? { value: { text: this.error, style: "error" as const } } : {}),
        }),
        ...(this.authorizeUrl === undefined
          ? [LabelRow("login-preparing", { title: "Preparing sign-in…" })]
          : [
              WebViewRow("login", {
                title: "Log In",
                request: { url: this.authorizeUrl, method: "GET" },
                onComplete: Application.Selector(
                  this as MangaBakaSettingsForm,
                  "handleLoginComplete",
                ),
                onCancel: Application.Selector(this as MangaBakaSettingsForm, "handleLoginCancel"),
              }),
            ]),

        // Parked: the app's own OAuth row, which would replace this row and all of
        // oauth.ts. It crashes the app as configured for MangaBaka — see
        // docs/MangaBaka/auth.md#the-apps-own-oauth-row. Everything it references is
        // exported and type-checked, so enabling it is uncommenting these two blocks.
        //
        // OAuthButtonRow("oauth-login", {
        //   title: "Log In with MangaBaka",
        //   authorizeEndpoint: AUTHORIZE_ENDPOINT,
        //   clientId: CLIENT_ID,
        //   redirectUri: REDIRECT_URI,
        //   scopes: SCOPE_LIST,
        //   responseType: {
        //     type: "pkce",
        //     tokenEndpoint: TOKEN_ENDPOINT,
        //     pkceCodeLength: 64,
        //     pkceCodeMethod: "S256",
        //     formEncodeGrant: true,
        //   },
        //   onSuccess: Application.Selector(this as MangaBakaSettingsForm, "handleOAuthSuccess"),
        // }),
      ],
    );
  }

  // async handleOAuthSuccess(accessToken: string, refreshToken: string): Promise<void> {
  //   if (this.busy) return;
  //
  //   this.busy = true;
  //   this.error = undefined;
  //   this.reloadForm();
  //
  //   try {
  //     await loginWithTokens(accessToken, refreshToken);
  //   } catch (error) {
  //     this.error = error instanceof Error ? error.message : "Log in failed.";
  //   } finally {
  //     this.busy = false;
  //     this.reloadForm();
  //   }
  // }

  private debugSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "debug",
        header: "Debug",
        footer:
          "Shows the last sync result, this device's runtime capabilities and the last " +
          "login attempt. Turn this on before reporting a problem.",
      },
      [
        ToggleRow("debug", {
          title: "Show diagnostics",
          value: debugEnabled(),
          onValueChange: Application.Selector(this as MangaBakaSettingsForm, "handleDebugChange"),
        }),
      ],
    );
  }

  /** One row per hop, because a long string is truncated on screen. */
  private diagnosticsSections(): FormSectionElement<unknown>[] {
    if (!debugEnabled()) return [];

    const sections: FormSectionElement<unknown>[] = [];

    const sync = getSyncStatus();
    if (sync !== undefined) {
      sections.push(
        Section(
          {
            id: "sync-status",
            header: "Last sync",
            footer: "The result of the most recent progress sync to your MangaBaka library.",
          },
          chunk(sync, 58).map((line, index) => LabelRow(`sync-${index}`, { title: line })),
        ),
      );
    }

    const crypto = getCryptoSupport();
    if (crypto !== undefined) {
      sections.push(
        Section(
          {
            id: "runtime",
            header: "Runtime",
            footer:
              "What this device's JavaScript engine provides. Recorded so the bundled " +
              "SHA-256 can be dropped if the platform ever supplies one.",
          },
          chunk(crypto, 58).map((line, index) => LabelRow(`crypto-${index}`, { title: line })),
        ),
      );
    }

    const trace = getLoginTrace();
    if (trace.length === 0) return sections;

    return [
      ...sections,
      Section(
        {
          id: "login-diagnostics",
          header: "Login diagnostics",
          footer: "From the last login attempt. Clears when you log in successfully.",
        },
        [
          ...trace.map((line, index) =>
            LabelRow(`trace-${index}`, { title: line.slice(0, 60), subtitle: line.slice(60) }),
          ),
          ButtonRow("clear-trace", {
            title: "Clear diagnostics",
            onSelect: Application.Selector(this as MangaBakaSettingsForm, "handleClearTrace"),
          }),
        ],
      ),
    ];
  }

  async handleClearTrace(): Promise<void> {
    clearLoginTrace();
    this.reloadForm();
  }

  private accountSection(profile: MangaBakaProfile): FormSectionElement<unknown> {
    const writable = canWriteLibrary(profile);

    return Section(
      {
        id: "account",
        header: "Account",
        footer: "Logging out removes the stored token from this device.",
      },
      [
        LabelRow("account-status", {
          title: `Logged in as ${profile.nickname}`,
          // Without library.write, sync fails silently. Say so before that happens.
          ...(writable
            ? {}
            : {
                value: {
                  text: "This key cannot write to your library. Log in again.",
                  style: "error" as const,
                },
              }),
          subtitle: writable
            ? "Progress will sync to your MangaBaka library."
            : "Read-only access.",
        }),
        ButtonRow("logout", {
          title: "Log Out",
          onSelect: Application.Selector(this as MangaBakaSettingsForm, "handleLogout"),
        }),
      ],
    );
  }

  /** The API cannot write account preferences, so this opens MangaBaka's own page. */
  private mangaBakaSection(profile: MangaBakaProfile): FormSectionElement<unknown> {
    const defaultState =
      LIBRARY_STATES.find((state) => state.id === profile.libraryDefaultState)?.title ??
      humanizeSlug(profile.libraryDefaultState);

    return Section(
      {
        id: "mangabaka-account",
        header: "MangaBaka settings",
        footer: this.refreshError
          ? this.refreshError
          : "These are set on MangaBaka and used here. Opening the page signs you in " +
            "again — Paperback cannot pass its login into the web view — but your " +
            "settings are re-read as soon as you close it.",
      },
      [
        LabelRow("default-state", {
          title: "Default library state",
          subtitle: "Used when you add a title from the tracker.",
          value: { text: defaultState },
        }),
        LabelRow("rating-steps", {
          title: "Score increment",
          subtitle: "Scores are always stored out of 100.",
          value: { text: `${profile.ratingSteps}` },
        }),
        LabelRow("account-role", { title: "Role", value: { text: humanizeSlug(profile.role) } }),
        WebViewRow("open-settings", {
          title: this.refreshing ? "Refreshing…" : "Open on MangaBaka (sign-in required)",
          // The WebView cannot be pre-authenticated: cookies only travel *out* of it via
          // onComplete, and a cookie request header does not seed its jar (tried, and it
          // still landed on the login page behind a Cloudflare check). So the URL goes
          // through the sign-in with a redirect, which at least lands on the settings
          // page afterwards instead of dumping the user on the site root.
          request: { url: `${SITE_BASE}/auth?redirect_to=/my/settings`, method: "GET" },
          onComplete: Application.Selector(this as MangaBakaSettingsForm, "handleSettingsClosed"),
          onCancel: Application.Selector(this as MangaBakaSettingsForm, "handleSettingsClosed"),
        }),
      ],
    );
  }

  private titleSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "titles",
        header: "Titles",
        footer:
          "MangaBaka stores a title per language. Choose which one to display. " +
          "Titles you have already opened keep their old name until they are refreshed.",
      },
      [
        SelectRow("title-language", {
          title: "Title language",
          value: [titlePreference()],
          layout: "list",
          items: TITLE_PREFERENCES.map((option) => ({ id: option.id, title: option.title })),
          minItemCount: 1,
          maxItemCount: 1,
          onValueChange: Application.Selector(
            this as MangaBakaSettingsForm,
            "handleTitleLanguageChange",
          ),
        }),
      ],
    );
  }

  private syncSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "sync",
        header: "Sync",
        footer:
          "When the last chapter of a finished series is read, mark it as Completed and " +
          "record the finish date.",
      },
      [
        ToggleRow("auto-complete", {
          title: "Complete finished series",
          value: autoCompleteEnabled(),
          onValueChange: Application.Selector(
            this as MangaBakaSettingsForm,
            "handleAutoCompleteChange",
          ),
        }),
      ],
    );
  }

  // Attribution is a ToS requirement, not decoration. See docs/MangaBaka/site-recon.md.
  private aboutSection(): FormSectionElement<unknown> {
    return Section(
      {
        id: "about",
        header: "About",
        footer:
          "Series data is provided by MangaBaka (mangabaka.org) under CC BY-NC-SA 4.0, " +
          "aggregating AniList, MyAnimeList, MangaUpdates, Kitsu, Anime-Planet, Shikimori " +
          "and Anime News Network.",
      },
      [LabelRow("attribution", { title: "Data by MangaBaka", subtitle: SITE_BASE })],
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

  /** Fires on both completion and cancellation — the sheet may be dismissed anywhere. */
  async handleSettingsClosed(): Promise<void> {
    if (this.refreshing) return;

    this.refreshing = true;
    this.refreshError = undefined;
    this.reloadForm();

    try {
      await refreshProfile();
    } catch (error) {
      this.refreshError =
        error instanceof Error ? error.message : "Could not re-read your MangaBaka settings.";
    } finally {
      this.refreshing = false;
      this.reloadForm();
    }
  }

  async handleLogout(): Promise<void> {
    logout();
    clearCache();
    this.reloadForm();
  }

  async handleDebugChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.debug);
    this.reloadForm();
  }

  async handleAutoCompleteChange(value: boolean): Promise<void> {
    Application.setState(value, STATE_KEYS.autoComplete);
  }

  async handleTitleLanguageChange(value: string[]): Promise<void> {
    const next = value[0];
    if (next === undefined) return;

    // The cache holds raw payloads, not mapped titles, so the next render re-maps them.
    Application.setState(next, STATE_KEYS.titleLanguage);
  }
}
