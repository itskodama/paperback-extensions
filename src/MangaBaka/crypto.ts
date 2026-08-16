/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * The crypto PKCE needs. `Application` offers only MD5, so SHA-256 comes from WebCrypto —
 * untyped and not guaranteed by JavaScriptCore, but present on device. Everything is
 * feature-detected so a runtime without it fails at login saying so.
 */

type WebCrypto = {
  getRandomValues?: (array: Uint8Array) => Uint8Array;
  subtle?: { digest?: (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer> };
};

function webCrypto(): WebCrypto | undefined {
  return (globalThis as { crypto?: WebCrypto }).crypto;
}

/**
 * Reported once from `initialise` into the settings form, so a login that fails for want of
 * WebCrypto says so somewhere a user can read. Confirmed present on device 2026-08-15.
 */
export function cryptoSupport(): string {
  const source = webCrypto();
  if (source === undefined) return "crypto: absent";

  return [
    "crypto: present",
    `getRandomValues: ${typeof source.getRandomValues === "function" ? "yes" : "no"}`,
    `subtle: ${typeof source.subtle?.digest === "function" ? "yes" : "no"}`,
  ].join(", ");
}

export function utf8Bytes(input: string): number[] {
  const bytes: number[] = [];

  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);

    // Combine a surrogate pair into the single code point it represents.
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }

    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }

  return bytes;
}

/** SHA-256, from WebCrypto. */
export async function sha256(bytes: readonly number[]): Promise<number[]> {
  const digest = webCrypto()?.subtle?.digest;
  if (digest === undefined) {
    throw new Error("This device's browser engine has no SHA-256, so MangaBaka login cannot run.");
  }

  const subtle = webCrypto()?.subtle as { digest: typeof digest };
  return [...new Uint8Array(await digest.call(subtle, "SHA-256", Uint8Array.from(bytes)))];
}

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 4648 §5 base64url, unpadded — the encoding PKCE requires. */
export function base64UrlEncode(bytes: readonly number[]): string {
  let out = "";

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    const triple = (b0 << 16) | ((b1 ?? 0) << 8) | (b2 ?? 0);

    out += BASE64URL[(triple >> 18) & 0x3f];
    out += BASE64URL[(triple >> 12) & 0x3f];
    if (b1 !== undefined) out += BASE64URL[(triple >> 6) & 0x3f];
    if (b2 !== undefined) out += BASE64URL[triple & 0x3f];
  }

  return out;
}

/** `S256` challenge: base64url(sha256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64UrlEncode(await sha256(utf8Bytes(verifier)));
}

const VERIFIER_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** From the platform CSPRNG; see {@link cryptoSupport}. */
export function randomBytes(length: number): number[] {
  const source = webCrypto();
  if (source?.getRandomValues === undefined) {
    throw new Error("This device's browser engine has no secure randomness.");
  }

  return [...source.getRandomValues(new Uint8Array(length))];
}

/** A PKCE `code_verifier`: 43–128 characters from the unreserved set. */
export function randomVerifier(length = 64): string {
  const bytes = randomBytes(length);
  let out = "";
  for (const byte of bytes) out += VERIFIER_ALPHABET[byte % VERIFIER_ALPHABET.length];
  return out;
}
