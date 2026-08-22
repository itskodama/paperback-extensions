/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Typed reads out of untrusted objects. Every `/api/*` response arrives as plain records of
 * `unknown`, so each field the extension uses is narrowed exactly once, here.
 */

export type Rec = Record<string, unknown>;

export function asRecord(value: unknown): Rec | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Rec;
}

export function readString(source: Rec, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readNumber(source: Rec, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function readRecords(source: Rec, key: string): Rec[] {
  const value = source[key];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    return record ? [record] : [];
  });
}
