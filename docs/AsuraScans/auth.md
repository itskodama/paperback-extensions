# Asura Scans authentication

How the extension gets a session, and why it takes credentials nowhere near itself.

## The flow

1. A `WebViewRow` in the settings form opens `https://asurascans.com/login`.
2. The user signs in on Asura's own page. **The extension is not involved** — it never renders a
   password field, never reads one, and never sends one.
3. The web view closes and `onComplete(cookies)` hands back its cookie jar.
4. `loginWithCookies` pulls `refresh_token` out of the jar and immediately spends it against
   `POST /api/auth/refresh`, which returns a complete session.

Step 4 is not a formality. The cookies carry the two tokens and nothing else, and what they do
carry cannot be trusted at face value:

- **No usable expiry.** The `access_token` cookie is written with a one-day lifetime, but the
  token itself lasts about fifteen minutes (verified). The refresh response states the real
  `expires_at`.
- **No username**, which the settings screen shows.
- **No subscription status.** `/api/auth/refresh` is the _only_ endpoint that returns
  `subscription_status` at all — `/api/auth/login` never did. So the web-view flow lands a
  strictly better session than the password flow it replaced, not merely an equivalent one.

The session is stored with `Application.setSecureState`, serialized to a string (a nested object
does not reliably round-trip).

## Why capturing cookies is enough

Asura's login page stores its tokens with `document.cookie`, not with a server `Set-Cookie`:

```js
document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/; SameSite=Lax';
…
setCookie('access_token', accessToken, 1);
setCookie('refresh_token', refreshToken, 30);
```

Because they are written from JavaScript they are **not `HttpOnly`**, so they are ordinary
cookies in the web view's jar and `onComplete` sees them. The values are percent-encoded on
write, so they are decoded on read.

The page also mirrors both tokens plus a `user` object into `localStorage`. **That is not
reachable**: `WebViewRowProps.onComplete` is typed `(cookies: Cookie[]) => Promise<void>` and has
no localStorage parameter — unlike `cloudflareBypassCompleted`, which does get one. The cookie
copy is the only way in, which is the whole reason this approach works.

## The cookie jar is a trust boundary

`asuraCookieValue` accepts a cookie only from `asurascans.com` or a subdomain, matching after
stripping a leading dot. A jar can hold cookies from any host the web view touched, and a
same-named `refresh_token` from somewhere else must never be mistaken for a session. Note that
`asurascans.com.example.net` **ends with** the domain as a plain string but is not a subdomain —
the check is `=== "asurascans.com" || endsWith(".asurascans.com")` for exactly that reason, and
there is a unit test pinning it.

## What the session is used for

Only unlocking chapters. `authorizedFetch` attaches `Authorization: Bearer <access_token>` to the
two JSON endpoints that serve early-access and premium content:

- `/api/series/<slug>/chapters/<n>` — comics
- `/api/novel-series/<slug>/chapter/<n>` — novels

Everything else the extension reads is public HTML fetched anonymously. The catalog pages sit
behind a shared Cloudflare edge cache and never vary by auth, which is why they are never fetched
with a token.

## Subscription status

`subscription_status` carries two fields that answer different questions, and they disagree
routinely:

- **`has_subscription`** — does this grant access right now? This is the one to branch on.
- **`status`** — the billing lifecycle. Turning auto-renew off reports `canceled` from that moment
  on, while premium keeps working until the paid period ends.

Printing `status` verbatim therefore labelled a working premium account "canceled" (reported from
a real account whose early access worked fine throughout). `subscriptionSubtitle` names only the
states a reader can act on — `canceled`/`cancelled` as "does not renew", `past_due`/`unpaid` as
"payment overdue", `trialing` as "trial". Everything else, `active` and any state Asura adds
later included, shows just the tier.

## Renewal

`refreshSession` swaps the refresh token for a new pair. Asura **rotates** the refresh token on
every renewal, so the old one dies the moment the new one is issued. Two concurrent renewals would
therefore mean the second presents a spent token, take a 401, and clear a session that was
working — so all callers share one in-flight renewal promise.

`authorizedFetch` renews on two triggers: preemptively when `isSessionExpired` says the token is
inside its 60-second safety margin, and reactively on a 401 from the endpoint itself.

## History

The extension previously posted `{email, password}` as JSON to `/api/auth/login` and stored the
result. It worked, but it meant a third-party reader handling a password in plaintext, which is
the kind of thing users are right to refuse. The endpoint still exists; nothing in `src/` calls it.

## See also

- [`site-architecture.md`](site-architecture.md) — the hosts, routes and island shapes
- [`../paperback/forms.md`](../paperback/forms.md) — `WebViewRow` and the form lifecycle
- [`../MangaBaka/auth.md`](../MangaBaka/auth.md) — the same web-view idea against an OAuth server,
  which needs a whole authorization-code walk where this needs one refresh call
