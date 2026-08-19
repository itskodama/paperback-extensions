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

  const needsKeystream = encSeed !== 0 && encLength > 0;
  const gridded = header(headers, "x-scramble-grid") === "5x5" && scrambleSeedRaw !== 0;

  if (!needsKeystream && !gridded) return undefined;

  return {
    encSeed,
    encLength,
    encAlgo: header(headers, "x-enc-algo"),
    scrambleSeed: (scrambleSeedRaw ^ scrambleHashOffset(header(headers, "x-scramble-hash"))) | 0,
    scrambleAlgo,
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
