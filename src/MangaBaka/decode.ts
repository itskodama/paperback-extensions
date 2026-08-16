/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Copyright © 2026 Kodama */

/**
 * Reading untyped JSON. Everything returns `undefined` rather than a default, so callers
 * keep the difference between "absent" and "zero".
 */

/** `""` and `"   "` are both absent. */
export function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function str(value: unknown): string | undefined {
  return isText(value) ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function positive(value: unknown): number | undefined {
  const parsed = num(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isText) : [];
}

/** `total_chapters` and `final_volume` are nullable *strings* (`"232"`), not numbers. */
export function count(value: unknown): number | undefined {
  return positive(typeof value === "string" ? Number(value.trim()) : value);
}
