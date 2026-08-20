/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

// Page images arrive XOR-keystreamed and, on some chapters, additionally shuffled
// as a 5x5 tile grid. Every parameter needed to undo both arrives in response
// headers, so nothing here needs the site's JavaScript. See
// docs/Comix/site-recon.md#images-solved-in-principle-if-it-ever-mattered.

import { transformImage } from "./canvas.ts";

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
  scrambleSeedRaw: number;
  scrambleHash: string | undefined;
  scrambleAlgo: string | undefined;
  cols: number;
  rows: number;
  gridded: boolean;
};

// The site sends a short opaque token rather than the offset itself. These two
// were derived by seam-scoring real scrambled pages; every other observed token
// means "use the seed unmodified". A token outside both sets is resolved at
// runtime — see resolveOffset.
export const KNOWN_OFFSETS: Record<string, number> = {
  "03632": 58414,
  "02900": 117532,
};

const DISCOVERED_STATE = "comix.scramble-offsets";

/**
 * Only non-zero offsets are kept. The token rotates per response, so recording
 * every one that resolves to zero would grow without bound and say nothing —
 * zero is the assumption anyway. Legacy entries are filtered on read: a numeric
 * 0 written before this could come back as `false`, because 0 and false are
 * indistinguishable once a value has crossed the bridge.
 */
export function learnedOffsets(): Record<string, number> {
  const stored = Application.getState(DISCOVERED_STATE);
  if (!stored || typeof stored !== "object") return {};

  const kept: Record<string, number> = {};
  for (const [hash, offset] of Object.entries(stored as Record<string, unknown>)) {
    if (typeof offset === "number" && offset !== 0) kept[hash] = offset;
  }
  return kept;
}

function rememberOffset(hash: string, offset: number): void {
  if (offset === 0 || !hash) return;
  Application.setState({ ...learnedOffsets(), [hash]: offset }, DISCOVERED_STATE);
}

function knownOffset(hash: string | undefined): number | undefined {
  const token = hash?.trim();
  if (!token) return 0;
  return KNOWN_OFFSETS[token] ?? learnedOffsets()[token];
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
    scrambleSeedRaw,
    scrambleHash: header(headers, "x-scramble-hash")?.trim(),
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
 * Edge discontinuity across internal tile seams, sampled sparsely. A correctly
 * reassembled page scores an order of magnitude lower than a wrong one, which
 * makes this a reliable oracle for choosing between candidate offsets without
 * any knowledge of what the page depicts.
 */
function seamCost(edges: TileEdges, order: number[], cols: number, rows: number): number {
  const gap = (a: number[], b: number[]): number => {
    let sum = 0;
    for (let i = 0; i < a.length; i += 1) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    return sum;
  };

  let total = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const here = order[row * cols + col] ?? 0;
      if (col + 1 < cols) {
        total += gap(edges.right[here] ?? [], edges.left[order[row * cols + col + 1] ?? 0] ?? []);
      }
      if (row + 1 < rows) {
        total += gap(edges.bottom[here] ?? [], edges.top[order[(row + 1) * cols + col] ?? 0] ?? []);
      }
    }
  }
  return total;
}

type TileEdges = { right: number[][]; left: number[][]; bottom: number[][]; top: number[][] };

/** Sampled every 16px: enough signal to rank arrangements, cheap enough to run
 * a search over. */
function tileEdges(
  pixels: Uint8ClampedArray,
  width: number,
  cols: number,
  rows: number,
  tileWidth: number,
  tileHeight: number,
): TileEdges {
  const step = 16;
  const edges: TileEdges = { right: [], left: [], bottom: [], top: [] };

  for (let tile = 0; tile < cols * rows; tile += 1) {
    const ox = (tile % cols) * tileWidth;
    const oy = Math.floor(tile / cols) * tileHeight;
    const right: number[] = [];
    const left: number[] = [];
    const bottom: number[] = [];
    const top: number[] = [];

    for (let y = 0; y < tileHeight; y += step) {
      const row = (oy + y) * width;
      for (let c = 0; c < 3; c += 1) {
        right.push(pixels[(row + ox + tileWidth - 1) * 4 + c] ?? 0);
        left.push(pixels[(row + ox) * 4 + c] ?? 0);
      }
    }
    for (let x = 0; x < tileWidth; x += step) {
      for (let c = 0; c < 3; c += 1) {
        bottom.push(pixels[((oy + tileHeight - 1) * width + ox + x) * 4 + c] ?? 0);
        top.push(pixels[(oy * width + ox + x) * 4 + c] ?? 0);
      }
    }
    edges.right.push(right);
    edges.left.push(left);
    edges.bottom.push(bottom);
    edges.top.push(top);
  }
  return edges;
}

// Every offset observed so far is below 2^18; a token needing more than this is
// better reported than hunted for while the reader waits.
const OFFSET_SEARCH_LIMIT = 1 << 18;

/**
 * A token in neither the shipped nor the learned table is resolved against the
 * image itself. The seed unmodified is tried first, since that is what almost
 * every token means, and the space is only swept when that plainly fails.
 */
function resolveOffset(
  config: ScrambleConfig,
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  verifyUnknown: boolean,
): number {
  const settled = knownOffset(config.scrambleHash);
  if (settled !== undefined) return settled;

  // The token rotates per response, so nearly every value is one-off and means
  // "seed unmodified". Confirming that costs a score per page to establish what
  // was already assumed, so the caller decides whether it is worth paying.
  if (!verifyUnknown) return 0;

  const { cols, rows } = config;
  const count = cols * rows;
  const edges = tileEdges(
    pixels,
    width,
    cols,
    rows,
    Math.floor(width / cols),
    Math.floor(height / rows),
  );

  const identity = Array.from({ length: count }, (_, i) => i);
  const asDelivered = seamCost(edges, identity, cols, rows);
  const costOf = (offset: number): number =>
    seamCost(
      edges,
      tileOrder((config.scrambleSeedRaw ^ offset) | 0, config.scrambleAlgo, count),
      cols,
      rows,
    );

  // A correct arrangement beat the scrambled one by 20x in every sample, so this
  // margin is a confident accept rather than a lucky one.
  if (costOf(0) * 4 < asDelivered) return 0;

  let best = 0;
  let bestCost = costOf(0);
  for (let offset = 1; offset < OFFSET_SEARCH_LIMIT; offset += 1) {
    const cost = costOf(offset);
    if (cost < bestCost) {
      bestCost = cost;
      best = offset;
    }
  }

  if (bestCost * 4 < asDelivered && config.scrambleHash) rememberOffset(config.scrambleHash, best);
  return best;
}

/**
 * Undo the tile shuffle. The pixel work here is a pure transform; decoding,
 * encoding, and the polyfill's Y-up buffer are `canvas.ts`'s problem.
 */
export async function descrambleImage(
  data: ArrayBuffer,
  config: ScrambleConfig,
  mimeType: string,
  verifyUnknown: boolean,
): Promise<ArrayBuffer> {
  return transformImage(data, mimeType, (source, width, height) => {
    const tileWidth = Math.floor(width / config.cols);
    const tileHeight = Math.floor(height / config.rows);
    if (tileWidth === 0 || tileHeight === 0) {
      throw new Error(`Comix: ${width}x${height} is too small for ${config.cols}x${config.rows}`);
    }

    const offset = resolveOffset(config, source, width, height, verifyUnknown);
    const order = tileOrder(
      (config.scrambleSeedRaw ^ offset) | 0,
      config.scrambleAlgo,
      config.cols * config.rows,
    );

    // Seeded from a copy so the right/bottom remainder, which the server leaves
    // unscrambled when the grid does not divide evenly, survives untouched.
    const destination = new Uint8ClampedArray(source);
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

    return destination;
  });
}
