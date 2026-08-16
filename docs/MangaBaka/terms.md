# MangaBaka terms

What mangabaka.org permits and requires of an API client, and how this extension satisfies it.
Read from `robots.txt` and the Terms of Service effective 2026-03-24; re-check before relying on
any of it.

## robots.txt

`robots.txt` is unusually automation-friendly — it does not merely tolerate API clients, it
advertises them:

```
# Crawling manga/novel data please use the API or Database download for efficiency:
#
# OpenAPI spec: https://mangabaka.org/api.json
# Database download: https://mangabaka.org/data/database
```

…and then lists the cross-source lookup endpoints and six bulk-dump formats outright.

One nuance worth recording rather than glossing: `robots.txt` has `Disallow: /auth`, which is the
page the WebView login navigates to. That directive governs **crawlers indexing the login page**. A
user tapping "Log In" and authenticating themselves in a WebView is not crawling — it is the same
class of client the site's own frontend is, driven by the account holder. Not a blocker, but state
it plainly rather than pretend the line isn't there.

## Terms of Service

The ToS (effective 2026-03-24) is explicit in both directions:

- **Permits us**: prohibited conduct is "Use automated means (bots, scrapers, crawlers) to access the
  Service **except through the MangaBaka API or database downloads** in compliance with the Data
  License." An API client is the sanctioned path.
- **Constrains us**: "You must not share your password, session tokens, personal access tokens
  (PATs), or OAuth credentials with any third party", and PATs "are issued for your use only and must
  not be shared, sold, or transferred." → the extension must **never** embed a shared credential.
  Each user's key is minted for them, stored in their own device keychain, and never transmitted
  anywhere but MangaBaka. Also prohibited: "Circumvent any rate limits."

## Attribution

The ToS requires crediting "both MangaBaka and the underlying data providers", and accepts any of
"a link in the footer of your site or application", "in your project's README file", "in the
'About' page", or "next to your own data for that series". MangaBaka's data is **CC BY-NC-SA 4.0**
and the grant is for "personal, non-commercial purposes" — that licence covers the _data_, not this
repository's code, which stays GPL-3.0-or-later.

This repo satisfies the requirement three times over:

- the README extensions table links `mangabaka.org`;
- the extension description in `pbconfig.ts` names MangaBaka and all seven upstream providers;
- the settings form carries an About section crediting both.

A separate CC BY-NC-SA notice in the README was tried and removed as redundant — any one of the
three above already discharges it.
