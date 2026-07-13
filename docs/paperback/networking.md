# Networking

All requests go through `Application.scheduleRequest`. This page covers its behaviour, the
interceptor pipeline, and rate limiting.

## Making requests

`Application.scheduleRequest(request)` resolves to a `[Response, ArrayBuffer]` tuple. Convert
bodies with `Application.arrayBufferToUTF8String(data)`.

```ts
const [response, data] = await Application.scheduleRequest({ url, method: "GET" });
if (response.status < 200 || response.status >= 300) {
  throw new Error(`HTTP ${response.status} for ${url}`);
}
const html = Application.arrayBufferToUTF8String(data);
```

Throw errors with messages a reader can act on — they surface in the app UI. Name the site and the
failure, not the internals.

## Redirects are not followed

A `3xx` response is returned to you as-is. Inspect the status and the `Location` header yourself,
and remember:

- Header names are not case-normalised — search for `location` case-insensitively.
- `Location` may be relative. Resolve root-relative paths against the **redirecting host's**
  origin, not your primary domain: after an absolute redirect off-host, they differ.
- Cap the redirect count; a loop otherwise hangs the request path forever.

## Interceptors

Global request behaviour belongs in a `PaperbackInterceptor` subclass registered in `initialise()`.
Both extensions use one to set a user-agent on every request:

```ts
export class MainInterceptor extends PaperbackInterceptor {
  override async interceptRequest(request: Request): Promise<Request> {
    request.headers = { ...request.headers, "user-agent": USER_AGENT };
    return request;
  }
}
```

`interceptResponse` receives `(request, response, data)` and returns the (optionally transformed)
`ArrayBuffer`. Image requests made by the app for covers and pages also flow through registered
interceptors, which is how a source attaches referers or auth to image fetches when a site needs
them.

## Rate limiting

`BasicRateLimiter` is an interceptor too:

```ts
mainRateLimiter = new BasicRateLimiter("main", {
  numberOfRequests: 20,
  bufferInterval: 10, // seconds
  ignoreImages: true,
});
```

Register it alongside the main interceptor in `initialise()`. Budget deliberately: LNORI raised its
limit to 20 req/10 s because chapter listing legitimately fetches one page per volume against a
static CDN, while AsuraScans stays at 15 req/10 s against an origin server. `ignoreImages` keeps
page images out of the budget so reading isn't throttled by the source's API ceiling.

## Caching

The platform gives you no fetch cache; if the same page serves several calls (a series page read by
both `getMangaDetails` and `getChapters`, a homepage read by three discover sections), cache it
yourself at module level with a short TTL, and de-duplicate in-flight requests for the same URL —
discover sections arrive as a burst and will otherwise fetch the same page concurrently. See
`src/LNORI/network.ts` for the pattern.

## See also

- [Runtime environment](runtime.md) — no timers; pace with `Application.sleep(seconds)`
- [Testing](testing.md) — live-site tests and why they fail when sites drift
