/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * The runtime's undeclared DOM polyfills, and the only impure part of image
 * handling. Isolating it here keeps the pixel maths in `scramble.ts` pure and
 * unit-testable, and confines every quirk of the polyfill to one file.
 *
 * See docs/paperback/api-reference.md#the-polyfilled-dom.
 */

interface PolyfilledImage {
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  complete: boolean;
  src: string;
  onload: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

interface PolyfilledPixels {
  data: Uint8ClampedArray;
}

interface PolyfilledContext {
  drawImage(image: PolyfilledImage, dx: number, dy: number, dw: number, dh: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): PolyfilledPixels;
  putImageData(pixels: PolyfilledPixels, dx: number, dy: number): void;
}

interface PolyfilledCanvas {
  width: number;
  height: number;
  getContext(contextId: "2d"): PolyfilledContext | null;
  toDataURL(type?: string, quality?: number): string;
}

type Ctor<T, A extends unknown[] = []> = new (...args: A) => T;

/** None of this is typed, so it is reached by name and feature-detected — a
 * runtime without it then fails with a message instead of a TypeError. */
function polyfill<T>(name: string): T {
  const found = (globalThis as Record<string, unknown>)[name];
  if (!found) {
    throw new Error(`Comix: this Paperback build has no ${name}, so pages cannot be unscrambled`);
  }
  return found as T;
}

// Blob and URL are absent, so bytes cross in and out as data: URLs.
function toDataUrl(data: ArrayBuffer, mimeType: string): string {
  const encoded = Application.base64Encode(data);
  const text =
    typeof encoded === "string" ? encoded : Application.arrayBufferToASCIIString(encoded);
  return `data:${mimeType};base64,${text}`;
}

function fromDataUrl(dataUrl: string): ArrayBuffer {
  const decoded = Application.base64Decode(dataUrl.slice(dataUrl.indexOf(",") + 1));
  if (typeof decoded !== "string") return decoded;

  const bytes = new Uint8Array(decoded.length);
  for (let i = 0; i < decoded.length; i += 1) bytes[i] = decoded.charCodeAt(i);
  return bytes.buffer;
}

async function decodeImage(data: ArrayBuffer, mimeType: string): Promise<PolyfilledImage> {
  const image = new (polyfill<Ctor<PolyfilledImage>>("Image"))();

  return new Promise<PolyfilledImage>((resolve, reject) => {
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error("Comix: a page image failed to decode"));
    image.src = toDataUrl(data, mimeType);
    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

/** The polyfilled pixel buffer is Y-up, so rows arrive reversed. */
function flipRows(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const stride = width * 4;
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return flipped;
}

export type PixelTransform = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
) => Uint8ClampedArray;

// A canvas that cannot encode the requested type falls back to PNG (HTML spec),
// and JavaScriptCore's canvas cannot encode WebP — so `toDataURL("image/webp")`
// silently yields a multi-megabyte lossless PNG. JPEG is always encodable and,
// on opaque manga art, visually lossless at this quality while staying close to
// the original size. Native Comix clients re-encode to JPEG for the same reason.
const OUTPUT_MIME = "image/jpeg";
// q92 was cautious; measured against a real page it costs ~45% over the source
// WebP while q85 lands within ~8% and is indistinguishable on opaque page art.
const OUTPUT_QUALITY = 0.85;

/**
 * Decode, hand the caller ordinary top-down pixels, and re-encode. The Y-up flip
 * belongs here rather than in the caller: it is a property of the polyfill, not
 * of whatever the pixels are being used for.
 */
export type TransformResult = { bytes: ArrayBuffer; inputBytes: number; outputBytes: number };

export async function transformImage(
  data: ArrayBuffer,
  mimeType: string,
  transform: PixelTransform,
): Promise<TransformResult> {
  const image = await decodeImage(data, mimeType);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const canvas = new (polyfill<Ctor<PolyfilledCanvas>>("HTMLCanvasElement"))();
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Comix: no 2d context available");
  context.drawImage(image, 0, 0, width, height);

  const upright = flipRows(context.getImageData(0, 0, width, height).data, width, height);
  const result = transform(upright, width, height);

  const ImageDataCtor =
    polyfill<Ctor<PolyfilledPixels, [Uint8ClampedArray, number, number]>>("ImageData");
  context.putImageData(new ImageDataCtor(flipRows(result, width, height), width, height), 0, 0);
  const bytes = fromDataUrl(canvas.toDataURL(OUTPUT_MIME, OUTPUT_QUALITY));
  return { bytes, inputBytes: data.byteLength, outputBytes: bytes.byteLength };
}

/**
 * Whether the canvas can genuinely encode a format, rather than silently falling
 * back to PNG. Asked of a 1x1 canvas, so it costs nothing. This is the check that
 * decides whether re-encoding a page can keep its original format or has to
 * settle for JPEG.
 */
export function canEncode(mimeType: string): boolean {
  try {
    const canvas = new (polyfill<Ctor<PolyfilledCanvas>>("HTMLCanvasElement"))();
    canvas.width = 1;
    canvas.height = 1;
    return canvas.toDataURL(mimeType).startsWith(`data:${mimeType}`);
  } catch {
    return false;
  }
}
