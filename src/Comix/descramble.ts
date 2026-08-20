/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

// Page images arrive XOR-keystreamed and, on some chapters, additionally shuffled
// as a 5x5 tile grid. Every parameter needed to undo both arrives in response
// headers, so nothing here needs the site's JavaScript. See
// docs/Comix/site-recon.md#images-solved-in-principle-if-it-ever-mattered.

const GRID_COLS = 5;
const GRID_ROWS = 5;
const TILE_COUNT = GRID_COLS * GRID_ROWS;

const KEYSTREAM_MULTIPLIER = 1000005;
const KEYSTREAM_INCREMENT = 1234567891;
const SHUFFLE_MULTIPLIER = 1664525;
const SHUFFLE_INCREMENT = 1013904223;

export type ScrambleConfig = {
  encSeed: number;
  encLength: number;
  encAlgo: string | undefined;
  scrambleSeed: number;
  scrambleAlgo: string | undefined;
  cols: number;
  rows: number;
  gridded: boolean;
};

// The site sends a short opaque token rather than the value itself; only these
// two have ever been observed, and an unknown one contributes nothing.
function scrambleHashOffset(hash: string | undefined): number {
  switch (hash?.trim()) {
    case "03632":
      return 58414;
    case "02900":
      return 117532;
    default:
      return 0;
  }
}

// Header names are not case-normalised by the platform (docs/paperback/networking.md).
function header(headers: Record<string, string>, name: string): string | undefined {
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return match === undefined ? undefined : headers[match];
}

function intHeader(headers: Record<string, string>, name: string): number | undefined {
  const raw = header(headers, name);
  if (raw === undefined) return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value | 0 : undefined;
}

export function parseScrambleConfig(headers: Record<string, string>): ScrambleConfig | undefined {
  const encSeed = intHeader(headers, "x-enc-seed") ?? 0;
  const encLength = intHeader(headers, "x-enc-len") ?? 0;
  const scrambleSeedRaw = intHeader(headers, "x-scramble-seed") ?? 0;
  const scrambleAlgo = header(headers, "x-scramble-algo");

  const grid = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(header(headers, "x-scramble-grid") ?? "");
  const cols = grid?.[1] ? Number.parseInt(grid[1], 10) : 0;
  const rows = grid?.[2] ? Number.parseInt(grid[2], 10) : 0;

  const needsKeystream = encSeed !== 0 && encLength > 0;
  const gridded = cols > 0 && rows > 0 && scrambleSeedRaw !== 0;

  if (!needsKeystream && !gridded) return undefined;

  return {
    encSeed,
    encLength,
    encAlgo: header(headers, "x-enc-algo"),
    scrambleSeed: (scrambleSeedRaw ^ scrambleHashOffset(header(headers, "x-scramble-hash"))) | 0,
    scrambleAlgo,
    cols,
    rows,
    gridded,
  };
}

function nextXorshift(state: number): number {
  let next = state | 0;
  next ^= next << 13;
  next ^= next >>> 17;
  next ^= next << 5;
  return next | 0;
}

/**
 * Both generators are self-inverse under XOR, so the same routine encodes and
 * decodes. Only the first `length` bytes are keyed; the tail is plaintext.
 */
export function applyKeystream(
  bytes: Uint8Array,
  seed: number,
  length: number,
  algo?: string,
): Uint8Array {
  const out = bytes.slice();
  const limit = Math.min(out.length, length);
  const xorshift = algo === "2";
  let state = (xorshift ? seed | 1 : seed) | 0;

  for (let i = 0; i < limit; i += 1) {
    if (xorshift) {
      state = nextXorshift(state);
      out[i] = (out[i] ?? 0) ^ (state & 0xff);
    } else {
      state = (Math.imul(state, KEYSTREAM_MULTIPLIER) + KEYSTREAM_INCREMENT) | 0;
      out[i] = (out[i] ?? 0) ^ ((state >>> 24) & 0xff);
    }
  }
  return out;
}

/**
 * Reproduces the site's seeded Fisher-Yates, then inverts it: the result maps
 * each destination tile to the source tile that belongs there, which is the
 * direction a descrambling blit needs.
 */
export function tileOrder(seed: number, algo?: string, count: number = TILE_COUNT): number[] {
  const shuffled = Array.from({ length: count }, (_, index) => index);
  const xorshift = algo === "3";
  let state = (xorshift ? seed | 1 : seed) | 0;

  for (let i = count - 1; i > 0; i -= 1) {
    state = xorshift
      ? nextXorshift(state)
      : (Math.imul(state, SHUFFLE_MULTIPLIER) + SHUFFLE_INCREMENT) | 0;

    const j = (state >>> 0) % (i + 1);
    const swap = shuffled[i] ?? 0;
    shuffled[i] = shuffled[j] ?? 0;
    shuffled[j] = swap;
  }

  const inverse: number[] = Array.from({ length: count }, () => 0);
  shuffled.forEach((source, destination) => {
    inverse[source] = destination;
  });
  return inverse;
}

export type TileBlit = {
  sourceX: number;
  sourceY: number;
  destinationX: number;
  destinationY: number;
  width: number;
  height: number;
};

/**
 * Page payloads carry width and height, so the blit plan is computable without
 * decoding the image first. Integer tile sizes leave any remainder column/row
 * untouched, matching how the site slices it.
 */
export function tileBlits(width: number, height: number, order: number[]): TileBlit[] {
  const tileWidth = Math.floor(width / GRID_COLS);
  const tileHeight = Math.floor(height / GRID_ROWS);

  return order.map((source, destination) => ({
    sourceX: (source % GRID_COLS) * tileWidth,
    sourceY: Math.floor(source / GRID_COLS) * tileHeight,
    destinationX: (destination % GRID_COLS) * tileWidth,
    destinationY: Math.floor(destination / GRID_COLS) * tileHeight,
    width: tileWidth,
    height: tileHeight,
  }));
}

const IMAGE_SIGNATURES: ReadonlyArray<readonly number[]> = [
  [0xff, 0xd8],
  [0x89, 0x50, 0x4e, 0x47],
  [0x52, 0x49, 0x46, 0x46],
];

/** Used to pick between candidate keystreams when the algorithm is ambiguous. */
export function hasImageSignature(bytes: Uint8Array): boolean {
  return IMAGE_SIGNATURES.some((signature) =>
    signature.every((byte, index) => bytes[index] === byte),
  );
}

/**
 * Paperback 0.9 polyfills part of the DOM but does not type it — none of this is
 * in `@paperback/types`. Probing for `App.createPBCanvas` or a `PBCanvas` global
 * finds nothing and wrongly suggests the runtime has no drawing surface; the
 * standard DOM names are what exist. They are reached through `globalThis` and
 * feature-detected, so a runtime without them fails with a clear message.
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
  toDataURL(type?: string): string;
}

type Ctor<T, A extends unknown[] = []> = new (...args: A) => T;

function polyfill<T>(name: string): T {
  const found = (globalThis as Record<string, unknown>)[name];
  if (!found)
    throw new Error(`Comix: this Paperback build has no ${name}, so pages cannot be unscrambled`);
  return found as T;
}

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

// Blob and URL are not polyfilled, so bytes cross into and out of the image
// element as data: URLs rather than object URLs.
async function decodeImage(data: ArrayBuffer, mimeType: string): Promise<PolyfilledImage> {
  const image = new (polyfill<Ctor<PolyfilledImage>>("Image"))();

  return new Promise<PolyfilledImage>((resolve, reject) => {
    image.onload = (): void => resolve(image);
    image.onerror = (): void => reject(new Error("Comix: a page image failed to decode"));
    image.src = toDataUrl(data, mimeType);
    if (image.complete && image.naturalWidth > 0) resolve(image);
  });
}

/**
 * The polyfilled getImageData/putImageData use a Y-up buffer (origin at the
 * bottom-left), so rows arrive reversed. Flipping on the way in and out keeps
 * the tile arithmetic in ordinary top-down coordinates.
 */
function flipRows(pixels: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  const stride = width * 4;
  const flipped = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    flipped.set(pixels.subarray(y * stride, (y + 1) * stride), (height - 1 - y) * stride);
  }
  return flipped;
}

export async function descrambleImage(
  data: ArrayBuffer,
  config: ScrambleConfig,
  mimeType: string,
): Promise<ArrayBuffer> {
  const image = await decodeImage(data, mimeType);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  const tileWidth = Math.floor(width / config.cols);
  const tileHeight = Math.floor(height / config.rows);
  if (tileWidth === 0 || tileHeight === 0) {
    throw new Error(`Comix: ${width}x${height} is too small for ${config.cols}x${config.rows}`);
  }

  const canvas = new (polyfill<Ctor<PolyfilledCanvas>>("HTMLCanvasElement"))();
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Comix: no 2d context available for descrambling");
  context.drawImage(image, 0, 0, width, height);

  const source = flipRows(context.getImageData(0, 0, width, height).data, width, height);
  // Seeded from a copy so the right/bottom remainder, which the server leaves
  // unscrambled when the grid does not divide evenly, survives untouched.
  const destination = new Uint8ClampedArray(source);

  const order = tileOrder(config.scrambleSeed, config.scrambleAlgo, config.cols * config.rows);
  const rowBytes = tileWidth * 4;

  order.forEach((from, to) => {
    const fromX = (from % config.cols) * tileWidth;
    const fromY = Math.floor(from / config.cols) * tileHeight;
    const toX = (to % config.cols) * tileWidth;
    const toY = Math.floor(to / config.cols) * tileHeight;

    for (let y = 0; y < tileHeight; y += 1) {
      const start = ((fromY + y) * width + fromX) * 4;
      destination.set(source.subarray(start, start + rowBytes), ((toY + y) * width + toX) * 4);
    }
  });

  const ImageDataCtor =
    polyfill<Ctor<PolyfilledPixels, [Uint8ClampedArray, number, number]>>("ImageData");
  context.putImageData(
    new ImageDataCtor(flipRows(destination, width, height), width, height),
    0,
    0,
  );
  return fromDataUrl(canvas.toDataURL(mimeType));
}
