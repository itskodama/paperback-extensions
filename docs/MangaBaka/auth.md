# MangaBaka authentication

How this extension signs in to `mangabaka.org` and keeps a token. Verified against the live
server on 2026-08-15; re-probe before trusting any of it.

The short version: OAuth 2.0 authorization code + PKCE, driven by the extension itself
rather than by the app's OAuth support, using cookies captured from a sign-in web view.

## Discovery

```
https://mangabaka.org/auth/.well-known/openid-configuration
```

Also served, identically, from the site root (`/.well-known/openid-configuration`) and under
the RFC 8414 name (`/auth/.well-known/oauth-authorization-server`). Not on `api.mangabaka.org`.

| Field                                            | Value                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `issuer`                                         | `https://mangabaka.org/auth`                                   |
| `authorization_endpoint`                         | `/auth/oauth2/authorize`                                       |
| `token_endpoint`                                 | `/auth/oauth2/token`                                           |
| `code_challenge_methods_supported`               | `["S256"]` — **the only method**                               |
| `grant_types_supported`                          | `authorization_code`, `client_credentials`, `refresh_token`    |
| `scopes_supported`                               | `library.read library.write mod openid profile offline_access` |
| `prompt_values_supported`                        | `login`, `consent`, `create`, `select_account`, `none`         |
| `authorization_response_iss_parameter_supported` | `true` (RFC 9207)                                              |

Also present and unused: `jwks_uri`, `introspection_endpoint`, `revocation_endpoint`,
`userinfo_endpoint`, `end_session_endpoint`.

**Trap.** `token_endpoint_auth_methods_supported` lists only `client_secret_basic` and
`client_secret_post`, omitting `none` — which reads as "public clients unsupported". It is
simply incomplete. Probed directly, both the `authorization_code` and `refresh_token` grants
accept this client with a PKCE verifier and no secret. Do not go looking for a client secret.

## Client registration

Self-service, from the OAuth applications page on mangabaka.org. Dynamic registration
(`POST /auth/oauth2/register`, RFC 7591) exists but answers
`403 access_denied: "Client registration is disabled"`.

Registered as a **public native client**: no secret, PKCE required. The client id is not a
secret — it identifies the app and nothing more — and lives in `oauth.ts`.

### Redirect URI matching is byte-exact

No normalisation whatsoever. Probed against a live client:

| `redirect_uri`                   | Result       |
| -------------------------------- | ------------ |
| `paperback://mangabaka-auth`     | **accepted** |
| `paperback://mangabaka-auth/`    | rejected     |
| `PAPERBACK://mangabaka-auth`     | rejected     |
| `paperback://Mangabaka-auth`     | rejected     |
| `paperback://mangabaka-auth?x=1` | rejected     |
| `paperback://mangabaka-auth/cb`  | rejected     |
| `https://mangabaka.org/`         | rejected     |
| `urn:ietf:wg:oauth:2.0:oob`      | rejected     |

Rejection is a `302` to `/oauth-error?error=invalid_redirect`. Not even scheme case-folding
(which RFC 3986 requires) or a trailing slash survives, and nothing may be appended at request
time. The constant must never be "tidied up".

A custom scheme is required because the client is registered as a Native App; providers
restrict those to custom schemes and reject an `https://` redirect at registration.

## Scopes

```
library.read library.write offline_access openid
```

### `openid` is required, not cosmetic

This has cost two separate debugging sessions, so it is stated plainly:

**Without `openid`, every `/v1/my/*` call returns `401 BAD_REQUEST: Missing required scope`,
against a token that is otherwise completely valid.**

What makes it expensive is that nothing fails early. The authorize request succeeds, consent
is recorded, the code is issued, the token exchange succeeds, and the response reports
`scope: library.read library.write offline_access` exactly as requested. The failure appears
only at the first library call — by which point the obvious suspects are the token, the
refresh loop, or the API, none of which are at fault. The API simply will not resolve a user
from a token that was not issued under OIDC.

Corroborating: the OpenAPI spec declares its OAuth security scheme as `type: openIdConnect`.

The spec declares **no per-endpoint scopes**, so this is not discoverable from documentation;
it was established empirically.

A unit test asserts `openid` is present in the authorize URL. It has been removed twice
before (`83444a2`, `f9778a8`) on the belief that it only bought a display nickname.

### Changing the scope string invalidates every existing grant

Users must re-approve. Weigh that before adding or removing anything.

## The flow

`WebViewRow` cannot receive a custom-scheme redirect, and `Application.scheduleRequest`
**does not follow redirects** (see `../paperback/networking.md`). Those two facts together are
what make this design work: the code is read straight off the response, and
`paperback://mangabaka-auth` is never opened at all — it only has to match what MangaBaka has
on file.

1. The **Log In** row opens `/auth/oauth2/authorize?…&prompt=consent` in a web view. The user
   signs in by whatever method they like (email, social, passkey, 2FA) and approves MangaBaka's
   real consent screen. Nothing is approved on their behalf, and the extension never sees a
   password. The page ends on a redirect the browser cannot open — a blank page — which is
   expected.
2. `onComplete(cookies)` yields the session cookies. The code from step 1 is discarded.
3. The extension replays `/auth/oauth2/authorize` with those cookies and **`prompt=none`**,
   which is guaranteed to answer on the redirect URI without showing UI, carrying either
   `code` or a machine-readable `error`.
4. The response is read from a `Location` header **or**, when better-auth answers `200`
   instead, from a JSON body under `redirectURI`, `redirect_uri` or `url`. Both shapes occur;
   see below.
5. `state` and `iss` are both verified before the code is believed.
6. The code is exchanged at `/auth/oauth2/token` — form-encoded, `grant_type=authorization_code`,
   `code_verifier`, no client secret.
7. Tokens go to secure (keychain-backed) state; the cookies are discarded.

### `200` with a JSON body is a normal answer

better-auth does not always redirect. Asked for JSON — and this request must be, since the
walk reads JSON elsewhere — it replies `200` with the destination in the body rather than a
`302`. A `curl` probe with the default `Accept: */*` gets the `302` and never sees this, which
is exactly how it shipped broken once: the login failed with "HTTP 200 and no redirect" against
a session that was perfectly valid, with the authorization code sitting unread in the body.

### `prompt` values used

| Value     | Where                | Why                                                                                         |
| --------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `consent` | the Log In web view  | Shows the screen even when a grant exists, so re-approving after a scope change is possible |
| `none`    | the extension replay | Never shows UI; answers immediately with a code or an error                                 |

`prompt=none` error codes and what they mean here:

| Error                                       | Meaning                                               |
| ------------------------------------------- | ----------------------------------------------------- |
| `login_required`                            | The captured cookies did not authenticate the request |
| `consent_required` / `interaction_required` | The grant is missing; approve in a browser            |
| `access_denied`                             | The user declined                                     |

## Validating a new token

Validate against **`/v1/my/library/{id}`**, not `/v1/my/profile`.

`200` and `404` both prove the token works — 404 merely means that series is not on the list.
Only this probe may conclude a token is dead.

The profile endpoint is the wrong check. It answered `401 Missing required scope` for a
perfectly good token during the period `openid` was absent, and rejecting a working login on
that basis is a failure mode that has already shipped once. The profile is a nicety —
a display name and two preference defaults — and every one of its failures falls back to a
placeholder rather than blocking login. Keep that asymmetry.

When the placeholder is in use the settings form hides the "MangaBaka settings" section
entirely, because its values would be invented rather than read.

## Token lifetime and refresh

- `expires_in` is preferred over MangaBaka's non-standard absolute `expires_at`, since a
  relative value cannot be skewed by a wrong device clock.
- Renewal is both **proactive** (a minute before expiry, in `authHeaders`) and **reactive**
  (once on a `401`, in `network.ts`). The reactive path has to exist regardless: a token can
  be revoked long before it expires.
- The refresh grant takes `client_id` and no secret.
- Logout only forgets the token locally. **No connected-apps page has been found on
  mangabaka.org**, so there is no known way for a user to revoke the grant server-side —
  which is why the settings form no longer claims otherwise. Re-check before promising it.

## PKCE needs a hand-rolled SHA-256

`Application` exposes only `crypto_md5Hash`, and `S256` is MangaBaka's sole challenge method,
so `crypto.ts` implements FIPS 180-4 plus base64url. It is unit-tested against the published
SHA-256 vectors and the RFC 7636 worked example, because a wrong digest would surface only as
a failed login on device.

Randomness prefers `crypto.getRandomValues` when the JS context provides it (it is absent from
the platform typings) and falls back to a clock-mixed `Math.random`, which is **not**
cryptographically strong. Worth revisiting if the platform ever exposes a CSPRNG.

## The app's own OAuth row

`OAuthButtonRow` is the route Paperback intends for this, and would replace both the login row
and all of `oauth.ts`. It is **parked, commented out, in `settingsForm.ts`** — not deleted,
because it is a drop-in once the blockers clear.

**It hard-crashed the entire app** when shipped in `1.0.0-alpha.22` — a native crash, not a JS
error. Three deltas from the two extensions that use the row successfully, Inkdex's AniList and
nyzzik's MyAnimeList:

|                | AniList    | MyAnimeList     | Needed for MangaBaka |
| -------------- | ---------- | --------------- | -------------------- |
| `responseType` | `token`    | `pkce`, `plain` | `pkce`, **`S256`**   |
| `redirectUri`  | not passed | not passed      | **must be passed**   |
| `scopes`       | not passed | not passed      | **must be passed**   |

1. **`S256`.** MAL's server supports only `plain`, so no shipping extension exercises the S256
   branch. MangaBaka supports only `S256`, so `plain` is not an escape hatch. This is the
   likeliest crash and the one blocker with no workaround from the extension's side.
2. **`redirectUri` / `scopes`.** Omitting them, as both working extensions do, means the app's
   own default redirect URI — which MangaBaka would have to have registered on the client —
   and no scopes at all, which drops `openid` and breaks every `/v1/my/*` call.
3. **`onSuccess` argument order.** `@paperback/types` declares `(refreshToken, accessToken)`;
   MyAnimeList's handler reads `(accessToken, refreshToken)` and AniList's takes a single
   `accessToken`. The two shipping extensions agree with each other and not with the
   declaration. The parked code follows them.

Do not re-enable it without testing on a device.

## Superseded: the PAT scheme

Before `1.0.0-alpha.10` the extension minted a better-auth personal access token
(`POST /auth/api-key/create`, sent as `x-api-key: mb-…`). It was replaced because a session
cookie able to mint keys also reaches `/auth/update-user`, `/auth/change-email` and
`/auth/change-password`, where an OAuth token is confined to the library. The route still
exists and the API still accepts PATs; see `site-recon.md` for the original findings.
