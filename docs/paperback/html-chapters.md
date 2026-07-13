# `html` chapters must be well-formed XHTML — **device-only**

The `html` `ChapterDetails` variant (novel sources) is parsed on device by an XML parser, not an
HTML one, and rendered with HTML semantics only inside an XHTML-namespaced document. Every rule on
this page was learned from a real on-device failure; none of them is visible to the Node test
runner.

## Parsing: well-formed XML or nothing

Feeding the reader ordinary HTML5 fails at open with a libxml2-style error naming the first
violation:

```
error on line 1 at column 414: Opening and ending tag mismatch: img line 1 and picture
```

Real markup is full of things XML rejects that every browser accepts:

| Hazard                           | Example                          | Fix                                                                               |
| -------------------------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| Unclosed void elements           | `<img …>`, `<hr>`, `<source …>`  | Self-close: `<img …/>`                                                            |
| Undeclared namespace prefixes    | `epub:type="bodymatter"`         | Strip the attribute (or declare the namespace)                                    |
| Named entities beyond XML's five | `&nbsp;` — fatal on real volumes | Map to numeric refs (`&#160;`); only `amp`/`lt`/`gt`/`quot`/`apos` are predefined |
| Unknown entities you didn't map  | anything obscure                 | Escape to `&amp;name;` — degrades to visible text instead of a fatal error        |

## Rendering: the XHTML namespace

Well-formedness makes it parse; the **XHTML namespace** makes it render. Serve a complete document,
not a fragment:

```html
<html xmlns="http://www.w3.org/1999/xhtml">
  <head></head>
  <body>
    …content…
  </body>
</html>
```

Without that `xmlns`, the XML parses but every element is anonymous — no block semantics, so an
entire book renders as one run-together wrapped line, and `<img>` is not treated as an image (a
bare fragment showed images only sporadically). Inserting literal newlines does nothing; the fix is
the namespace, after which `<p>`/`<img>` behave like HTML.

Keep the markup inside the body plain: simple tags, absolute image URLs, no reliance on CSS
classes — the reader applies its own typography.

## Validating locally

The Node test runner accepts any string here, so validate by dumping the transformed chapter (a
throwaway test that `console.log`s it — see [Testing](testing.md#throwaway-deep-tests)) and running
`xmllint --noout` over it. xmllint **is** the same libxml2 that produces the on-device error, which
makes it a faithful proxy for the parse — though not for rendering, which still needs a device.

## See also

- [Chapters](chapters.md) — the `ChapterDetails` union this variant belongs to
- [Testing](testing.md) — device verification and the throwaway-test pattern
