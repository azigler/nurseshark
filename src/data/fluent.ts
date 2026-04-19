// Tiny runtime Fluent resolver. The gen pipeline extracts every
// `reagent-name-*`, `reagent-desc-*`, `damage-type-*`, etc. message from
// the VS14 SS14 locale into a flat key -> value dict. This helper looks
// keys up with graceful fallbacks.

import type { FluentDict } from '../types';

/**
 * Resolve a Fluent key against the bundled dict. Falls back to the raw
 * key when missing — so a stale JSON never crashes the UI, just shows
 * `reagent-name-bicaridine` instead of "Bicaridine."
 */
export function resolveFluentKey(
  dict: FluentDict,
  key: string | null | undefined,
): string {
  if (!key) {
    return '';
  }
  const v = dict[key];
  if (typeof v === 'string') {
    return v;
  }
  return key;
}

/**
 * Title-case a raw reagent/damage/species ID for fallback display
 * ("MindbreakerToxin" -> "Mindbreaker Toxin").
 */
export function prettifyId(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
